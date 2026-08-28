// ============================================================
// Promav — backend (Express + Neon/Postgres)
// API REST consumida pelo frontend React. As formas de dados
// retornadas espelham as de src/data/store.js para que as telas
// não precisem mudar (desc, memberIds, checklist, start/end…).
// ============================================================
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { q, tx } from './db.js'
import { requireAuth, signToken, verifyPassword, hashPassword } from './auth.js'

const app = express()

// CORS: o frontend (Firebase) e o backend (Cloud Run) ficam em origens diferentes.
// CORS_ORIGIN aceita uma lista separada por vírgula; ausente/"*" libera todas.
const origins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({ origin: origins.includes('*') ? true : origins }))
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
           SELECT json_agg(json_build_object('id', c.id, 'text', c.text, 'done', c.done) ORDER BY c.position)
           FROM checklist_items c WHERE c.task_id = t.id
         ), '[]'::json) AS checklist,
         COALESCE((
           SELECT json_agg(m.user_id ORDER BY m.user_id)
           FROM task_members m WHERE m.task_id = t.id
         ), '[]'::json) AS "memberIds"
  FROM tasks t`

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
  light: ['admin', 'full', 'view'], // mover no Kanban, marcar checklist, adicionar material
  adminOnly: ['admin'],             // gerenciar permissões, excluir projeto
}

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
  return rows[0] || null
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

  for (let i = 0; i < checklist.length; i++) {
    const item = checklist[i]
    await client.query(
      'INSERT INTO checklist_items (id, task_id, text, done, position) VALUES ($1, $2, $3, $4, $5)',
      [item.id || genId('c'), taskId, item.text, !!item.done, i]
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
const PUBLIC_USER = 'id, name, initials, color, email, sector, is_admin AS "isAdmin", is_dev AS "isDev"'
// Forma reduzida usada em listas (bootstrap/equipe).
const LIST_USER = 'id, name, initials, color, sector, is_admin AS "isAdmin", is_dev AS "isDev"'

// ----- autenticação (rotas públicas) -----
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Informe email e senha.' })
  const [row] = await q('SELECT id, name, initials, color, email, is_admin AS "isAdmin", password_hash FROM users WHERE lower(email) = lower($1)', [email])
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return res.status(401).json({ error: 'Email ou senha incorretos.' })
  }
  const { password_hash, ...user } = row
  res.json({ token: signToken(user), user })
}))

// ===== a partir daqui, tudo exige autenticação =====
app.use('/api', requireAuth)

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
  if (!row || !(await verifyPassword(currentPassword || '', row.password_hash))) {
    return res.status(401).json({ error: 'Senha atual incorreta.' })
  }
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [req.userId, await hashPassword(newPassword)])
  res.json({ ok: true })
}))

// Carga inicial do app — tudo num request só.
// Admin recebe tudo; os demais recebem SOMENTE os projetos em que foram
// incluídos (e as tarefas/sessões/pastas correspondentes). O filtro é aqui,
// no servidor: esconder no front deixaria os dados trafegarem mesmo assim.
app.get('/api/bootstrap', wrap(async (req, res) => {
  const ids = await visibleProjectIds(req.userId)   // null = admin (sem filtro)
  const all = ids === null

  const [users, projects, tasks, sessions, folders, changes] = await Promise.all([
    q(`SELECT ${LIST_USER} FROM users ORDER BY id`),
    all ? q(`${PROJECT_SELECT} ORDER BY position, id`)
        : q(`${PROJECT_SELECT} WHERE id = ANY($1) ORDER BY position, id`, [ids]),
    all ? q(`${TASK_SELECT} ORDER BY t.id`)
        : q(`${TASK_SELECT} WHERE t.project_id = ANY($1) ORDER BY t.id`, [ids]),
    listSessions(ids),
    q(`${FOLDER_SELECT} ORDER BY position, name`),
    listChanges(ids),
  ])

  res.json({
    users, projects, tasks, sessions, changes,
    folders: all ? folders : foldersWithProjects(folders, projects),
  })
}))

app.get('/api/users', wrap(async (_req, res) => {
  res.json(await q(`SELECT ${LIST_USER} FROM users ORDER BY id`))
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
                           prefeitura = $10, secretaria = $11, origem_recurso = $12, valor_convenio = $13, valor_disponivel = $14, status = $15, responsible_ids = $16
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
  const ids = await visibleProjectIds(req.userId)
  res.json(ids === null
    ? await q(`${TASK_SELECT} ORDER BY t.id`)
    : await q(`${TASK_SELECT} WHERE t.project_id = ANY($1) ORDER BY t.id`, [ids]))
}))

app.post('/api/tasks', gate((req) => req.body.projectId, CAN.edit), wrap(async (req, res) => {
  const { projectId, title, assigneeId, status = 'todo', priority = 'medium', start, end, checklist = [], memberIds = [] } = req.body
  const id = genId('t')
  await tx(async (client) => {
    await client.query(
      `INSERT INTO tasks (id, project_id, title, assignee_id, status, priority, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, projectId, title, assigneeId || null, status, priority, start, end]
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
      `UPDATE tasks SET project_id = $2, title = $3, assignee_id = $4, status = $5, priority = $6, start_date = $7, end_date = $8
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
  const rows = await q('UPDATE tasks SET status = $2 WHERE id = $1 RETURNING id', [req.params.id, req.body.status])
  if (!rows.length) return res.status(404).json({ error: 'Atividade não encontrada.' })
  res.json(await getTask(req.params.id))
}))

// Marcar/desmarcar itens do checklist — permitido para 'Só exibição'. Só altera
// o campo "done" de itens já existentes (não cria nem remove itens).
app.patch('/api/tasks/:id/checklist', gate(taskProjectId, CAN.light), wrap(async (req, res) => {
  const { checklist = [] } = req.body
  await tx(async (client) => {
    for (const item of checklist) {
      if (!item || !item.id) continue
      await client.query('UPDATE checklist_items SET done = $2 WHERE id = $1 AND task_id = $3', [item.id, !!item.done, req.params.id])
    }
  })
  res.json(await getTask(req.params.id))
}))

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

const SETORES = ['engenharia', 'arquitetura', 'orcamento', 'coordenacao', 'direcao', 'estagio']
const CHANGE_KINDS = ['requisicao', 'sugestao']
const URGENCIES = ['low', 'medium', 'high']
const normSetor = (v) => (SETORES.includes(v) ? v : null)
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

// Cria a atividade da mudança e devolve o id. A urgência vira a prioridade do
// cartão. Sem destinatário-pessoa, nasce sem responsável — alguém do setor assume.
async function criarAtividadeDaMudanca(client, { projectId, title, alvos = [], changeDate, urgency }) {
  const taskId = genId('t')
  const [responsavel, ...demais] = alvos
  await client.query(
    `INSERT INTO tasks (id, project_id, title, assignee_id, status, priority, start_date, end_date)
     VALUES ($1, $2, $3, $4, 'todo', $5, $6::date, $6::date + $7::int)`,
    [taskId, projectId, title, responsavel || null, normUrgency(urgency), changeDate, DIAS_PRAZO_ATIVIDADE]
  )
  // Destinatários além do primeiro viram membros da atividade.
  for (const u of demais) {
    await client.query('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, u])
  }
  return taskId
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
app.post('/api/projects/:id/changes', gate((req) => req.params.id, CAN.edit), wrap(async (req, res) => {
  const {
    title, description, requester = '', changeDate,
    kind, urgency, targetUserIds = [], targetSectors = [], targetSector = null,
    emitterUserId = null, emitterSector = null, affectsBudget = false,
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

  const emissorSetor = normSetor(emitterSector)
  const emissorPessoa = emissorSetor ? null : (emitterUserId || req.userId)

  const id = genId('mc')
  await tx(async (client) => {
    // Requisição obriga: já nasce como cartão no quadro. Sugestão é proposta —
    // vira atividade só quando alguém aceitar.
    const taskId = tipo === 'requisicao'
      ? await criarAtividadeDaMudanca(client, {
          projectId: req.params.id, title: String(title).trim(),
          alvos, changeDate, urgency,
        })
      : null

    await client.query(
      `INSERT INTO changes (id, project_id, title, description, origin, change_date,
                            responsible_id, target_sector, target_sectors, target_user_ids, task_id, affects_budget,
                            kind, urgency, emitter_user_id, emitter_sector,
                            published_by, published_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())`,
      [id, req.params.id, String(title).trim(), String(description).trim(), String(requester || '').trim(),
      changeDate, alvos[0] || null, alvoSetor, JSON.stringify(alvosSetores), JSON.stringify(alvos), taskId, !!affectsBudget,
       tipo, normUrgency(urgency), emissorPessoa || null, emissorSetor, req.userId]
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
    targetUserIds = [], targetSectors = [], targetSector = null, emitterUserId = null, emitterSector = null,
  } = req.body
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Informe o que mudou, em uma linha.' })
  if (!String(description || '').trim()) return res.status(400).json({ error: 'Descreva a mudança para quem vai fazer.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(changeDate || ''))) return res.status(400).json({ error: 'Informe a data da mudança.' })

  const [atual] = await q('SELECT project_id, task_id FROM changes WHERE id = $1', [req.params.id])
  if (!atual) return res.status(404).json({ error: 'Mudança não encontrada.' })

  const alvosSetores = normSetores(targetSectors, targetSector)
  const alvoSetor = alvosSetores[0] || null
  const alvos = normAlvos(targetUserIds)
  if (!alvos.length && !alvosSetores.length) return res.status(400).json({ error: 'Informe para quem vai a mudança — pessoas ou um setor.' })

  for (const u of alvos) {
    const erro = await checarResponsavel(u, atual.project_id)
    if (erro) return res.status(400).json({ error: erro })
  }

  const emissorSetor = normSetor(emitterSector)
  const emissorPessoa = emissorSetor ? null : emitterUserId

  await tx(async (client) => {
    await client.query(
      `UPDATE changes SET title = $2, description = $3, origin = $4, change_date = $5,
                          responsible_id = $6, target_sector = $7, target_sectors = $8, target_user_ids = $9, urgency = $10,
                          emitter_user_id = $11, emitter_sector = $12,
                          edited_by = $13, edited_at = now()
       WHERE id = $1`,
      [req.params.id, String(title).trim(), String(description).trim(), String(requester || '').trim(),
      changeDate, alvos[0] || null, alvoSetor, JSON.stringify(alvosSetores), JSON.stringify(alvos), normUrgency(urgency),
       emissorPessoa || null, emissorSetor, req.userId]
    )
    if (atual.task_id) {
      await client.query('UPDATE tasks SET title = $2, assignee_id = $3, priority = $4 WHERE id = $1',
        [atual.task_id, String(title).trim(), alvos[0] || null, normUrgency(urgency)])
      // Refaz os membros da atividade a partir dos destinatários extras.
      await client.query('DELETE FROM task_members WHERE task_id = $1', [atual.task_id])
      for (const u of alvos.slice(1)) {
        await client.query('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [atual.task_id, u])
      }
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
    `SELECT project_id, kind, decision, task_id, title, target_user_ids, target_sector, target_sectors, urgency,
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
    if (aceitar && !taskId) {
      taskId = await criarAtividadeDaMudanca(client, {
        projectId: c.project_id, title: c.title, alvos: normAlvos(c.target_user_ids),
        changeDate: c.change_date, urgency: c.urgency,
      })
    }
    await client.query(
      `UPDATE changes SET decision = $2, decided_by = $3, decided_at = now(),
                          decision_reason = $4, task_id = $5
       WHERE id = $1`,
      [req.params.id, aceitar ? 'aceita' : 'recusada', req.userId, motivo || null, taskId]
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

// A própria pessoa define seu setor — é o vínculo da conta com o cargo que
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

  // Setor da pessoa (engenharia, arquitetura…). É o que faz "destinatário:
  // Engenharia" resolver para gente de verdade na hora de cobrar ciência.
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS sector text')

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
