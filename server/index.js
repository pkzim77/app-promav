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
         notes,
         resources,
         default_role AS "defaultRole",
         COALESCE((
           SELECT json_agg(json_build_object('userId', pm.user_id, 'role', pm.role) ORDER BY pm.user_id)
           FROM project_members pm WHERE pm.project_id = projects.id
         ), '[]'::json) AS members,
         to_char(start_date, 'YYYY-MM-DD') AS start,
         to_char(end_date,   'YYYY-MM-DD') AS "end"
  FROM projects`

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

// Papel efetivo de um usuário num projeto: admin global > exceção da pessoa > padrão do projeto.
async function effectiveRole(userId, projectId) {
  const [u] = await q('SELECT is_admin FROM users WHERE id = $1', [userId])
  if (u && u.is_admin) return 'admin'
  const [m] = await q('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId])
  if (m) return normRole(m.role)
  const [p] = await q('SELECT default_role FROM projects WHERE id = $1', [projectId])
  return p ? normDefaultRole(p.default_role) : 'view'
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
async function listSessions() {
  return (await q(`${SESSION_SELECT} ORDER BY start_at`)).map(mapSession)
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
const PUBLIC_USER = 'id, name, initials, color, email, is_admin AS "isAdmin"'
// Forma reduzida usada em listas (bootstrap/equipe).
const LIST_USER = 'id, name, initials, color, is_admin AS "isAdmin"'

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
app.get('/api/bootstrap', wrap(async (_req, res) => {
  const [users, projects, tasks, sessions] = await Promise.all([
    q(`SELECT ${LIST_USER} FROM users ORDER BY id`),
    q(`${PROJECT_SELECT} ORDER BY id`),
    q(`${TASK_SELECT} ORDER BY t.id`),
    listSessions(),
  ])
  res.json({ users, projects, tasks, sessions })
}))

app.get('/api/users', wrap(async (_req, res) => {
  res.json(await q(`SELECT ${LIST_USER} FROM users ORDER BY id`))
}))

// ----- projetos -----
app.get('/api/projects', wrap(async (_req, res) => {
  res.json(await q(`${PROJECT_SELECT} ORDER BY id`))
}))

// Criar projeto: só administradores. Já grava papel padrão e exceções por pessoa.
app.post('/api/projects', requireAdmin, wrap(async (req, res) => {
  const { name, desc = '', color = 'indigo', start, end, notes = '', resources = [], defaultRole = 'full', members = [] } = req.body
  const id = genId('p')
  await tx(async (client) => {
    await client.query(
      'INSERT INTO projects (id, name, description, color, start_date, end_date, notes, resources, default_role) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, name, desc, color, start, end, notes, JSON.stringify(normalizeResources(resources)), normDefaultRole(defaultRole)]
    )
    await replaceMembers(client, id, members)
  })
  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [id])
  res.status(201).json(row)
}))

// Editar projeto: precisa de Edição total. Papel padrão e exceções (permissões)
// só são alterados por administradores.
app.put('/api/projects/:id', gate((req) => req.params.id, CAN.edit), wrap(async (req, res) => {
  const { name, desc = '', color, start, end, notes = '', resources = [], defaultRole, members } = req.body
  const clean = normalizeResources(resources)
  const isAdmin = req.projectRole === 'admin'
  const ok = await tx(async (client) => {
    const r = await client.query(
      'UPDATE projects SET name = $2, description = $3, color = $4, start_date = $5, end_date = $6, notes = $7, resources = $8 WHERE id = $1 RETURNING id',
      [req.params.id, name, desc, color, start, end, notes, JSON.stringify(clean)]
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
app.get('/api/tasks', wrap(async (_req, res) => {
  res.json(await q(`${TASK_SELECT} ORDER BY t.id`))
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
app.get('/api/sessions', wrap(async (_req, res) => {
  res.json(await listSessions())
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
  res.status(201).json(await listSessions())
}))

// Para: fecha a sessão ativa do usuário.
app.post('/api/sessions/stop', wrap(async (req, res) => {
  await q('UPDATE time_sessions SET end_at = now() WHERE user_id = $1 AND end_at IS NULL', [req.body.userId])
  res.json(await listSessions())
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
