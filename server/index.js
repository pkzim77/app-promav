// ============================================================
// Promav — backend (Express + Neon/Postgres)
// API REST consumida pelo frontend React. As formas de dados
// retornadas espelham as de src/data/store.js para que as telas
// não precisem mudar (desc, memberIds, checklist, start/end…).
// ============================================================
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import { q, tx } from './db.js'
import { requireAuth, signToken, verifyPassword, hashPassword } from './auth.js'

const app = express()

// CORS: o frontend (Firebase) e o backend (Cloud Run) ficam em origens diferentes.
// CORS_ORIGIN aceita uma lista separada por vírgula; ausente/"*" libera todas.
const origins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({ origin: origins.includes('*') ? true : origins }))
// gzip nas respostas. O bootstrap é JSON repetitivo e cai ~85% (54 KB → 8 KB),
// o que importa porque ele é recarregado a cada mudança detectada pelo /pulse.
// Vem antes das rotas para envolver todas elas.
app.use(compression())
app.use(express.json())

const PORT = process.env.PORT || 3001

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.warn('[promav] AVISO: JWT_SECRET não definido em produção — defina nas variáveis do Cloud Run.')
}

// ---------- helpers ----------
const genId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// Envolve um handler async e encaminha erros para o middleware de erro.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// SQL reutilizável: monta uma tarefa completa (com checklist + membros) já no formato do front.
const TASK_SELECT = `
  SELECT t.id,
         t.project_id  AS "projectId",
         t.title,
         t.assignee_id AS "assigneeId",
         t.status,
         t.priority,
         to_char(t.start_date, 'YYYY-MM-DD') AS start,
         to_char(t.end_date,   'YYYY-MM-DD') AS "end",
         COALESCE((
           SELECT json_agg(json_build_object('id', c.id, 'text', c.text, 'done', c.done,
                                             'state', c.state, 'assigneeId', c.assignee_id) ORDER BY c.position)
           FROM checklist_items c WHERE c.task_id = t.id
         ), '[]'::json) AS checklist,
         COALESCE((
           SELECT json_agg(m.user_id ORDER BY m.user_id)
           FROM task_members m WHERE m.task_id = t.id
         ), '[]'::json) AS "memberIds",
         t.created_by AS "createdBy",
         (extract(epoch FROM t.created_at) * 1000)::bigint AS "createdAt",
         CASE WHEN t.updated_at IS NULL THEN NULL
              ELSE (extract(epoch FROM t.updated_at) * 1000)::bigint END AS "updatedAt",
         COALESCE((
           SELECT json_agg(json_build_object(
                    'userId', v.user_id,
                    'seenAt', (extract(epoch FROM v.seen_at) * 1000)::bigint)
                  ORDER BY v.user_id)
           FROM task_views v WHERE v.task_id = t.id
         ), '[]'::json) AS views
  FROM tasks t`

// bigint volta como string no driver pg → converte o que for número.
const mapTask = (t) => ({
  ...t,
  createdAt: t.createdAt == null ? null : Number(t.createdAt),
  updatedAt: t.updatedAt == null ? null : Number(t.updatedAt),
  views: (t.views || []).map(v => ({ ...v, seenAt: Number(v.seenAt) })),
})

const PROJECT_SELECT = `
  SELECT id, name,
         description AS desc,
         color,
         folder_id AS "folderId",
         position,
         notes,
         resources,
         prefeitura,
         secretaria,
         origem_recurso AS "origemRecurso",
         -- As colunas guardam os nomes antigos; a API expõe os atuais.
         -- valor_convenio   → valor estimado (primeira estimativa)
         -- valor_disponivel → valor orçado   (orçamento fechado)
         valor_convenio::float8   AS "valorEstimado",
         valor_disponivel::float8 AS "valorOrcado",
         status,
         responsible_ids AS "responsibleIds",
         default_role AS "defaultRole",
         created_at AS created,
         COALESCE((
           SELECT json_agg(json_build_object('userId', pm.user_id, 'role', pm.role) ORDER BY pm.user_id)
           FROM project_members pm WHERE pm.project_id = projects.id
         ), '[]'::json) AS members,
         to_char(start_date, 'YYYY-MM-DD') AS start,
         to_char(end_date,   'YYYY-MM-DD') AS "end"
  FROM projects`

// Lista de pastas, na ordem em que devem aparecer na sidebar.
const FOLDER_SELECT = 'SELECT id, name, position, parent_id AS "parentId" FROM folders'

// Normaliza os recursos do projeto antes de gravar. Há dois formatos:
//  • externo  → { id, type, url, label }            (link colado: docs.google, etc.)
//  • upload   → { id, type, fileId, filename, mime, size, label }  (arquivo no banco)
function normalizeResources(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((r) => {
      if (!r) return null
      const type = ['image', 'doc', 'link'].includes(r.type) ? r.type : 'link'
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      if (r.fileId) {
        return {
          id: r.id || genId('r'), type, fileId: r.fileId,
          filename: typeof r.filename === 'string' ? r.filename : '',
          mime: typeof r.mime === 'string' ? r.mime : '',
          size: Number(r.size) || 0,
          label,
        }
      }
      if (typeof r.url === 'string' && r.url.trim()) {
        return { id: r.id || genId('r'), type, url: r.url.trim(), label }
      }
      return null
    })
    .filter(Boolean)
}

// ----- dados do convênio (ficha do projeto) -----
// Origem do recurso e status do projeto: listas fixas (espelham store.js).
const ORIGENS_RECURSO = ['federal', 'estadual', 'municipal', 'emenda', 'outro']
const PROJ_STATUSES = ['planejamento', 'andamento', 'revisao', 'pendente', 'diligencia', 'paralisado', 'concluido']
const normOrigem = (v) => (ORIGENS_RECURSO.includes(v) ? v : 'federal')
const normProjStatus = (v) => (PROJ_STATUSES.includes(v) ? v : 'planejamento')
// Valor do convênio: número >= 0 ou null (não informado).
const normValor = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}
// Profissionais responsáveis: lista de ids de usuários, sem duplicados.
const normResponsibles = (v) =>
  Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []

// Papéis válidos por projeto: 'full' (Edição total) e 'view' (Só exibição).
// 'admin' é global (users.is_admin) e tem poder total em todos os projetos.
const ROLES = ['full', 'view']
const normRole = (r) => (ROLES.includes(r) ? r : 'view')
const normDefaultRole = (r) => (ROLES.includes(r) ? r : 'full')

// Conjuntos de permissão para gating das rotas.
const CAN = {
  edit: ['admin', 'full'],          // criar/editar/excluir atividades, editar projeto, excluir material
  publishChange: ['admin', 'full', 'view'], // publicar mudanças/requisições quando participa do projeto
  light: ['admin', 'full', 'view'], // mover no Kanban, marcar checklist, adicionar material
  adminOnly: ['admin'],             // gerenciar permissões, excluir projeto
}

// Estados de um item de checklist. Nao tem 'progress': item e a menor unidade
// de trabalho da etapa, e nao se divide em meio-feito. 'done' continua sendo
// espelhado na coluna `done`, que o resto do sistema le.
const ESTADOS_ITEM = ['todo', 'review', 'diligence', 'done']

// Papel efetivo de um usuário num projeto: admin global > pessoa incluída no projeto.
// Quem NÃO foi incluído não tem papel nenhum (null) — não enxerga o projeto.
// É este null que faz o gate() barrar todas as rotas do projeto.
async function effectiveRole(userId, projectId) {
  const [u] = await q('SELECT is_admin FROM users WHERE id = $1', [userId])
  if (u && u.is_admin) return 'admin'
  const [m] = await q('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId])
  return m ? normRole(m.role) : null
}

// Ids dos projetos que um usuário enxerga. Admin vê todos (null = sem filtro).
async function visibleProjectIds(userId) {
  if (await userIsAdmin(userId)) return null
  const rows = await q('SELECT project_id FROM project_members WHERE user_id = $1', [userId])
  return rows.map(r => r.project_id)
}

// Mantém só as pastas que levam a algum projeto visível (e seus ancestrais),
// para não exibir uma árvore de pastas vazias a quem não participa de nada.
function foldersWithProjects(folders, projects) {
  const byId = new Map(folders.map(f => [f.id, f]))
  const keep = new Set()
  for (const p of projects) {
    let id = p.folderId
    while (id && byId.has(id) && !keep.has(id)) { keep.add(id); id = byId.get(id).parentId }
  }
  return folders.filter(f => keep.has(f.id))
}

async function userIsAdmin(userId) {
  const [u] = await q('SELECT is_admin FROM users WHERE id = $1', [userId])
  return !!(u && u.is_admin)
}

// Middleware: exige que o usuário tenha um papel permitido no projeto.
// resolveProjectId pode ser um valor ou uma função (req) => id (síncrona ou async).
function gate(resolveProjectId, allowed) {
  return wrap(async (req, res, next) => {
    const pid = typeof resolveProjectId === 'function' ? await resolveProjectId(req) : resolveProjectId
    if (!pid) return res.status(404).json({ error: 'Projeto não encontrado.' })
    const role = await effectiveRole(req.userId, pid)
    if (!allowed.includes(role)) return res.status(403).json({ error: 'Você não tem permissão para esta ação.' })
    req.projectRole = role
    next()
  })
}

// Só administradores globais.
const requireAdmin = wrap(async (req, res, next) => {
  if (!(await userIsAdmin(req.userId))) return res.status(403).json({ error: 'Apenas administradores.' })
  next()
})

// Descobre o projeto de uma tarefa (para gating de rotas /tasks/:id).
async function taskProjectId(req) {
  const [t] = await q('SELECT project_id FROM tasks WHERE id = $1', [req.params.id])
  return t ? t.project_id : null
}

// Substitui as exceções de permissão (project_members) de um projeto.
async function replaceMembers(client, projectId, members) {
  await client.query('DELETE FROM project_members WHERE project_id = $1', [projectId])
  for (const m of members || []) {
    if (!m || !m.userId || !ROLES.includes(m.role)) continue
    await client.query(
      'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role',
      [projectId, m.userId, m.role]
    )
  }
}

// Apaga do banco os arquivos de um projeto que não são mais referenciados
// pela lista de recursos (ex.: o usuário removeu um documento/imagem enviado).
async function pruneOrphanFiles(client, projectId, resources) {
  const keep = resources.filter((r) => r.fileId).map((r) => r.fileId)
  if (keep.length) {
    await client.query('DELETE FROM files WHERE project_id = $1 AND id <> ALL($2::text[])', [projectId, keep])
  } else {
    await client.query('DELETE FROM files WHERE project_id = $1', [projectId])
  }
}

const SESSION_SELECT = `
  SELECT id,
         user_id AS "userId",
         task_id AS "taskId",
         (extract(epoch FROM start_at) * 1000)::bigint AS start,
         CASE WHEN end_at IS NULL THEN NULL ELSE (extract(epoch FROM end_at) * 1000)::bigint END AS "end"
  FROM time_sessions`

// bigint volta como string no driver pg → converte para Number.
const mapSession = (s) => ({ ...s, start: Number(s.start), end: s.end === null ? null : Number(s.end) })

async function getTask(id) {
  const rows = await q(`${TASK_SELECT} WHERE t.id = $1`, [id])
  return rows[0] ? mapTask(rows[0]) : null
}
// projectIds: null = todas (admin); array = só as tarefas desses projetos.
async function listTasks(projectIds = null) {
  const rows = projectIds === null
    ? await q(`${TASK_SELECT} ORDER BY t.id`)
    : await q(`${TASK_SELECT} WHERE t.project_id = ANY($1) ORDER BY t.id`, [projectIds])
  return rows.map(mapTask)
}
// projectIds: null = todos (admin); array = só as sessões de tarefas desses projetos.
async function listSessions(projectIds = null) {
  const rows = projectIds === null
    ? await q(`${SESSION_SELECT} ORDER BY start_at`)
    : await q(`${SESSION_SELECT} WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ANY($1)) ORDER BY start_at`, [projectIds])
  return rows.map(mapSession)
}

// Substitui checklist e membros de uma tarefa (estratégia: apaga e reinsere).
async function replaceChildren(client, taskId, checklist = [], memberIds = [], assigneeId) {
  await client.query('DELETE FROM checklist_items WHERE task_id = $1', [taskId])
  await client.query('DELETE FROM task_members WHERE task_id = $1', [taskId])

  // Quem responde por CADA item. Uma atividade com duas pessoas costuma ter
  // cada uma cuidando de uma parte; sem isto só dá para saber que "alguém do
  // par" está devendo. Aceita null: ligar o item a alguém não é obrigatório.
  const podeAssumir = new Set([assigneeId, ...(memberIds || [])].filter(Boolean))
  for (let i = 0; i < checklist.length; i++) {
    const item = checklist[i]
    // Só vale quem participa da atividade — o seletor mostra só eles, mas o
    // servidor não confia no que chega.
    const dono = podeAssumir.has(item.assigneeId) ? item.assigneeId : null
    // Estado e `done` andam juntos. Item vindo de fora sem estado (modal antigo,
    // mudanca que vira item) cai no equivalente do que o `done` dizia.
    const estado = ESTADOS_ITEM.includes(item.state) ? item.state : (item.done ? 'done' : 'todo')
    await client.query(
      'INSERT INTO checklist_items (id, task_id, text, done, position, assignee_id, state) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [item.id || genId('c'), taskId, item.text, estado === 'done', i, dono, estado]
    )
  }
  // membros = lista informada, sem o responsável (ele já é o assignee).
  const members = [...new Set((memberIds || []).filter((u) => u && u !== assigneeId))]
  for (const userId of members) {
    await client.query(
      'INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [taskId, userId]
    )
  }
}

// ============================================================
// Rotas
// ============================================================

app.get('/api/health', wrap(async (_req, res) => {
  const [{ now }] = await q('SELECT now()')
  res.json({ ok: true, now })
}))

// Forma pública de um usuário (sem hash de senha).
const PUBLIC_USER = 'id, name, initials, color, email, short_name AS "shortName", phone, sector, formation, professional_register AS "professionalRegister", is_admin AS "isAdmin", is_active AS "isActive", is_outsourced AS "isOutsourced", is_dev AS "isDev"'
// Forma reduzida usada em listas (bootstrap/equipe).
const LIST_USER = 'id, name, initials, color, email, short_name AS "shortName", phone, sector, formation, professional_register AS "professionalRegister", is_admin AS "isAdmin", is_active AS "isActive", is_outsourced AS "isOutsourced", is_dev AS "isDev"'

// ----- autenticação (rotas públicas) -----
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Informe email e senha.' })
  const [row] = await q('SELECT id, name, initials, color, email, is_admin AS "isAdmin", is_active AS "isActive", password_hash FROM users WHERE lower(email) = lower($1)', [email])
  // Mesma mensagem genérica para senha errada, e-mail inexistente ou conta
  // inativa — nenhuma delas pode revelar se a conta existe ou está desligada.
  if (!row || row.isActive === false || !row.password_hash || !(await verifyPassword(password, row.password_hash))) {
    return res.status(401).json({ error: 'Email ou senha incorretos.' })
  }
  const { password_hash, ...user } = row
  res.json({ token: signToken(user), user })
}))

// ===== a partir daqui, tudo exige autenticação =====
app.use('/api', requireAuth)

// Carimbo do estado do banco — o front consulta de tempos em tempos e só
// refaz o /bootstrap (54 KB) quando o valor muda. A resposta tem ~100 bytes.
//
// É contagem + maior carimbo de cada tabela: o carimbo pega criação e edição,
// a contagem pega exclusão (apagar uma linha não mexe em timestamp nenhum).
// As tabelas de junção (checklist, membros) entram só pela contagem, porque
// não têm data — mas toda alteração delas passa por uma rota que carimba o
// updated_at do pai, então a mudança aparece de um jeito ou de outro.
//
// task_views fica DE FORA de propósito: abrir uma atividade não é novidade
// para mais ninguém, e incluí-la faria cada leitura recarregar o app inteiro.
const PULSE_SQL = `
  SELECT (SELECT count(*) FROM tasks)            AS tarefas_n,
         (SELECT max(greatest(created_at, coalesce(updated_at, created_at))) FROM tasks)    AS tarefas_t,
         (SELECT count(*) FROM projects)         AS projetos_n,
         (SELECT max(greatest(created_at, coalesce(updated_at, created_at))) FROM projects) AS projetos_t,
         (SELECT count(*) FROM changes)          AS mudancas_n,
         (SELECT max(greatest(published_at, coalesce(edited_at, published_at),
                              coalesce(decided_at, published_at))) FROM changes)            AS mudancas_t,
         (SELECT count(*) FROM change_acks)      AS ciencias_n,
         (SELECT max(coalesce(confirmed_at, sent_at)) FROM change_acks)                     AS ciencias_t,
         (SELECT count(*) FROM time_sessions)    AS sessoes_n,
         (SELECT max(greatest(start_at, coalesce(end_at, start_at))) FROM time_sessions)    AS sessoes_t,
         (SELECT count(*) FROM folders)          AS pastas_n,
         (SELECT count(*) FROM users)            AS usuarios_n,
         (SELECT count(*) FROM checklist_items)  AS checklist_n,
         (SELECT count(*) FROM task_members)     AS membros_tarefa_n,
         (SELECT count(*) FROM project_members)  AS membros_projeto_n
`

app.get('/api/pulse', wrap(async (_req, res) => {
  const [row] = await q(PULSE_SQL)
  // Uma string só: o front compara por igualdade, não interpreta o conteúdo.
  const v = Object.keys(row).sort().map(k => {
    const val = row[k]
    return val instanceof Date ? val.getTime() : (val ?? 0)
  }).join('.')
  res.json({ v })
}))

// Quem sou eu (valida o token e restaura a sessão no front).
app.get('/api/auth/me', wrap(async (req, res) => {
  const [user] = await q(`SELECT ${PUBLIC_USER} FROM users WHERE id = $1`, [req.userId])
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' })
  res.json(user)
}))

// Trocar a própria senha.
app.post('/api/auth/change-password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'A nova senha precisa ter ao menos 6 caracteres.' })
  const [row] = await q('SELECT password_hash FROM users WHERE id = $1', [req.userId])
  if (!row || !row.password_hash || !(await verifyPassword(currentPassword || '', row.password_hash))) {
    return res.status(401).json({ error: 'Senha atual incorreta.' })
  }
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [req.userId, await hashPassword(newPassword)])
  res.json({ ok: true })
}))

// Carga inicial do app — tudo num request só.
// Admin recebe tudo; os demais recebem SOMENTE os projetos em que foram
// incluídos (e as tarefas/sessões/pastas correspondentes). O filtro é aqui,
// no servidor: esconder no front deixaria os dados trafegarem mesmo assim.
// As seis listas vão numa CONSULTA SÓ. Medindo contra o Neon, um `SELECT 1`
// leva ~234 ms: a latência da ida e volta domina, e o trabalho de cada
// consulta é quase nada (a maior, tasks, gasta ~140 ms além da latência).
// Eram 7 idas para admin e 8 para os demais (6 listas + o visibleProjectIds,
// que roda em série antes); passam a ser 2 e 3. O `ids` entra como parâmetro,
// e `$1 IS NULL` cobre o admin, que não filtra nada.
//
// Montado sob demanda, e não numa const no topo: o CHANGE_SELECT é declarado
// mais abaixo no arquivo, e interpolá-lo aqui na carga do módulo estouraria
// em temporal dead zone antes do servidor subir.
let sqlBootstrap = null
const montarBootstrapSql = () => (sqlBootstrap ??= `
  SELECT
    (SELECT COALESCE(json_agg(u), '[]'::json) FROM (SELECT ${LIST_USER} FROM users ORDER BY id) u)                                  AS users,
    (SELECT COALESCE(json_agg(p), '[]'::json) FROM (${PROJECT_SELECT} WHERE $1::text[] IS NULL OR id = ANY($1) ORDER BY position, id) p)      AS projects,
    (SELECT COALESCE(json_agg(t), '[]'::json) FROM (${TASK_SELECT} WHERE $1::text[] IS NULL OR t.project_id = ANY($1) ORDER BY t.id) t)       AS tasks,
    (SELECT COALESCE(json_agg(s), '[]'::json) FROM (${SESSION_SELECT} WHERE $1::text[] IS NULL OR task_id IN (SELECT id FROM tasks WHERE project_id = ANY($1)) ORDER BY start_at) s) AS sessions,
    (SELECT COALESCE(json_agg(f), '[]'::json) FROM (${FOLDER_SELECT} ORDER BY position, name) f)                                    AS folders,
    (SELECT COALESCE(json_agg(c), '[]'::json) FROM (${CHANGE_SELECT} WHERE $1::text[] IS NULL OR c.project_id = ANY($1) ORDER BY c.published_at DESC) c) AS changes
`)

app.get('/api/bootstrap', wrap(async (req, res) => {
  const ids = await visibleProjectIds(req.userId)   // null = admin (sem filtro)
  const all = ids === null

  const [linha] = await q(montarBootstrapSql(), [ids])
  const tasks = (linha.tasks || []).map(mapTask)
  const sessions = (linha.sessions || []).map(mapSession)
  const changes = (linha.changes || []).map(mapChange)
  const projects = linha.projects || []
  const folders = linha.folders || []

  res.json({
    users: linha.users || [], projects, tasks, sessions, changes,
    folders: all ? folders : foldersWithProjects(folders, projects),
  })
}))

// Gerenciamento de usuários/profissionais: só administradores.
app.get('/api/users', requireAdmin, wrap(async (_req, res) => {
  res.json(await q(`SELECT ${LIST_USER} FROM users ORDER BY id`))
}))

app.post('/api/users', requireAdmin, wrap(async (req, res) => {
  const { name, phone, shortName, email, sector = null, formation = null, professionalRegister = null, initials = '', color = 'var(--proj-blue)', isAdmin = false, isActive = true, isOutsourced = false, initialPassword } = req.body || {}
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim()
  if (!cleanName || !cleanEmail) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' })

  // Verifica se e-mail já existe (case-insensitive, como no login)
  const [existing] = await q('SELECT id FROM users WHERE lower(email) = lower($1)', [cleanEmail])
  if (existing) return res.status(409).json({ error: `O e-mail "${cleanEmail}" já está em uso.` })

  const id = genId('u')
  const finalInitials = String(initials || '').trim() || (() => {
    const parts = cleanName.split(/\s+/).filter(Boolean)
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  })().toUpperCase()

  const passwordToUse = typeof initialPassword === 'string' ? initialPassword.trim() : ''
  // Terceirizado entra só para controle: sem senha, não acessa o sistema.
  if (!isOutsourced && passwordToUse.length < 6) return res.status(400).json({ error: 'A senha inicial precisa ter ao menos 6 caracteres.' })
  const passwordHash = isOutsourced ? null : await hashPassword(passwordToUse)
  await q(`
    INSERT INTO users (id, name, initials, color, email, phone, short_name, sector, formation, professional_register, is_admin, is_active, is_outsourced, password_hash, is_dev)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false)
  `, [id, cleanName, finalInitials, color || 'var(--proj-blue)', cleanEmail, phone || null, shortName || null, sector || null, normFormacao(formation), normRegistro(formation, professionalRegister), !!isAdmin, isActive !== false, !!isOutsourced, passwordHash])

  const [row] = await q(`SELECT ${LIST_USER} FROM users WHERE id = $1`, [id])
  res.status(201).json(row)
}))

app.put('/api/users/:id', requireAdmin, wrap(async (req, res) => {
  const { name, phone, shortName, email, sector = null, formation = null, professionalRegister = null, initials = '', color = 'var(--proj-blue)', isAdmin = false, isActive = true, isOutsourced = false, initialPassword } = req.body || {}
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim()
  if (!cleanName || !cleanEmail) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' })

  const [target] = await q('SELECT is_admin AS "isAdmin", is_active AS "isActive" FROM users WHERE id = $1', [req.params.id])
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' })

  const nextIsAdmin = !!isAdmin
  const nextIsActive = isActive !== false
  const isSelf = req.userId === req.params.id

  // Um admin nunca pode tirar a própria permissão — só outro admin pode fazer
  // isso, senão a conta se tranca fora do próprio sistema.
  if (isSelf && target.isAdmin && !nextIsAdmin) {
    return res.status(400).json({ error: 'Você não pode remover sua própria permissão de administrador.' })
  }
  // Ninguém desativa a própria conta — pelo mesmo motivo: ficaria sem acesso
  // sem ter como reverter sozinho.
  if (isSelf && target.isActive && !nextIsActive) {
    return res.status(400).json({ error: 'Você não pode desativar sua própria conta.' })
  }

  // O sistema nunca pode ficar sem nenhum administrador ativo: bloqueia tanto
  // tirar o "is_admin" quanto inativar quem for o último admin ativo restante.
  const wasActiveAdmin = target.isAdmin && target.isActive
  const willBeActiveAdmin = nextIsAdmin && nextIsActive
  if (wasActiveAdmin && !willBeActiveAdmin) {
    const [{ count }] = await q('SELECT count(*)::int AS count FROM users WHERE is_admin = true AND is_active = true')
    if (count <= 1) {
      return res.status(400).json({ error: 'Não é possível remover o último administrador ativo do sistema. Promova outra pessoa antes de continuar.' })
    }
  }

  // Verifica se e-mail já existe em outro usuário (case-insensitive, como no login)
  const [existing] = await q('SELECT id FROM users WHERE lower(email) = lower($1) AND id != $2', [cleanEmail, req.params.id])
  if (existing) return res.status(409).json({ error: `O e-mail "${cleanEmail}" já está em uso.` })

  const finalInitials = String(initials || '').trim() || (() => {
    const parts = cleanName.split(/\s+/).filter(Boolean)
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  })().toUpperCase()

  if (typeof initialPassword === 'string' && initialPassword.trim() && initialPassword.trim().length < 6) {
    return res.status(400).json({ error: 'A senha inicial precisa ter ao menos 6 caracteres.' })
  }
  const passwordHash = typeof initialPassword === 'string' && initialPassword.trim() ? await hashPassword(initialPassword.trim()) : null
  await q(`
    UPDATE users
    SET name = $2,
        initials = $3,
        color = $4,
        email = $5,
        phone = $6,
        short_name = $7,
        sector = $8,
        formation = $9,
        professional_register = $10,
        is_admin = $11,
        is_active = $12,
        is_outsourced = $13${passwordHash ? ', password_hash = $14' : ''}
    WHERE id = $1
  `, passwordHash ? [req.params.id, cleanName, finalInitials, color || 'var(--proj-blue)', cleanEmail, phone || null, shortName || null, sector || null, normFormacao(formation), normRegistro(formation, professionalRegister), !!isAdmin, isActive !== false, !!isOutsourced, passwordHash] : [req.params.id, cleanName, finalInitials, color || 'var(--proj-blue)', cleanEmail, phone || null, shortName || null, sector || null, normFormacao(formation), normRegistro(formation, professionalRegister), !!isAdmin, isActive !== false, !!isOutsourced])

  const [row] = await q(`SELECT ${LIST_USER} FROM users WHERE id = $1`, [req.params.id])
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado.' })
  res.json(row)
}))

// Exclusão definitiva de um profissional. Sessões de cronômetro e vínculos
// de projeto/tarefa desse usuário são apagados/desvinculados em cascata pelo
// próprio banco (ON DELETE); não há checagem de histórico aqui de propósito.
app.delete('/api/users/:id', requireAdmin, wrap(async (req, res) => {
  const [target] = await q('SELECT is_admin AS "isAdmin", is_active AS "isActive" FROM users WHERE id = $1', [req.params.id])
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' })

  if (req.userId === req.params.id) {
    return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' })
  }
  if (target.isAdmin && target.isActive) {
    const [{ count }] = await q('SELECT count(*)::int AS count FROM users WHERE is_admin = true AND is_active = true')
    if (count <= 1) {
      return res.status(400).json({ error: 'Não é possível excluir o último administrador ativo do sistema. Promova outra pessoa antes de continuar.' })
    }
  }

  try {
    await q('DELETE FROM users WHERE id = $1', [req.params.id])
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Não é possível excluir: este profissional publicou ou editou uma mudança registrada no sistema, e esse histórico precisa ser mantido. Inative o profissional em vez de excluir.' })
    }
    throw e
  }
  res.status(204).end()
}))

// ----- projetos -----
app.get('/api/projects', wrap(async (req, res) => {
  const ids = await visibleProjectIds(req.userId)
  res.json(ids === null
    ? await q(`${PROJECT_SELECT} ORDER BY position, id`)
    : await q(`${PROJECT_SELECT} WHERE id = ANY($1) ORDER BY position, id`, [ids]))
}))

// Criar projeto: só administradores. Já grava papel padrão e exceções por pessoa.
app.post('/api/projects', requireAdmin, wrap(async (req, res) => {
  const {
    name, desc = '', color = 'indigo', folderId = null, start, end, notes = '', resources = [], defaultRole = 'full', members = [],
    prefeitura = '', secretaria = '', origemRecurso, valorEstimado, valorOrcado, status, responsibleIds = [],
  } = req.body
  try {
  const id = genId('p')
  
  await tx(async (client) => {
    const [{ position }] = await client.query(
      'SELECT COALESCE(max(position), -1) + 1 AS position FROM projects WHERE folder_id IS NOT DISTINCT FROM $1',
      [folderId || null]
    ).then(result => result.rows)
    const clean = normalizeResources(resources)
    await client.query(
      `INSERT INTO projects (id, name, description, color, folder_id, position, start_date, end_date, notes, resources,
                            prefeitura, secretaria, origem_recurso, valor_convenio, valor_disponivel, status, responsible_ids, default_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [id, name, desc, color, folderId || null, position, start, end, notes, JSON.stringify(clean),
       String(prefeitura || '').trim(), String(secretaria || '').trim(), normOrigem(origemRecurso),
       normValor(valorEstimado), normValor(valorOrcado), normProjStatus(status),
       JSON.stringify(normResponsibles(responsibleIds)), normDefaultRole(defaultRole)]
    )
    await replaceMembers(client, id, members)
  })

  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [id])
  return res.status(201).json(row)

} catch (error) {
  console.error('Erro ao criar projeto:', error)
  return res.status(500).json({ 
    error: 'Erro interno ao salvar o projeto.',
    details: error.message 
  })
}
}))

// Mover/reordenar projetos: só administradores. Recebe a pasta de destino
// (folderId, null = solto) e a lista ordenada dos ids daquele grupo.
app.put('/api/projects/reorder', requireAdmin, wrap(async (req, res) => {
  const folderId = req.body.folderId || null
  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : []
  if (folderId) {
    const [folder] = await q('SELECT id FROM folders WHERE id = $1', [folderId])
    if (!folder) return res.status(400).json({ error: 'Pasta de destino não encontrada.' })
  }
  await tx(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query('UPDATE projects SET folder_id = $2, position = $3 WHERE id = $1', [orderedIds[i], folderId, i])
    }
  })
  res.status(204).end()
}))

// Editar projeto: precisa de Edição total. Papel padrão e exceções (permissões)
// só são alterados por administradores.
app.put('/api/projects/:id', gate((req) => req.params.id, CAN.edit), wrap(async (req, res) => {
  const {
    name, desc = '', color, folderId = null, start, end, notes = '', resources = [], defaultRole, members,
    prefeitura = '', secretaria = '', origemRecurso, valorEstimado, valorOrcado, status, responsibleIds = [],
  } = req.body
  const clean = normalizeResources(resources)
  const isAdmin = req.projectRole === 'admin'
  const ok = await tx(async (client) => {
    const r = await client.query(
      `UPDATE projects SET name = $2, description = $3, color = $4, folder_id = $5, start_date = $6, end_date = $7, notes = $8, resources = $9,
                           prefeitura = $10, secretaria = $11, origem_recurso = $12, valor_convenio = $13, valor_disponivel = $14, status = $15, responsible_ids = $16,
                           updated_at = now()
       WHERE id = $1 RETURNING id`,
      [req.params.id, name, desc, color, folderId || null, start, end, notes, JSON.stringify(clean),
       String(prefeitura || '').trim(), String(secretaria || '').trim(), normOrigem(origemRecurso), normValor(valorEstimado), normValor(valorOrcado), normProjStatus(status), JSON.stringify(normResponsibles(responsibleIds))]
    )
    if (!r.rows.length) return false
    await pruneOrphanFiles(client, req.params.id, clean) // remove arquivos não referenciados
    if (isAdmin) {
      if (defaultRole !== undefined) {
        await client.query('UPDATE projects SET default_role = $2 WHERE id = $1', [req.params.id, normDefaultRole(defaultRole)])
      }
      if (Array.isArray(members)) await replaceMembers(client, req.params.id, members)
    }
    return true
  })
  if (!ok) return res.status(404).json({ error: 'Projeto não encontrado.' })
  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [req.params.id])
  res.json(row)
}))

// Excluir projeto: só administradores. tasks/checklist/membros/sessões/arquivos caem por CASCADE.
app.delete('/api/projects/:id', gate((req) => req.params.id, CAN.adminOnly), wrap(async (req, res) => {
  const rows = await q('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Projeto não encontrado.' })
  res.status(204).end()
}))

// Adicionar um material (link) — permitido também para 'Só exibição'.
app.post('/api/projects/:id/resources', gate((req) => req.params.id, CAN.light), wrap(async (req, res) => {
  const built = normalizeResources([req.body])[0]
  if (!built) return res.status(400).json({ error: 'Recurso inválido.' })
  const ok = await tx(async (client) => {
    const pr = await client.query('SELECT resources FROM projects WHERE id = $1', [req.params.id])
    if (!pr.rows.length) return false
    const current = Array.isArray(pr.rows[0].resources) ? pr.rows[0].resources : []
    const next = normalizeResources([...current, built])
    await client.query('UPDATE projects SET resources = $2 WHERE id = $1', [req.params.id, JSON.stringify(next)])
    return true
  })
  if (!ok) return res.status(404).json({ error: 'Projeto não encontrado.' })
  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [req.params.id])
  res.status(201).json(row)
}))

// Remover um material — exige Edição total (viewers só podem adicionar).
app.delete('/api/projects/:id/resources/:rid', gate((req) => req.params.id, CAN.edit), wrap(async (req, res) => {
  const ok = await tx(async (client) => {
    const pr = await client.query('SELECT resources FROM projects WHERE id = $1', [req.params.id])
    if (!pr.rows.length) return false
    const current = Array.isArray(pr.rows[0].resources) ? pr.rows[0].resources : []
    const next = normalizeResources(current.filter((r) => r.id !== req.params.rid))
    await client.query('UPDATE projects SET resources = $2 WHERE id = $1', [req.params.id, JSON.stringify(next)])
    await pruneOrphanFiles(client, req.params.id, next)
    return true
  })
  if (!ok) return res.status(404).json({ error: 'Projeto não encontrado.' })
  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [req.params.id])
  res.json(row)
}))

// ----- pastas (agrupam projetos na sidebar) -----
app.get('/api/folders', wrap(async (_req, res) => {
  res.json(await q(`${FOLDER_SELECT} ORDER BY position, name`))
}))

// Criar pasta: só administradores. Entra no fim da lista (maior position + 1).
app.post('/api/folders', requireAdmin, wrap(async (req, res) => {
  const name = (req.body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Informe um nome para a pasta.' })
  // parentId = pasta-mãe (subpasta). NULL = pasta na raiz.
  const parentId = req.body.parentId || null
  if (parentId) {
    const [parent] = await q('SELECT id FROM folders WHERE id = $1', [parentId])
    if (!parent) return res.status(400).json({ error: 'Pasta-mãe não encontrada.' })
  }
  const id = genId('fd')
  const [{ next }] = await q('SELECT COALESCE(max(position), 0) + 1 AS next FROM folders')
  await q('INSERT INTO folders (id, name, position, parent_id) VALUES ($1, $2, $3, $4)', [id, name, next, parentId])
  const [row] = await q(`${FOLDER_SELECT} WHERE id = $1`, [id])
  res.status(201).json(row)
}))

// Mover/reordenar pastas: só administradores. Recebe a pasta-mãe de destino
// (parentId, null = raiz) e a lista ordenada dos ids daquele grupo de irmãs.
// Reatribui parent_id e position de todas de uma vez.
app.put('/api/folders/reorder', requireAdmin, wrap(async (req, res) => {
  const parentId = req.body.parentId || null
  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : []
  // Impede ciclo: uma pasta não pode virar filha dela mesma nem de uma descendente.
  if (parentId) {
    const all = await q('SELECT id, parent_id AS "parentId" FROM folders')
    const byId = new Map(all.map(f => [f.id, f]))
    for (const movedId of orderedIds) {
      for (let cur = parentId, guard = 0; cur && guard < 1000; cur = byId.get(cur)?.parentId, guard++) {
        if (cur === movedId) return res.status(400).json({ error: 'Não dá para mover uma pasta para dentro dela mesma.' })
      }
    }
  }
  await tx(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query('UPDATE folders SET parent_id = $2, position = $3 WHERE id = $1', [orderedIds[i], parentId, i])
    }
  })
  res.status(204).end()
}))

// Renomear pasta: só administradores.
app.put('/api/folders/:id', requireAdmin, wrap(async (req, res) => {
  const name = (req.body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Informe um nome para a pasta.' })
  const rows = await q('UPDATE folders SET name = $2 WHERE id = $1 RETURNING id', [req.params.id, name])
  if (!rows.length) return res.status(404).json({ error: 'Pasta não encontrada.' })
  const [row] = await q(`${FOLDER_SELECT} WHERE id = $1`, [req.params.id])
  res.json(row)
}))

// Excluir pasta: só administradores. Os projetos dentro dela viram "soltos"
// (folder_id = NULL por causa do ON DELETE SET NULL), não são apagados.
app.delete('/api/folders/:id', requireAdmin, wrap(async (req, res) => {
  const rows = await q('DELETE FROM folders WHERE id = $1 RETURNING id', [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Pasta não encontrada.' })
  res.status(204).end()
}))

// ----- arquivos (documentos/imagens enviados, guardados como bytea no Postgres) -----
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB

// Upload de um arquivo para um projeto. O corpo da requisição é o arquivo cru
// (express.raw); os metadados vêm na query (?kind, ?filename, ?label). Cria a
// linha em `files` e adiciona um recurso correspondente em projects.resources.
app.post('/api/projects/:id/files',
  gate((req) => req.params.id, CAN.light),
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  wrap(async (req, res) => {
    const buffer = req.body
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      return res.status(400).json({ error: 'Arquivo vazio ou inválido.' })
    }
    if (buffer.length > MAX_FILE_BYTES) {
      return res.status(413).json({ error: 'Arquivo maior que o limite de 25 MB.' })
    }
    const kind = ['doc', 'image'].includes(req.query.kind) ? req.query.kind : 'doc'
    const filename = (req.query.filename || 'arquivo').toString().slice(0, 255)
    const label = (req.query.label || '').toString().trim()
    // mime real vem na query (o corpo é enviado como octet-stream — ver api.js).
    const mime = (req.query.mime || req.headers['content-type'] || 'application/octet-stream').toString()

    const fileId = genId('f')
    const resource = { id: genId('r'), type: kind, fileId, filename, mime, size: buffer.length, label }

    const updated = await tx(async (client) => {
      const pr = await client.query('SELECT resources FROM projects WHERE id = $1', [req.params.id])
      if (!pr.rows.length) return false
      await client.query(
        'INSERT INTO files (id, project_id, filename, mime_type, size_bytes, data) VALUES ($1, $2, $3, $4, $5, $6)',
        [fileId, req.params.id, filename, mime, buffer.length, buffer]
      )
      const current = Array.isArray(pr.rows[0].resources) ? pr.rows[0].resources : []
      const next = normalizeResources([...current, resource])
      await client.query('UPDATE projects SET resources = $2 WHERE id = $1', [req.params.id, JSON.stringify(next)])
      return true
    })
    if (!updated) return res.status(404).json({ error: 'Projeto não encontrado.' })
    const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [req.params.id])
    res.status(201).json(row)
  })
)

// Baixa/serve um arquivo pelo id. Aceita ?token= (para <img>/<a>).
app.get('/api/files/:id', wrap(async (req, res) => {
  const [file] = await q('SELECT filename, mime_type, data FROM files WHERE id = $1', [req.params.id])
  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado.' })
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream')
  // inline: imagens/PDF abrem no navegador; outros tipos o navegador decide.
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename || 'arquivo')}"`)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.send(file.data)
}))

// ----- tarefas -----
app.get('/api/tasks', wrap(async (req, res) => {
  res.json(await listTasks(await visibleProjectIds(req.userId)))
}))

app.post('/api/tasks', gate((req) => req.body.projectId, CAN.edit), wrap(async (req, res) => {
  const { projectId, title, assigneeId, status = 'todo', priority = 'medium', start, end, checklist = [], memberIds = [] } = req.body
  const id = genId('t')
  await tx(async (client) => {
    await client.query(
      `INSERT INTO tasks (id, project_id, title, assignee_id, status, priority, start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, projectId, title, assigneeId || null, status, priority, start, end, req.userId]
    )
    await replaceChildren(client, id, checklist, memberIds, assigneeId)
  })
  res.status(201).json(await getTask(id))
}))

app.put('/api/tasks/:id', gate(taskProjectId, CAN.edit), wrap(async (req, res) => {
  const { projectId, title, assigneeId, status, priority, start, end, checklist = [], memberIds = [] } = req.body
  const id = req.params.id
  const updated = await tx(async (client) => {
    const r = await client.query(
      `UPDATE tasks SET project_id = $2, title = $3, assignee_id = $4, status = $5, priority = $6, start_date = $7, end_date = $8,
              updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id, projectId, title, assigneeId || null, status, priority, start, end]
    )
    if (!r.rows.length) return false
    await replaceChildren(client, id, checklist, memberIds, assigneeId)
    return true
  })
  if (!updated) return res.status(404).json({ error: 'Atividade não encontrada.' })
  res.json(await getTask(id))
}))

// Mover entre colunas do Kanban (só o status) — permitido para 'Só exibição'.
app.patch('/api/tasks/:id/status', gate(taskProjectId, CAN.light), wrap(async (req, res) => {
  const rows = await q('UPDATE tasks SET status = $2, updated_at = now() WHERE id = $1 RETURNING id', [req.params.id, req.body.status])
  if (!rows.length) return res.status(404).json({ error: 'Atividade não encontrada.' })
  res.json(await getTask(req.params.id))
}))

// Mexer em itens de checklist que já existem (não cria nem remove).
//
// Marcar, mover o estado e assumir um item continuam liberados para 'Só
// exibição': quem faz o serviço registra que fez. Mudar o TEXTO não — isso é
// redefinir qual é o serviço, e pede Edição total. A permissão só é cobrada
// quando o texto realmente muda, porque em alguns caminhos o cliente manda o
// item inteiro de volta sem querer editar nada.
app.patch('/api/tasks/:id/checklist', gate(taskProjectId, CAN.light), wrap(async (req, res) => {
  const { checklist = [] } = req.body
  // Quem pode assumir um item: só quem participa da atividade. O seletor no
  // front já mostra apenas eles, mas o servidor confere de novo.
  const [dono] = await q('SELECT assignee_id FROM tasks WHERE id = $1', [req.params.id])
  if (!dono) return res.status(404).json({ error: 'Atividade não encontrada.' })
  const membros = await q('SELECT user_id FROM task_members WHERE task_id = $1', [req.params.id])
  const podeAssumir = new Set([dono.assignee_id, ...membros.map(m => m.user_id)].filter(Boolean))

  // Confere a permissão de texto ANTES da transação: barrar no meio dela
  // significaria desfazer marcações que já teriam sido aplicadas.
  const comTexto = checklist.filter(i => i && i.id && typeof i.text === 'string' && i.text.trim())
  if (comTexto.length) {
    const atuais = await q('SELECT id, text FROM checklist_items WHERE task_id = $1 AND id = ANY($2::text[])',
      [req.params.id, comTexto.map(i => i.id)])
    const antes = new Map(atuais.map(r => [r.id, r.text]))
    const mudou = comTexto.some(i => antes.has(i.id) && antes.get(i.id) !== i.text.trim())
    if (mudou && !CAN.edit.includes(req.projectRole)) {
      return res.status(403).json({ error: 'Só quem tem edição total pode mudar o texto de um item.' })
    }
  }

  await tx(async (client) => {
    for (const item of checklist) {
      if (!item || !item.id) continue
      // Cada campo só é tocado quando vem no corpo: marcar não desfaz a
      // atribuição, e atribuir não mexe no que já está marcado.
      // Estado manda; `done` é o espelho dele. O ramo do 'done' sozinho é o
      // caminho antigo (marcar/desmarcar), que continua valendo.
      if ('state' in item && ESTADOS_ITEM.includes(item.state)) {
        await client.query("UPDATE checklist_items SET state = $2, done = ($2 = 'done') WHERE id = $1 AND task_id = $3",
          [item.id, item.state, req.params.id])
      } else if ('done' in item) {
        await client.query("UPDATE checklist_items SET done = $2, state = CASE WHEN $2 THEN 'done' ELSE 'todo' END WHERE id = $1 AND task_id = $3",
          [item.id, !!item.done, req.params.id])
      }
      if (typeof item.text === 'string' && item.text.trim()) {
        await client.query('UPDATE checklist_items SET text = $2 WHERE id = $1 AND task_id = $3',
          [item.id, item.text.trim(), req.params.id])
      }
      if ('assigneeId' in item) {
        const novo = podeAssumir.has(item.assigneeId) ? item.assigneeId : null
        await client.query('UPDATE checklist_items SET assignee_id = $2 WHERE id = $1 AND task_id = $3', [item.id, novo, req.params.id])
      }
    }
    await client.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [req.params.id])
    await ajustarStatusPeloChecklist(client, req.params.id)
  })
  res.json(await getTask(req.params.id))
}))

// Quando a atividade TEM checklist, o status espelha o checklist:
//
//   tudo concluído          → Concluído
//   algum em diligência     → Em diligência
//   algum em revisão        → Em revisão
//   algum concluído         → Em andamento
//   nenhum                  → A fazer
//
// Diligência vence revisão porque é o estado que custa mais caro: revisão é
// leitura interna, diligência é pendência que veio de fora e trava a entrega.
// Quem olha a etapa precisa ver a pior notícia, não a média.
//
// O cálculo do progresso (src/data/progresso.js) já contava checklist inteiro
// marcado como concluído, mas a COLUNA status ficava para trás — o Panorama
// dava a atividade por encerrada enquanto o Kanban ainda a mostrava em "A
// fazer". Isto faz o status acompanhar de fato.
//
// A regra é simétrica de propósito. Uma primeira versão só promovia (e
// rebaixava de Concluído para Em andamento), para não desfazer um "em
// andamento" posto à mão. O efeito prático foi pior: desmarcar tudo deixava a
// etapa em Em andamento, e ela sumia de onde a pessoa ia procurá-la. Espelhar
// é mais previsível — e só acontece quando alguém mexe no checklist, nunca
// por conta própria.
//
// Fica no servidor, e não no front, para valer venha a marcação de onde vier.
async function ajustarStatusPeloChecklist(client, taskId) {
  const { rows: [t] } = await client.query('SELECT status FROM tasks WHERE id = $1', [taskId])
  if (!t) return
  const { rows: [c] } = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE state = 'done')::int       AS feitos,
            count(*) FILTER (WHERE state = 'review')::int     AS revisao,
            count(*) FILTER (WHERE state = 'diligence')::int  AS diligencia
       FROM checklist_items WHERE task_id = $1`,
    [taskId]
  )
  if (!c.total) return                               // sem checklist: nada a inferir
  const novo = c.feitos === c.total ? 'done'
    : c.diligencia ? 'diligence'
    : c.revisao ? 'review'
    : c.feitos ? 'progress'
    : 'todo'
  if (novo === t.status) return
  await client.query('UPDATE tasks SET status = $2 WHERE id = $1', [taskId, novo])
}

// Entrar/sair de uma atividade — o usuário gerencia só a SUA participação.
// Permitido para 'Só exibição'; adicionar/remover outras pessoas exige Edição total.
app.post('/api/tasks/:id/membership', gate(taskProjectId, CAN.light), wrap(async (req, res) => {
  const { join } = req.body
  const [t] = await q('SELECT assignee_id FROM tasks WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Atividade não encontrada.' })
  if (join) {
    if (t.assignee_id !== req.userId) {
      await q('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, req.userId])
    }
  } else {
    await q('DELETE FROM task_members WHERE task_id = $1 AND user_id = $2', [req.params.id, req.userId])
  }
  await q('UPDATE tasks SET updated_at = now() WHERE id = $1', [req.params.id])
  res.json(await getTask(req.params.id))
}))

// Criar as etapas que faltam no projeto, de uma vez. Idempotente: só insere o
// que ainda não existe, então clicar duas vezes não duplica — que é justamente
// como a equipe acabou com "9 · Diligências" repetida em três projetos.
//
// São três idas ao banco: conferir o projeto, inserir, reler o que entrou.
// Antes eram ~15 — uma consulta para listar os títulos existentes e, dentro de
// uma transação, um INSERT por etapa. Com o Postgres do outro lado da rede o
// custo é quase todo de ida e volta, então criar as 11 etapas levava segundos
// de espera. O filtro do que já existe virou o NOT EXISTS do próprio INSERT, e
// as 11 linhas entram de uma vez — um único INSERT já é atômico, sem transação.
// adminOnly, nao CAN.edit: montar o template nao e trabalhar no projeto, e
// decidir que ele segue o processo das 11 etapas. Quem e 'full' executa as
// etapas; quem as cria e a coordenacao. Enquanto isto era CAN.edit, qualquer
// membro criava — e era assim que um projeto ganhava etapa repetida.
app.post('/api/projects/:id/stages', gate((req) => req.params.id, CAN.adminOnly), wrap(async (req, res) => {
  const [p] = await q("SELECT to_char(COALESCE(start_date, now()::date), 'YYYY-MM-DD') AS inicio FROM projects WHERE id = $1", [req.params.id])
  if (!p) return res.status(404).json({ error: 'Projeto não encontrado.' })

  const titulos = ETAPAS_PADRAO.map((nome, i) => `${i} · ${nome}`)
  const ids = titulos.map(() => genId('t'))
  const novas = await q(
    `INSERT INTO tasks (id, project_id, title, status, priority, start_date, end_date, created_by)
     SELECT e.id, $1, e.title, 'todo', 'medium', $2::date, $2::date + $3::int, $4
     FROM unnest($5::text[], $6::text[]) AS e(id, title)
     WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = $1 AND t.title = e.title)
     RETURNING id`,
    [req.params.id, p.inicio, DIAS_PRAZO_ATIVIDADE, req.userId, ids, titulos])

  // Devolve as etapas prontas. Sem isto o cliente só sabia quantas foram e
  // precisava recarregar o bootstrap inteiro (54 KB) para enxergar 11 linhas.
  const tasks = novas.length
    ? (await q(`${TASK_SELECT} WHERE t.id = ANY($1) ORDER BY t.id`, [novas.map(r => r.id)])).map(mapTask)
    : []
  res.json({ criadas: novas.length, jaExistiam: ETAPAS_PADRAO.length - novas.length, tasks })
}))

// Acrescentar um item ao checklist de uma atividade. Exige Edição total: o
// item é trabalho novo, diferente de MARCAR um item existente (que 'Só
// exibição' pode fazer, pela rota PATCH).
app.post('/api/tasks/:id/checklist', gate(taskProjectId, CAN.edit), wrap(async (req, res) => {
  const text = String(req.body.text || '').trim()
  if (!text) return res.status(400).json({ error: 'Escreva o que precisa ser feito.' })

  const [t] = await q('SELECT assignee_id, project_id FROM tasks WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Atividade não encontrada.' })

  // Aqui o dono pode ser QUALQUER pessoa da equipe do projeto, não só quem já
  // está na etapa: uma etapa recém-criada não tem ninguém, e exigir que a
  // pessoa entrasse antes deixaria o seletor vazio justo na hora de distribuir
  // o trabalho. Quem for escolhido entra na etapa (task_members) — sem isso a
  // atribuição não passaria na validação das outras rotas.
  const daEquipe = await q(
    `SELECT user_id FROM project_members WHERE project_id = $1
     UNION SELECT id FROM users WHERE is_admin`, [t.project_id])
  const podeAssumir = new Set([t.assignee_id, ...daEquipe.map(m => m.user_id)].filter(Boolean))
  const dono = podeAssumir.has(req.body.assigneeId) ? req.body.assigneeId : null

  await tx(async (client) => {
    if (dono && dono !== t.assignee_id) {
      await client.query('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, dono])
    }
    const { rows: [pos] } = await client.query(
      'SELECT COALESCE(max(position), -1) + 1 AS n FROM checklist_items WHERE task_id = $1', [req.params.id])
    await client.query(
      'INSERT INTO checklist_items (id, task_id, text, done, position, assignee_id) VALUES ($1, $2, $3, false, $4, $5)',
      [genId('c'), req.params.id, text, pos.n, dono])
    await client.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [req.params.id])
    // Item novo numa etapa concluída a devolve para "em andamento".
    await ajustarStatusPeloChecklist(client, req.params.id)
  })
  res.status(201).json(await getTask(req.params.id))
}))

// Registrar que a pessoa ABRIU a atividade. Não é edição — 'Só exibição'
// também marca. É o "acessado" que segura a notificação da atividade que a
// própria pessoa criou para si (ver as notificações em App.jsx).
app.post('/api/tasks/:id/view', gate(taskProjectId, CAN.light), wrap(async (req, res) => {
  const rows = await q(
    `INSERT INTO task_views (task_id, user_id) VALUES ($1, $2)
     ON CONFLICT (task_id, user_id) DO UPDATE SET seen_at = now()
     RETURNING task_id`,
    [req.params.id, req.userId]
  )
  if (!rows.length) return res.status(404).json({ error: 'Atividade não encontrada.' })
  res.json(await getTask(req.params.id))
}))

app.delete('/api/tasks/:id', gate(taskProjectId, CAN.edit), wrap(async (req, res) => {
  const rows = await q('DELETE FROM tasks WHERE id = $1 RETURNING id', [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Atividade não encontrada.' })
  res.status(204).end()
}))

// ----- cronômetro (time sessions) -----
app.get('/api/sessions', wrap(async (req, res) => {
  res.json(await listSessions(await visibleProjectIds(req.userId)))
}))

// Inicia: fecha a sessão ativa do usuário (se houver) e abre uma nova.
app.post('/api/sessions/start', wrap(async (req, res) => {
  const { userId, taskId } = req.body
  await tx(async (client) => {
    await client.query('UPDATE time_sessions SET end_at = now() WHERE user_id = $1 AND end_at IS NULL', [userId])
    await client.query(
      'INSERT INTO time_sessions (id, user_id, task_id, start_at, end_at) VALUES ($1, $2, $3, now(), NULL)',
      [genId('s'), userId, taskId]
    )
  })
  res.status(201).json(await listSessions(await visibleProjectIds(req.userId)))
}))

// Para: fecha a sessão ativa do usuário.
app.post('/api/sessions/stop', wrap(async (req, res) => {
  await q('UPDATE time_sessions SET end_at = now() WHERE user_id = $1 AND end_at IS NULL', [req.body.userId])
  res.json(await listSessions(await visibleProjectIds(req.userId)))
}))

// ============================================================
// Mudanças do projeto (portado do sistema "controle-versoes")
//
// Uma MUDANÇA não é um arquivo, é uma orientação: "mudou o orçamento",
// "mudou a estrutura" — com título, data, descrição, de onde veio e quem
// vai executar. Não há revisão numerada nem versão vigente: a mudança mais
// recente é a que vale; as anteriores são histórico de comparação.
//
// Publicar é um ato TRIPLO, numa transação só:
//   1. grava a mudança;
//   2. cria a atividade no quadro, em nome de quem vai fazer;
//   3. abre a ciência ("eu vi") para a equipe do projeto, menos o autor.
//
// A ciência não trava ninguém — é registro. Serve para responder ao
// "eu não fui avisado" sem impedir o trabalho de andar.
// ============================================================

const SETORES = ['orcamento', 'arquitetura', 'projetos-prediais', 'projetos-eletricos', 'coordenacao', 'tecnologia-informacao']
const FORMACOES = ['sistemas-informacao', 'arquitetura', 'engenharia-civil', 'engenharia-eletrica']
const CHANGE_KINDS = ['requisicao', 'sugestao']
const URGENCIES = ['low', 'medium', 'high']
const normSetor = (v) => (SETORES.includes(v) ? v : null)
const normFormacao = (v) => (FORMACOES.includes(v) ? v : null)
// Sistemas de Informação não tem conselho: o registro só vale nas demais.
const normRegistro = (formacao, v) => (normFormacao(formacao) && formacao !== 'sistemas-informacao' && v ? v : null)
const normKind = (v) => (CHANGE_KINDS.includes(v) ? v : 'requisicao')
const normUrgency = (v) => (URGENCIES.includes(v) ? v : 'medium')

// Prazo (em dias) a partir do qual uma ciência pendente é cobrada.
const DIAS_PARA_COBRAR_CIENCIA = 2

// Prazo padrão da atividade criada junto com a mudança. A data pode ser
// ajustada depois na própria atividade; aqui só evita nascer sem prazo.
const DIAS_PRAZO_ATIVIDADE = 14

const CHANGE_SELECT = `
  SELECT c.id,
         c.project_id     AS "projectId",
         c.title,
         c.description,
         -- a coluna guarda o nome antigo; a API expõe "solicitante"
         c.origin          AS requester,
         c.kind,
         c.urgency,
         c.emitter_user_id AS "emitterUserId",
         c.emitter_sector  AS "emitterSector",
         c.target_sector   AS "targetSector",
            CASE WHEN c.target_sectors IS NULL OR jsonb_array_length(c.target_sectors) = 0
              THEN CASE WHEN c.target_sector IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(c.target_sector) END
              ELSE c.target_sectors END AS "targetSectors",
         c.target_user_ids AS "targetUserIds",
         c.decision,
         c.decided_by      AS "decidedBy",
         CASE WHEN c.decided_at IS NULL THEN NULL
              ELSE (extract(epoch FROM c.decided_at) * 1000)::bigint END AS "decidedAt",
         c.decision_reason AS "decisionReason",
         to_char(c.change_date, 'YYYY-MM-DD') AS "changeDate",
         c.responsible_id  AS "responsibleId",
         c.task_id         AS "taskId",
         c.checklist_item_id AS "checklistItemId",
         c.affects_budget  AS "affectsBudget",
         c.published_by    AS "publishedBy",
         (extract(epoch FROM c.published_at) * 1000)::bigint AS "publishedAt",
         c.edited_by       AS "editedBy",
         CASE WHEN c.edited_at IS NULL THEN NULL
              ELSE (extract(epoch FROM c.edited_at) * 1000)::bigint END AS "editedAt",
         COALESCE((
           SELECT json_agg(json_build_object(
                    'userId', a.user_id,
                    'sentAt', (extract(epoch FROM a.sent_at) * 1000)::bigint,
                    'confirmedAt', CASE WHEN a.confirmed_at IS NULL THEN NULL
                                        ELSE (extract(epoch FROM a.confirmed_at) * 1000)::bigint END)
                  ORDER BY a.user_id)
           FROM change_acks a WHERE a.change_id = c.id
         ), '[]'::json) AS acks
  FROM changes c`

// bigint volta como string no driver pg → converte o que for número.
const mapChange = (c) => ({
  ...c,
  publishedAt: Number(c.publishedAt),
  editedAt: c.editedAt === null ? null : Number(c.editedAt),
  decidedAt: c.decidedAt == null ? null : Number(c.decidedAt),
  acks: (c.acks || []).map(a => ({
    ...a,
    sentAt: Number(a.sentAt),
    confirmedAt: a.confirmedAt === null ? null : Number(a.confirmedAt),
  })),
})

async function listChanges(projectIds = null) {
  const rows = projectIds === null
    ? await q(`${CHANGE_SELECT} ORDER BY c.published_at DESC`)
    : await q(`${CHANGE_SELECT} WHERE c.project_id = ANY($1) ORDER BY c.published_at DESC`, [projectIds])
  return rows.map(mapChange)
}

async function getChange(id) {
  const rows = await q(`${CHANGE_SELECT} WHERE c.id = $1`, [id])
  return rows[0] ? mapChange(rows[0]) : null
}

// Quem deve dar ciência: a equipe do projeto, menos quem publicou.
// É a MESMA lista que dá acesso ao projeto — de propósito, para nunca existir
// alguém que enxerga o projeto sem ser avisado, nem o contrário.
async function abrirCiencia(client, changeId, projectId, autorId, targetSectors = [], targetUserIds = []) {
  const equipe = await client.query(
    `SELECT pm.user_id
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1 AND pm.user_id <> $2
        AND (u.sector = ANY($3::text[]) OR pm.user_id = ANY($4::text[]))`,
      [projectId, autorId, targetSectors, targetUserIds]
  )
  for (const m of equipe.rows) {
    // Reabre para quem já tinha confirmado: se o texto mudou, "eu vi" precisa
    // ser dito de novo, e o prazo de cobrança recomeça.
    await client.query(
      `INSERT INTO change_acks (change_id, user_id, sent_at, confirmed_at)
       VALUES ($1, $2, now(), NULL)
       ON CONFLICT (change_id, user_id)
       DO UPDATE SET sent_at = now(), confirmed_at = NULL`,
      [changeId, m.user_id]
    )
  }
}

// Etapas do processo, na ordem. Espelha ETAPAS_PADRAO de src/data/store.js —
// mexeu lá, mexa aqui. O título gravado é "<i> · <nome>", padrão que a aba
// Etapas lê para agrupar as atividades.
const ETAPAS_PADRAO = [
  'Contratação direta', 'Levantamento', 'Projetos', 'Orçamento',
  'Relatório fotográfico', 'ART e documentos', 'Licença ambiental',
  'Projeto básico', 'Protocolos', 'Diligências', 'Licitação',
]

// ---------- mudança vira item de checklist dentro de uma etapa ----------
//
// Uma mudança quase sempre acontece DENTRO de uma etapa: revisar o projeto
// elétrico é trabalho da etapa "2 · Projetos", não uma etapa nova. Por isso
// ela entra como item do checklist da etapa escolhida, em vez de virar mais
// um cartão solto no quadro.
//
// Atividade sem etapa escolhida vai para uma atividade-abrigo do projeto, que
// fica fora do template numerado e por isso aparece em "Outras atividades".
const TAREFA_SEM_ETAPA = 'Mudanças sem etapa'

// A urgência entra no PREFIXO porque item de checklist não tem campo de
// prioridade — sem isto uma requisição urgente viraria uma linha igual às
// outras, e o sinal de urgência se perderia por completo.
function tituloDoItem({ kind, urgency, title }) {
  const tipo = kind === 'sugestao' ? 'Sugestão' : 'Requisição'
  const urgente = normUrgency(urgency) === 'high' ? ' urgente' : ''
  return `[${tipo}${urgente}] ${String(title).trim()}`
}

// A etapa escolhida, ou a atividade-abrigo (criada na primeira necessidade).
async function hospedeiroDaMudanca(client, projectId, stageTaskId, changeDate) {
  if (stageTaskId) {
    // Só aceita etapa do próprio projeto — o seletor já filtra, o servidor confere.
    const { rows: [t] } = await client.query(
      'SELECT id FROM tasks WHERE id = $1 AND project_id = $2', [stageTaskId, projectId])
    if (t) return t.id
  }
  const { rows: [existe] } = await client.query(
    'SELECT id FROM tasks WHERE project_id = $1 AND title = $2 ORDER BY created_at LIMIT 1',
    [projectId, TAREFA_SEM_ETAPA])
  if (existe) return existe.id
  const id = genId('t')
  await client.query(
    `INSERT INTO tasks (id, project_id, title, status, priority, start_date, end_date)
     VALUES ($1, $2, $3, 'todo', 'medium', $4::date, $4::date + $5::int)`,
    [id, projectId, TAREFA_SEM_ETAPA, changeDate, DIAS_PRAZO_ATIVIDADE])
  return id
}

// Cria o item e devolve { taskId, itemId }. O primeiro destinatário-pessoa
// vira dono do item — e entra como membro da etapa, senão a atribuição não
// passaria na validação de quem pode assumir.
async function itemDeChecklistDaMudanca(client, { projectId, stageTaskId, kind, urgency, title, changeDate, alvos = [] }) {
  const taskId = await hospedeiroDaMudanca(client, projectId, stageTaskId, changeDate)
  const dono = alvos[0] || null
  if (dono) {
    const { rows: [t] } = await client.query('SELECT assignee_id FROM tasks WHERE id = $1', [taskId])
    if (t.assignee_id !== dono) {
      await client.query('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, dono])
    }
  }
  const { rows: [pos] } = await client.query(
    'SELECT COALESCE(max(position), -1) + 1 AS n FROM checklist_items WHERE task_id = $1', [taskId])
  const itemId = genId('c')
  await client.query(
    'INSERT INTO checklist_items (id, task_id, text, done, position, assignee_id) VALUES ($1, $2, $3, false, $4, $5)',
    [itemId, taskId, tituloDoItem({ kind, urgency, title }), pos.n, dono])
  // A etapa que recebeu trabalho novo não pode continuar "concluída".
  await ajustarStatusPeloChecklist(client, taskId)
  return { taskId, itemId }
}

// Descobre o projeto de uma mudança (para o gate das rotas /changes/:id).
async function changeProjectId(req) {
  const [c] = await q('SELECT project_id FROM changes WHERE id = $1', [req.params.id])
  return c ? c.project_id : null
}

// Lista de destinatários-pessoa, sem duplicados e sem vazios.
const normAlvos = (v) =>
  Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []

const normSetores = (v, legado = null) => {
  const lista = Array.isArray(v) ? v : legado ? [legado] : []
  return [...new Set(lista.filter((x) => typeof x === 'string' && x))]
}

// Valida o responsável: precisa existir e estar na equipe do projeto.
async function checarResponsavel(responsibleId, projectId) {
  if (!responsibleId) return null
  const [m] = await q('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, responsibleId])
  if (m) return null
  const [u] = await q('SELECT is_admin FROM users WHERE id = $1', [responsibleId])
  if (u && u.is_admin) return null // administradores participam de todos os projetos
  return 'Quem vai fazer precisa participar do projeto — inclua a pessoa primeiro.'
}

app.get('/api/changes', wrap(async (req, res) => {
  res.json(await listChanges(await visibleProjectIds(req.userId)))
}))

// Publicar: grava a mudança, cria a atividade e abre a ciência da equipe.
app.post('/api/projects/:id/changes', gate((req) => req.params.id, CAN.publishChange), wrap(async (req, res) => {
  const {
    title, description, requester = '', changeDate,
    kind, urgency, targetUserIds = [], targetSectors = [], targetSector = null,
    affectsBudget = false,
    stageTaskId = null,   // etapa que recebe a mudança; null = "Sem etapa"
  } = req.body
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Informe o que mudou, em uma linha.' })
  if (!String(description || '').trim()) return res.status(400).json({ error: 'Descreva a mudança para quem vai fazer.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(changeDate || ''))) return res.status(400).json({ error: 'Informe a data da mudança.' })

  const tipo = normKind(kind)
  const alvosSetores = normSetores(targetSectors, targetSector)
  const alvoSetor = alvosSetores[0] || null
  const alvos = normAlvos(targetUserIds)
  if (!alvos.length && !alvosSetores.length) return res.status(400).json({ error: 'Informe para quem vai a mudança — pessoas ou um setor.' })

  for (const u of alvos) {
    const erro = await checarResponsavel(u, req.params.id)
    if (erro) return res.status(400).json({ error: erro })
  }

  // O emissor é sempre quem publica — não é escolha do formulário e o que
  // vier no corpo é ignorado de propósito: quem emitiu não é dado do cliente.
  const emissorPessoa = req.userId
  const emissorSetor = null

  const id = genId('mc')
  await tx(async (client) => {
    // Requisição obriga: já entra como item do checklist da etapa. Sugestão é
    // proposta — só vira item quando alguém aceitar.
    const criado = tipo === 'requisicao'
      ? await itemDeChecklistDaMudanca(client, {
          projectId: req.params.id, stageTaskId, kind: tipo,
          title, urgency, changeDate, alvos,
        })
      : null
    // Sugestão ainda não vira item — mas a etapa escolhida fica guardada em
    // task_id para o /decide saber onde pôr o item quando alguém aceitar.
    const etapaEscolhida = stageTaskId
      ? (await client.query('SELECT id FROM tasks WHERE id = $1 AND project_id = $2', [stageTaskId, req.params.id])).rows[0]?.id || null
      : null
    const taskId = criado?.taskId || etapaEscolhida
    const itemId = criado?.itemId || null

    await client.query(
      `INSERT INTO changes (id, project_id, title, description, origin, change_date,
                            responsible_id, target_sector, target_sectors, target_user_ids, task_id, affects_budget,
                            kind, urgency, emitter_user_id, emitter_sector,
                            published_by, published_at, checklist_item_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), $18)`,
      [id, req.params.id, String(title).trim(), String(description).trim(), String(requester || '').trim(),
      changeDate, alvos[0] || null, alvoSetor, JSON.stringify(alvosSetores), JSON.stringify(alvos), taskId, !!affectsBudget,
       tipo, normUrgency(urgency), emissorPessoa || null, emissorSetor, req.userId, itemId]
    )
    await abrirCiencia(client, id, req.params.id, req.userId, alvosSetores, alvos)
  })
  res.status(201).json(await getChange(id))
}))

// Editar: atualiza a mudança e a atividade vinculada, e REABRE a ciência de
// todo mundo. `affectsBudget` não entra — é decidido na publicação e congela.
app.put('/api/changes/:id', gate(changeProjectId, CAN.edit), wrap(async (req, res) => {
  const {
    title, description, requester = '', changeDate, urgency,
    targetUserIds = [], targetSectors = [], targetSector = null,
  } = req.body
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Informe o que mudou, em uma linha.' })
  if (!String(description || '').trim()) return res.status(400).json({ error: 'Descreva a mudança para quem vai fazer.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(changeDate || ''))) return res.status(400).json({ error: 'Informe a data da mudança.' })

  const [atual] = await q('SELECT project_id, task_id, checklist_item_id, kind FROM changes WHERE id = $1', [req.params.id])
  if (!atual) return res.status(404).json({ error: 'Mudança não encontrada.' })

  const alvosSetores = normSetores(targetSectors, targetSector)
  const alvoSetor = alvosSetores[0] || null
  const alvos = normAlvos(targetUserIds)
  if (!alvos.length && !alvosSetores.length) return res.status(400).json({ error: 'Informe para quem vai a mudança — pessoas ou um setor.' })

  for (const u of alvos) {
    const erro = await checarResponsavel(u, atual.project_id)
    if (erro) return res.status(400).json({ error: erro })
  }

  // O emissor NÃO entra na edição: quem emitiu é quem publicou, e editar o
  // texto depois não transfere a autoria para quem editou (isso fica em
  // edited_by). As colunas ficam intocadas de propósito.
  await tx(async (client) => {
    await client.query(
      `UPDATE changes SET title = $2, description = $3, origin = $4, change_date = $5,
                          responsible_id = $6, target_sector = $7, target_sectors = $8, target_user_ids = $9, urgency = $10,
                          edited_by = $11, edited_at = now()
       WHERE id = $1`,
      [req.params.id, String(title).trim(), String(description).trim(), String(requester || '').trim(),
      changeDate, alvos[0] || null, alvoSetor, JSON.stringify(alvosSetores), JSON.stringify(alvos), normUrgency(urgency),
       req.userId]
    )
    // Editar a mudança reescreve o ITEM de checklist que ela criou — nunca a
    // etapa que o hospeda. Antes daqui a mudança tinha atividade própria e
    // este bloco renomeava essa atividade; agora task_id aponta para a etapa,
    // e renomeá-la trocaria o nome de "2 · Projetos" pelo texto da mudança.
    if (atual.checklist_item_id) {
      await client.query('UPDATE checklist_items SET text = $2 WHERE id = $1',
        [atual.checklist_item_id, tituloDoItem({ kind: atual.kind, urgency, title })])
      // O destinatário principal assume o item, e entra na etapa para que a
      // atribuição seja válida.
      const dono = alvos[0] || null
      if (dono && atual.task_id) {
        const { rows: [t] } = await client.query('SELECT assignee_id FROM tasks WHERE id = $1', [atual.task_id])
        if (t && t.assignee_id !== dono) {
          await client.query('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [atual.task_id, dono])
        }
      }
      await client.query('UPDATE checklist_items SET assignee_id = $2 WHERE id = $1', [atual.checklist_item_id, dono])
    }
    await abrirCiencia(client, req.params.id, atual.project_id, req.userId, alvosSetores, alvos)
  })
  res.json(await getChange(req.params.id))
}))

// Aceitar ou recusar uma SUGESTÃO. Aceitar é o que a transforma em trabalho:
// cria a atividade naquele momento. Recusar exige motivo — decisão registrada,
// não some. Decide APENAS quem é o destinatário: a pessoa endereçada, ou quem
// está no setor endereçado. Quem propôs não decide pelo outro.
app.post('/api/changes/:id/decide', gate(changeProjectId, CAN.light), wrap(async (req, res) => {
  const aceitar = !!req.body.accept
  const motivo = String(req.body.reason || '').trim()
  if (!aceitar && !motivo) return res.status(400).json({ error: 'Recusar exige um motivo registrado.' })

  const [c] = await q(
    `SELECT project_id, kind, decision, task_id, checklist_item_id, title, target_user_ids, target_sector, target_sectors, urgency,
            to_char(change_date, 'YYYY-MM-DD') AS change_date
     FROM changes WHERE id = $1`, [req.params.id])
  if (!c) return res.status(404).json({ error: 'Mudança não encontrada.' })
  if (c.kind !== 'sugestao') return res.status(400).json({ error: 'Só sugestões passam por aceite — requisição já vale.' })
  if (c.decision) return res.status(400).json({ error: 'Esta sugestão já foi decidida.' })

  const [eu] = await q('SELECT sector FROM users WHERE id = $1', [req.userId])
  const setores = c.target_sectors || normSetores([], c.target_sector)
  const souDestinatario = (eu && setores.includes(eu.sector)) || normAlvos(c.target_user_ids).includes(req.userId)
  if (!souDestinatario) {
    return res.status(403).json({ error: 'Só o destinatário da sugestão pode aceitar ou recusar.' })
  }

  await tx(async (client) => {
    let taskId = c.task_id
    let itemId = c.checklist_item_id
    // Aceitar é o que transforma a sugestão em trabalho: só aí ela vira item
    // do checklist, na etapa escolhida na publicação.
    if (aceitar && !itemId) {
      const criado = await itemDeChecklistDaMudanca(client, {
        projectId: c.project_id, stageTaskId: c.task_id, kind: 'sugestao',
        title: c.title, urgency: c.urgency, changeDate: c.change_date,
        alvos: normAlvos(c.target_user_ids),
      })
      taskId = criado.taskId
      itemId = criado.itemId
    }
    await client.query(
      `UPDATE changes SET decision = $2, decided_by = $3, decided_at = now(),
                          decision_reason = $4, task_id = $5, checklist_item_id = $6
       WHERE id = $1`,
      [req.params.id, aceitar ? 'aceita' : 'recusada', req.userId, motivo || null, taskId, itemId]
    )
  })
  res.json(await getChange(req.params.id))
}))

// Definir o setor de uma pessoa. Só administradores — o setor decide quem é
// cobrado quando a mudança é endereçada a um setor inteiro.
app.put('/api/users/:id/sector', requireAdmin, wrap(async (req, res) => {
  const setor = normSetor(req.body.sector)
  const rows = await q('UPDATE users SET sector = $2 WHERE id = $1 RETURNING id', [req.params.id, setor])
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' })
  res.json({ id: req.params.id, sector: setor })
}))

// A própria pessoa define seu setor — é o vínculo da conta com o setor que
// exerce. Sem isso, endereçar uma mudança a um setor não encontra ninguém.
app.post('/api/auth/sector', wrap(async (req, res) => {
  const setor = normSetor(req.body.sector)
  await q('UPDATE users SET sector = $2 WHERE id = $1', [req.userId, setor])
  res.json({ id: req.userId, sector: setor })
}))

// Confirmar ciência — permitido também para 'Só exibição': é o registro de
// que a pessoa leu, não uma edição do projeto.
app.post('/api/changes/:id/ack', gate(changeProjectId, CAN.light), wrap(async (req, res) => {
  const rows = await q(
    'UPDATE change_acks SET confirmed_at = now() WHERE change_id = $1 AND user_id = $2 RETURNING user_id',
    [req.params.id, req.userId]
  )
  if (!rows.length) return res.status(400).json({ error: 'Você não está na lista de quem precisa ver esta mudança.' })
  res.json(await getChange(req.params.id))
}))

// ---------- sugestoes de item de checklist ----------

// Os textos que a equipe ja usou, agrupados pelo NUMERO da etapa. Medido antes
// de escrever isto: sao 157 itens para 55 textos distintos, e 102 dos 152 itens
// do template ja existiam palavra por palavra em outro projeto. A etapa 3 tem
// sempre os mesmos cinco (3.1 Quantitativos, 3.2 Composicoes, 3.3 Planilha, 3.4
// BDI, 3.5 Cronograma) — redigitados a cada projeto.
//
// Agrupa por etapa porque '3.1 Quantitativos' so faz sentido dentro de
// Orcamento; o que nao vem de etapa numerada cai em '*' e serve de reserva.
//
// So projetos que a pessoa enxerga. Sem esse filtro a caixa de sugestao viraria
// uma janela para o texto de projetos aos quais ela nao tem acesso.
const MAX_SUGESTOES = 40

app.get('/api/checklist-suggestions', wrap(async (req, res) => {
  const visiveis = await visibleProjectIds(req.userId)
  const linhas = await q(
    `SELECT COALESCE(substring(t.title from '^([0-9]+) · '), '*') AS etapa,
            btrim(ci.text) AS texto,
            count(DISTINCT t.project_id)::int AS projetos
       FROM checklist_items ci
       JOIN tasks t ON t.id = ci.task_id
      WHERE btrim(ci.text) <> ''
        -- Item nascido de uma mudança publicada carrega o prefixo "[Requisição]"
        -- e é o registro de um pedido específico, de um projeto específico. Nunca
        -- serve de sugestão para outro — só sujaria a lista com o improviso de
        -- alguém no lugar do padrão da casa.
        AND btrim(ci.text) NOT LIKE '[%'
        AND ($1::text[] IS NULL OR t.project_id = ANY($1))
      GROUP BY 1, 2
      ORDER BY 1, 3 DESC, 2`,
    [visiveis])

  const porEtapa = {}
  for (const l of linhas) {
    const lista = porEtapa[l.etapa] || (porEtapa[l.etapa] = [])
    if (lista.length < MAX_SUGESTOES) lista.push({ text: l.texto, n: l.projetos })
  }
  res.json(porEtapa)
}))

// ---------- relatorio semanal ----------

// A semana e identificada pela SEXTA que a encerra — e quando a equipe manda.
// Sabado e domingo pertencem a sexta que passou; quem abre a tela no domingo
// continua vendo o relatorio da semana que acabou, nao um em branco.
const DIA_MS = 86400000
function sextaDe(iso) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? iso : new Date().toISOString().slice(0, 10)
  const d = new Date(base + 'T00:00:00Z')
  const dow = d.getUTCDay()  // 0 dom ... 6 sab
  const delta = dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow
  return new Date(d.getTime() + delta * DIA_MS).toISOString().slice(0, 10)
}
const maisDias = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * DIA_MS).toISOString().slice(0, 10)

// Sanitizacao do texto rico. Vale ser explicito sobre o porque:
//
// 1. XSS — o relatorio de um colaborador e lido pelo admin. Sem limpar aqui,
//    quem escreve escolhe o que roda na tela de quem le. Limpar so no cliente
//    nao vale nada: a rota aceita qualquer corpo.
// 2. Tamanho — um editor tipo Word aceita Ctrl+V de print de tela, e o
//    navegador cola a imagem como data:base64 DENTRO do HTML. Um print vira
//    500 KB a 2 MB numa coluna de texto.
//
// A regra que resolve os dois: lista fechada de tags e NENHUM atributo. Sem
// atributo nao ha on*, href javascript: nem src data:. O editor do cliente
// ainda converte o que e colado para texto puro, mas isto aqui e a garantia.
const TAGS_OK = ['b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br', 'p', 'div']
const LIMITE_TEXTO = 20 * 1024

function limparHtml(bruto, limite = LIMITE_TEXTO) {
  if (typeof bruto !== 'string' || !bruto) return ''
  const limpo = bruto
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Reescreve cada tag sem nenhum atributo; o que nao esta na lista some.
    .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_, barra, tag) =>
      TAGS_OK.includes(tag.toLowerCase()) ? '<' + barra + tag.toLowerCase() + '>' : '')
    // '<' que sobrou nao abria tag nenhuma: e texto que a pessoa digitou.
    .replace(/</g, '&lt;')
    .replace(/&lt;(\/?)(b|strong|i|em|u|ul|ol|li|br|p|div)>/g, '<$1$2>')
  return limpo.length > limite ? limpo.slice(0, limite) : limpo
}

// Texto visivel, para saber se o relatorio tem conteudo de verdade.
const semTags = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

// Espelha PROJECT_STATUSES de src/data/store.js. E a lista que o servidor
// aceita gravar: status virou escolha, nao texto livre. Os quatro relatorios
// ja enviados tinham status escrito a mao, e os quatro diziam "Em andamento" —
// com uma grafia diferente cada vez, o que nao da para contar nem agrupar.
const STATUS_PROJETO = ['planejamento', 'andamento', 'revisao', 'pendente', 'diligencia', 'paralisado', 'concluido']

const mapRelatorio = (r) => ({
  id: r.id,
  userId: r.user_id,
  week: r.week instanceof Date ? r.week.toISOString().slice(0, 10) : String(r.week).slice(0, 10),
  projectIds: r.project_ids || [],
  developed: r.developed || '',
  works: r.works || {},
  statuses: r.statuses || {},
  sentAt: r.sent_at,
  updatedAt: r.updated_at,
})

const COLUNAS_REL = 'id, user_id, week, project_ids, developed, works, statuses, sent_at, updated_at'

// Duas listas, e a diferenca entre elas importa:
//
// `disponiveis` sao todos os projetos da pessoa — so para ela poder escolher.
// `projectIds` sao os da SEMANA: onde ela cronometrou tempo ou onde a atividade
// sob sua responsabilidade mudou. So estes vem pre-marcados.
//
// Marcar tudo o que a pessoa tem seria pior que a pagina em branco: Alvaro esta
// em 26 projetos, e o relatorio dele sairia listando os 26. O modelo em uso
// lista dois — os que ele tocou.
async function sugerirDaSemana(userId, semana) {
  const de = maisDias(semana, -4)   // segunda
  const ate = maisDias(semana, 3)   // domingo seguinte (exclusivo)
  const [projetos, atividades] = await Promise.all([
    q(`SELECT DISTINCT p.id
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         LEFT JOIN tasks t ON t.project_id = p.id AND t.assignee_id = $1
        WHERE pm.user_id IS NOT NULL OR t.id IS NOT NULL`, [userId]),
    q(`SELECT DISTINCT t.title, t.project_id, t.status::text AS status
         FROM tasks t
         LEFT JOIN time_sessions s ON s.task_id = t.id AND s.user_id = $1
              AND s.start_at >= $2::date AND s.start_at < $3::date
        WHERE s.id IS NOT NULL
           OR (t.assignee_id = $1 AND t.updated_at >= $2::date AND t.updated_at < $3::date)
        ORDER BY t.title`, [userId, de, ate]),
  ])
  const daSemana = [...new Set(atividades.map(a => a.project_id))]
  return {
    projectIds: daSemana,
    disponiveis: projetos.map(r => r.id),
    atividades: atividades.map(a => ({ title: a.title, projectId: a.project_id, status: a.status })),
  }
}

// O relatorio da propria pessoa. Sem registro ainda, devolve null e a sugestao:
// a tela monta o rascunho, o banco so recebe linha quando alguem salva.
app.get('/api/weekly-reports/me', wrap(async (req, res) => {
  const semana = sextaDe(req.query.week)
  const [r] = await q(`SELECT ${COLUNAS_REL} FROM weekly_reports WHERE user_id = $1 AND week = $2::date`, [req.userId, semana])
  res.json({ week: semana, report: r ? mapRelatorio(r) : null, sugestao: await sugerirDaSemana(req.userId, semana) })
}))

// Salva rascunho ou envia. Mesma linha nos dois casos — `send` so carimba a
// hora. Reenviar depois de corrigir e permitido: o carimbo e atualizado.
app.put('/api/weekly-reports/me', wrap(async (req, res) => {
  const semana = sextaDe(req.body.week)
  const enviar = !!req.body.send
  const projectIds = (Array.isArray(req.body.projectIds) ? req.body.projectIds : [])
    .filter(id => typeof id === 'string').slice(0, 30)

  // Texto e status so dos projetos declarados: sem isto, tirar um projeto do
  // relatorio deixaria o texto dele guardado para sempre, invisivel na tela e
  // no PDF, e reaparecendo se o projeto voltasse.
  const works = {}
  const statuses = {}
  const brutoTexto = req.body.works && typeof req.body.works === 'object' ? req.body.works : {}
  const brutoStatus = req.body.statuses && typeof req.body.statuses === 'object' ? req.body.statuses : {}
  for (const id of projectIds) {
    const limpo = limparHtml(brutoTexto[id])
    if (semTags(limpo)) works[id] = limpo
    if (STATUS_PROJETO.includes(brutoStatus[id])) statuses[id] = brutoStatus[id]
  }

  if (enviar && !projectIds.length) return res.status(400).json({ error: 'Escolha ao menos um projeto antes de enviar.' })
  if (enviar && !Object.keys(works).length) return res.status(400).json({ error: 'Escreva o que foi feito em pelo menos um projeto.' })

  const [r] = await q(
    // `developed` nao aparece no UPDATE de proposito: a tela nova nao tem mais
    // esse campo, e incluir aqui apagaria em silencio o texto de um relatorio
    // antigo na primeira vez que alguem o reabrisse.
    `INSERT INTO weekly_reports (id, user_id, week, project_ids, works, statuses, sent_at, updated_at)
     VALUES ($1, $2, $3::date, $4::text[], $5::jsonb, $6::jsonb, CASE WHEN $7 THEN now() ELSE NULL END, now())
     ON CONFLICT (user_id, week) DO UPDATE SET
       project_ids = EXCLUDED.project_ids,
       works       = EXCLUDED.works,
       statuses    = EXCLUDED.statuses,
       sent_at     = CASE WHEN $7 THEN now() ELSE weekly_reports.sent_at END,
       updated_at  = now()
     RETURNING ${COLUNAS_REL}`,
    [genId('wr'), req.userId, semana, projectIds, JSON.stringify(works), JSON.stringify(statuses), enviar])
  res.json(mapRelatorio(r))
}))

// Painel do admin: o que foi enviado naquela semana, e quem falta.
// Rascunho de outra pessoa nao aparece — relatorio so existe depois de enviado.
app.get('/api/weekly-reports', requireAdmin, wrap(async (req, res) => {
  const semana = sextaDe(req.query.week)
  const [enviados, pessoas] = await Promise.all([
    q(`SELECT ${COLUNAS_REL} FROM weekly_reports WHERE week = $1::date AND sent_at IS NOT NULL ORDER BY sent_at`, [semana]),
    q('SELECT id FROM users WHERE is_active AND NOT is_dev ORDER BY id'),
  ])
  const entregou = new Set(enviados.map(r => r.user_id))
  res.json({
    week: semana,
    reports: enviados.map(mapRelatorio),
    faltando: pessoas.map(p => p.id).filter(id => !entregou.has(id)),
  })
}))

// ---------- middleware de erro ----------
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Arquivo maior que o limite de 25 MB.' })
  }
  console.error('[promav] erro na API:', err.message)
  res.status(500).json({ error: err.message })
})

// Garante tabelas/colunas novas (idempotente). O restante do schema é criado à parte.
async function ensureSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS files (
      id          text PRIMARY KEY,
      project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename    text NOT NULL,
      mime_type   text NOT NULL,
      size_bytes  integer NOT NULL,
      data        bytea NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS files_project_id_idx ON files (project_id)')

  // ----- pastas (agrupam projetos na sidebar) -----
  await q(`
    CREATE TABLE IF NOT EXISTS folders (
      id         text PRIMARY KEY,
      name       text NOT NULL,
      position   integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  // Pasta-mãe: permite subpastas (pasta dentro de pasta, aninhamento ilimitado).
  // NULL = pasta na raiz. Apagar a pasta-mãe apaga as subpastas junto (CASCADE);
  // os projetos dentro delas ficam soltos por causa do ON DELETE SET NULL abaixo.
  await q('ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id text REFERENCES folders(id) ON DELETE CASCADE')
  // Gaveta do projeto. NULL = projeto solto (sem pasta). Apagar a pasta só
  // solta os projetos (ON DELETE SET NULL), nunca os apaga.
  await q('ALTER TABLE projects ADD COLUMN IF NOT EXISTS folder_id text REFERENCES folders(id) ON DELETE SET NULL')
  // Ordem do projeto na sidebar (dentro da pasta ou entre os soltos). Usado no drag-and-drop.
  await q('ALTER TABLE projects ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0')

  // ----- ficha do projeto (dados do convênio) -----
  await q("ALTER TABLE projects ADD COLUMN IF NOT EXISTS prefeitura text NOT NULL DEFAULT ''")
  await q("ALTER TABLE projects ADD COLUMN IF NOT EXISTS secretaria text NOT NULL DEFAULT ''")
  // Origem do recurso: federal | estadual | municipal | emenda | outro.
  await q("ALTER TABLE projects ADD COLUMN IF NOT EXISTS origem_recurso text NOT NULL DEFAULT 'federal'")
  // Valor ESTIMADO do projeto, em reais (coluna com o nome antigo). NULL = não informado.
  await q('ALTER TABLE projects ADD COLUMN IF NOT EXISTS valor_convenio numeric(14,2)')
  // Valor ORÇADO do projeto, em reais (coluna com o nome antigo). NULL = não informado.
  await q('ALTER TABLE projects ADD COLUMN IF NOT EXISTS valor_disponivel numeric(14,2)')
  // Status do projeto: mesma lista de PROJ_STATUSES, em ordem de criticidade
  // (planejamento | andamento | revisao | pendente | diligencia | paralisado | concluido).
  // A coluna é text livre, então status novos não pedem migração: basta entrar
  // na lista aqui e em PROJECT_STATUSES (store.js), que é quem dá rótulo e cor.
  await q("ALTER TABLE projects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planejamento'")
  // Profissionais responsáveis: lista (jsonb) de ids de usuários.
  await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS responsible_ids jsonb NOT NULL DEFAULT '[]'::jsonb`)

  // ----- mudanças do projeto (orientações) + ciência -----
  await q(`
    CREATE TABLE IF NOT EXISTS changes (
      id             text PRIMARY KEY,
      project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title          text NOT NULL,
      description    text NOT NULL,
      origin         text NOT NULL DEFAULT '',
      change_date    date NOT NULL,
      responsible_id text REFERENCES users(id) ON DELETE SET NULL,
      task_id        text REFERENCES tasks(id) ON DELETE SET NULL,
      affects_budget boolean NOT NULL DEFAULT false,
      published_by   text NOT NULL REFERENCES users(id),
      published_at   timestamptz NOT NULL DEFAULT now(),
      edited_by      text REFERENCES users(id),
      edited_at      timestamptz
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS changes_project_idx ON changes (project_id, published_at DESC)')
  // Requisição obriga; sugestão é proposta e só vira atividade depois de aceita.
  await q("ALTER TABLE changes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'requisicao'")
  // Urgência usa os mesmos ids da prioridade da atividade — vira a prioridade do cartão.
  await q("ALTER TABLE changes ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'medium'")
  // Emissor: quem PEDIU a mudança (≠ published_by, que é quem digitou). Pessoa ou setor.
  await q('ALTER TABLE changes ADD COLUMN IF NOT EXISTS emitter_user_id text REFERENCES users(id) ON DELETE SET NULL')
  await q('ALTER TABLE changes ADD COLUMN IF NOT EXISTS emitter_sector text')
  // Destinatário setor. Quando é pessoa, fica em responsible_id (quem vai fazer).
  await q('ALTER TABLE changes ADD COLUMN IF NOT EXISTS target_sector text')
  await q(`ALTER TABLE changes ADD COLUMN IF NOT EXISTS target_sectors jsonb NOT NULL DEFAULT '[]'::jsonb`)
  // Destinatários pessoa: a mudança pode ir para mais de uma. O primeiro vira
  // responsável da atividade; os demais entram como membros dela.
  await q(`ALTER TABLE changes ADD COLUMN IF NOT EXISTS target_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb`)
  // Decisão da sugestão: NULL = pendente.
  await q('ALTER TABLE changes ADD COLUMN IF NOT EXISTS decision text')
  await q('ALTER TABLE changes ADD COLUMN IF NOT EXISTS decided_by text REFERENCES users(id) ON DELETE SET NULL')
  await q('ALTER TABLE changes ADD COLUMN IF NOT EXISTS decided_at timestamptz')
  await q('ALTER TABLE changes ADD COLUMN IF NOT EXISTS decision_reason text')
  // O item de checklist que a mudança criou dentro da etapa. task_id passa a
  // apontar para a ETAPA hospedeira, não para uma atividade própria.
  await q('ALTER TABLE changes ADD COLUMN IF NOT EXISTS checklist_item_id text REFERENCES checklist_items(id) ON DELETE SET NULL')
  // Uma linha por (mudança, pessoa). confirmed_at NULL = ainda não deu ciência.
  await q(`
    CREATE TABLE IF NOT EXISTS change_acks (
      change_id    text NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
      user_id      text NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      sent_at      timestamptz NOT NULL DEFAULT now(),
      confirmed_at timestamptz,
      PRIMARY KEY (change_id, user_id)
    )
  `)

  // Último toque no projeto. Sem isto o /api/pulse não enxerga edição de
  // projeto: a tabela só tinha created_at, então mudar nome, datas ou valores
  // não mexia em carimbo nenhum. Mesmo cuidado do tasks.updated_at: sem
  // DEFAULT na criação, para as linhas antigas herdarem o próprio created_at.
  await q('ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at timestamptz')
  await q('UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL')
  await q('ALTER TABLE projects ALTER COLUMN updated_at SET DEFAULT now()')

  // Responsável por CADA item do checklist. Uma atividade com duas pessoas
  // costuma ter cada uma cuidando de uma parte; sem isto só dá para saber que
  // "alguém do par" está devendo. NULL = item sem dono, que é permitido.
  await q('ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS assignee_id text REFERENCES users(id) ON DELETE SET NULL')

  // ----- atividade: autoria, último toque e leitura -----
  // Quem criou a atividade. NULL nas linhas antigas (não dá para descobrir
  // depois) — a regra de "criei para mim mesmo" simplesmente não as alcança.
  await q('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by text REFERENCES users(id) ON DELETE SET NULL')
  // Último toque na atividade (edição, status, checklist, participação).
  // Entra sem DEFAULT para não carimbar now() nas linhas antigas: elas herdam
  // o próprio created_at logo abaixo, que é a data real mais próxima.
  await q('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz')
  await q('UPDATE tasks SET updated_at = created_at WHERE updated_at IS NULL')
  await q('ALTER TABLE tasks ALTER COLUMN updated_at SET DEFAULT now()')
  // Quando cada pessoa abriu a atividade pela última vez. Uma linha por
  // (atividade, pessoa) — é o "acessado" da regra de notificação.
  await q(`
    CREATE TABLE IF NOT EXISTS task_views (
      task_id text NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      seen_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (task_id, user_id)
    )
  `)

  // Setor da pessoa (engenharia, arquitetura…). É o que faz "destinatário:
  // Engenharia" resolver para gente de verdade na hora de cobrar ciência.
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS sector text')
  // Formação (substitui o antigo cargo), telefone, nome curto e situação ativa/inativa da pessoa.
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS formation text')
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text')
  // Cargo virou formação. O que já dá para traduzir com segurança é traduzido;
  // o resto (Projetos Prediais, Coordenação, TI…) fica em branco para o admin
  // preencher — engenharia civil e elétrica não dá para adivinhar. A coluna
  // job_title antiga é mantida, sem uso, para não perder dado.
  await q("UPDATE users SET formation = 'arquitetura' WHERE formation IS NULL AND job_title = 'Arquitetura'")
  // Setores foram reduzidos a três; só 'Orçamento' tem equivalente direto.
  await q("UPDATE users SET sector = 'orcamento' WHERE sector IN ('Orcamento', 'orcamento')")
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text')
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS short_name text')
  // Número do registro profissional (CREA ou CAU, conforme a formação — ver
  // FORMACAO_CONSELHO em data/store.js). Só o número; a sigla não é gravada
  // porque é sempre derivada da formação, nunca escolhida à parte.
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_register text')
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true')
  // Se a pessoa é terceirizada (Sim/Não na ficha) — não confundir com o setor.
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_outsourced boolean NOT NULL DEFAULT false')
  // Terceirizado não tem login, então a conta pode ficar sem senha.
  await q('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL')

  // ----- permissões -----
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false')
  // Papel padrão de cada projeto (o que vale para quem não tem exceção): full = aberto.
  await q("ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_role text NOT NULL DEFAULT 'full'")
  await q(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    text NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      role       text NOT NULL DEFAULT 'view',
      PRIMARY KEY (project_id, user_id)
    )
  `)

  // ----- relatorio semanal -----
  // Uma linha por pessoa por semana, atualizada no lugar: o rascunho e o
  // enviado sao o MESMO registro. Salvar automatico criando linha nova faria
  // um relatorio virar duzentas.
  //
  // So texto. O PDF nunca e gravado: ele se regenera daqui em milissegundos, e
  // guardar ~80 KB por relatorio custaria uns 40 MB/ano — mais de quatro vezes
  // o banco inteiro de hoje, para armazenar o que ja esta em `developed`.
  await q(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id          text PRIMARY KEY,
      user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week        date NOT NULL,
      project_ids text[] NOT NULL DEFAULT '{}',
      developed   text NOT NULL DEFAULT '',
      statuses    jsonb NOT NULL DEFAULT '{}'::jsonb,
      sent_at     timestamptz,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, week)
    )
  `)
  await q('CREATE INDEX IF NOT EXISTS weekly_reports_week_idx ON weekly_reports (week)')

  // O que foi feito passou a ser POR PROJETO: um texto unico para a semana
  // obrigava a pessoa a repetir o nome do projeto dentro da frase para se fazer
  // entender. `developed` (texto unico) fica para os relatorios ja enviados —
  // eles continuam sendo lidos e impressos como foram escritos.
  await q("ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS works jsonb NOT NULL DEFAULT '{}'::jsonb")

  // ----- revisao e diligencia -----
  // ADD VALUE num enum do Postgres e de mao unica: valor de enum NAO pode ser
  // removido depois. Por isso os dois entram com o nome definitivo e na ordem
  // do fluxo — a ordem declarada aqui e a que qualquer ORDER BY status usa.
  await q("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'review' AFTER 'progress'")
  await q("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'diligence' AFTER 'review'")

  // O item do checklist deixa de ser so marcado/desmarcado. `done` continua
  // existindo e em dia (done = state 'done') porque quem le progresso, o
  // indicador dos cartoes e os relatorios olham esse campo — nenhum deles
  // precisa aprender os estados novos para continuar certo.
  await q("ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'todo'")
  await q("UPDATE checklist_items SET state = 'done' WHERE done AND state = 'todo'")

  // Equipe de desenvolvimento do app: contas que mantêm o sistema, não gente
  // que toca obra. Ficam fora da equipe dos projetos (e da responsabilidade),
  // por isso a marca é por e-mail — id muda, e-mail não. A lista é a fonte da
  // verdade: tirar alguém daqui devolve a pessoa ao cadastro no próximo boot.
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false')
  const devEmails = (process.env.DEV_EMAILS || 'kauaalbuquerque77@gmail.com,janylson.promav@gmail.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  await q('UPDATE users SET is_dev = (lower(email) = ANY($1))', [devEmails])

  // Bootstrap do administrador: promove o ADMIN_EMAIL e garante ao menos um admin.
  const adminEmail = process.env.ADMIN_EMAIL || 'engenharia.promav@gmail.com'
  await q('UPDATE users SET is_admin = true WHERE lower(email) = lower($1)', [adminEmail])
  const [{ count }] = await q('SELECT count(*)::int AS count FROM users WHERE is_admin')
  if (!count) {
    await q('UPDATE users SET is_admin = true WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)')
    console.warn('[promav] nenhum admin encontrado — promovi o primeiro usuário. Defina ADMIN_EMAIL para escolher.')
  }
}

ensureSchema()
  .catch((e) => console.error('[promav] falha ao garantir schema de arquivos:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`[promav] backend rodando em http://localhost:${PORT}`)
    })
  })
