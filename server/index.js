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
         to_char(start_date, 'YYYY-MM-DD') AS start,
         to_char(end_date,   'YYYY-MM-DD') AS "end"
  FROM projects`

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
const PUBLIC_USER = 'id, name, initials, color, email'

// ----- autenticação (rotas públicas) -----
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Informe email e senha.' })
  const [row] = await q('SELECT id, name, initials, color, email, password_hash FROM users WHERE lower(email) = lower($1)', [email])
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
    q('SELECT id, name, initials, color FROM users ORDER BY id'),
    q(`${PROJECT_SELECT} ORDER BY id`),
    q(`${TASK_SELECT} ORDER BY t.id`),
    listSessions(),
  ])
  res.json({ users, projects, tasks, sessions })
}))

app.get('/api/users', wrap(async (_req, res) => {
  res.json(await q('SELECT id, name, initials, color FROM users ORDER BY id'))
}))

// ----- projetos -----
app.get('/api/projects', wrap(async (_req, res) => {
  res.json(await q(`${PROJECT_SELECT} ORDER BY id`))
}))

app.post('/api/projects', wrap(async (req, res) => {
  const { name, desc = '', color = 'indigo', start, end } = req.body
  const id = genId('p')
  await q(
    'INSERT INTO projects (id, name, description, color, start_date, end_date) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, name, desc, color, start, end]
  )
  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [id])
  res.status(201).json(row)
}))

app.put('/api/projects/:id', wrap(async (req, res) => {
  const { name, desc = '', color, start, end } = req.body
  const rows = await q(
    'UPDATE projects SET name = $2, description = $3, color = $4, start_date = $5, end_date = $6 WHERE id = $1 RETURNING id',
    [req.params.id, name, desc, color, start, end]
  )
  if (!rows.length) return res.status(404).json({ error: 'Projeto não encontrado.' })
  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [req.params.id])
  res.json(row)
}))

// Exclui o projeto; tasks/checklist/membros/sessões caem por ON DELETE CASCADE.
app.delete('/api/projects/:id', wrap(async (req, res) => {
  const rows = await q('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Projeto não encontrado.' })
  res.status(204).end()
}))

// ----- tarefas -----
app.get('/api/tasks', wrap(async (_req, res) => {
  res.json(await q(`${TASK_SELECT} ORDER BY t.id`))
}))

app.post('/api/tasks', wrap(async (req, res) => {
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

app.put('/api/tasks/:id', wrap(async (req, res) => {
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

// Mover entre colunas do Kanban (só o status).
app.patch('/api/tasks/:id/status', wrap(async (req, res) => {
  const rows = await q('UPDATE tasks SET status = $2 WHERE id = $1 RETURNING id', [req.params.id, req.body.status])
  if (!rows.length) return res.status(404).json({ error: 'Atividade não encontrada.' })
  res.json(await getTask(req.params.id))
}))

app.delete('/api/tasks/:id', wrap(async (req, res) => {
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
  console.error('[promav] erro na API:', err.message)
  res.status(500).json({ error: err.message })
})

app.listen(PORT, () => {
  console.log(`[promav] backend rodando em http://localhost:${PORT}`)
})
