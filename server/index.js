// ============================================================
// Promav — backend (Express + Neon/Postgres)
// API REST consumida pelo frontend React. As formas de dados
// retornadas espelham as de src/data/store.js para que as telas
// não precisem mudar (desc, memberIds, checklist, start/end…).
// ============================================================
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
// A versão 3 do pacote é ESM e expõe `create` em vez de uma função default.
import { create as contentDisposition } from 'content-disposition'
import { q, tx, pool } from './db.js'
import { requireAuth, signToken, signFileToken, verifyPassword, hashPassword, DUMMY_HASH } from './auth.js'
// Módulo puro (sem DOM/React) compartilhado com o frontend — só assim o
// backend concorda com a tela sobre o que conta como arquivo de mapa.
import { ehArquivoKmz } from '../src/components/Modals/shared/kmzGeo.js'

const app = express()
// O Render fica atrás de um proxy: sem isto req.ip é o IP do balanceador, e o
// limite de tentativas de login viraria um contador único para o mundo todo.
app.set('trust proxy', 1)

// CORS: o site (promav-web) e a API (promav-api) ficam em origens diferentes no Render.
// CORS_ORIGIN aceita uma lista separada por vírgula; ausente/"*" libera todas.
const origins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({ origin: origins.includes('*') ? true : origins }))
// gzip nas respostas. O bootstrap é JSON repetitivo e cai ~85% com gzip,
// o que importa porque ele é recarregado a cada mudança detectada pelo /pulse.
// Vem antes das rotas para envolver todas elas.
app.use(compression())
// 1 MB em vez dos 100 kb padrão: o relatório semanal aceita 30 projetos de
// até 20 KB de texto cada, e estourar o limite caía no 413 de arquivo.
app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 3001

// ---------- helpers ----------
// timestamp em base36 + 10 dígitos hex. Com 4 caracteres de Math.random o
// espaço era 36^4, e um lote gerado no mesmo milissegundo (as 11 etapas do
// template, até 50 itens de checklist) podia colidir na chave primária.
const genId = (prefix) => `${prefix}${Date.now().toString(36)}${randomBytes(5).toString('hex')}`

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
                                             'state', c.state, 'assigneeId', c.assignee_id) ORDER BY c.position, c.id)
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
         valor_estimado::float8   AS "valorEstimado",
         valor_orcado::float8     AS "valorOrcado",
         eh_convenio              AS "ehConvenio",
         convenio_numero          AS "convenioNumero",
         convenio_valor::float8   AS "convenioValor",
         status,
         tipo,
         responsible_ids AS "responsibleIds",
         COALESCE((
           SELECT json_agg(json_build_object('userId', pm.user_id, 'role', pm.role) ORDER BY pm.user_id)
           FROM project_members pm WHERE pm.project_id = projects.id
         ), '[]'::json) AS members,
         to_char(start_date, 'YYYY-MM-DD') AS start,
         to_char(end_date,   'YYYY-MM-DD') AS "end"
  FROM projects`

// Lista de pastas, na ordem em que devem aparecer na sidebar.
const FOLDER_SELECT = 'SELECT id, name, position, parent_id AS "parentId" FROM folders'

// Edições que a equipe faz em cima do desenho de um .kmz: renomear um trecho,
// pô-lo num grupo (rua, localidade) e/ou registrar quantos metros já foram
// executados. `id` casa com a posição que o parser do navegador atribui
// (kmzGeo.js/montarFeatures) — texto livre, então a única validação possível
// aqui é não deixar passar lixo.
function normSegmentos(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((s) => {
      if (!s || typeof s.id !== 'string' || !s.id) return null
      const nome = typeof s.nome === 'string' ? s.nome.trim().slice(0, 200) : ''
      const grupo = typeof s.grupo === 'string' ? s.grupo.trim().slice(0, 120) : ''
      const exec = Number(s.extensaoExecutadaM)
      const item = { id: s.id }
      if (nome) item.nome = nome
      if (grupo) item.grupo = grupo
      if (Number.isFinite(exec) && exec >= 0) item.extensaoExecutadaM = exec
      // Trecho apagado: o desenho continua no arquivo, só deixa de aparecer.
      if (s.removido === true) item.removido = true
      // Sem nome, grupo, extensão executada nem remoção não há edição nenhuma para guardar.
      return (item.nome || item.grupo || item.extensaoExecutadaM != null || item.removido) ? item : null
    })
    .filter(Boolean)
}

// Normaliza os recursos do projeto antes de gravar. Há dois formatos:
//  • externo  → { id, type, url, label }            (link colado: docs.google, etc.)
//  • upload   → { id, type, fileId, filename, mime, size, label }  (arquivo no banco)
// Um .kmz (novo ou o legado salvo como 'doc', ver ehArquivoKmz) ainda carrega
// `segments`: as edições de nome/execução feitas na aba "Tipo de obra".
function normalizeResources(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((r) => {
      if (!r) return null
      const type = ['image', 'doc', 'link', 'kmz'].includes(r.type) ? r.type : 'link'
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      if (r.fileId) {
        const base = {
          id: r.id || genId('r'), type, fileId: r.fileId,
          filename: typeof r.filename === 'string' ? r.filename : '',
          mime: typeof r.mime === 'string' ? r.mime : '',
          size: Number(r.size) || 0,
          label,
        }
        if (ehArquivoKmz(base)) {
          const segments = normSegmentos(r.segments)
          if (segments.length) base.segments = segments
        }
        return base
      }
      if (typeof r.url === 'string' && r.url.trim()) {
        const bruto = r.url.trim()
        // Sem esquema vira https (como o cliente faz). Só http(s) e mailto passam:
        // javascript:/data: viram <a href> na Ficha técnica, e isto é XSS persistente.
        // Um legado sem esquema não é rejeitado porque esta função roda de novo
        // sobre o que já está gravado (POST/DELETE resources, upload) — ele
        // sumiria em silêncio na próxima gravação.
        const url = /^[a-z][a-z0-9+.-]*:/i.test(bruto) ? bruto : 'https://' + bruto
        if (!/^(https?:|mailto:)/i.test(url)) return null
        return { id: r.id || genId('r'), type, url, label }
      }
      return null
    })
    .filter(Boolean)
}

// ----- dados do convênio (ficha do projeto) -----
// Origem do recurso e status do projeto: listas fixas (espelham store.js).
const ORIGENS_RECURSO = ['federal', 'estadual', 'municipal', 'emenda', 'outro']
const PROJ_STATUSES = ['planejamento', 'andamento', 'revisao', 'pendente', 'diligencia', 'paralisado', 'concluido']
// Cores do enum project_color (espelham PROJECT_COLORS do store.js).
const PROJ_CORES = ['indigo', 'blue', 'teal', 'green', 'amber', 'coral', 'pink', 'purple']
// Tipo de obra: mesma lista de PROJECT_TYPES (store.js). Texto livre na coluna,
// então um tipo novo não pede migração — basta entrar aqui e lá.
const PROJ_TIPOS = ['picarramento', 'pavimentacao', 'construcao', 'reforma']
const normOrigem = (v) => (ORIGENS_RECURSO.includes(v) ? v : 'federal')
const normProjStatus = (v) => (PROJ_STATUSES.includes(v) ? v : 'planejamento')
const normTipo = (v) => (PROJ_TIPOS.includes(v) ? v : 'construcao')
const normCor = (c) => (PROJ_CORES.includes(c) ? c : 'indigo')
// Valor do convênio: número >= 0 ou null (não informado).
// Número do convênio: texto curto e livre, porque o formato varia (030979/2026,
// CONV.002202.2026, MAPP 6112) — daí o corte por tamanho, e não por formato.
const normConvenioNumero = (v) => {
  const t = String(v || '').trim()
  return t ? t.slice(0, 60) : null
}

const normValor = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}
// Profissionais responsáveis: lista de ids de usuários, sem duplicados.
const normResponsibles = (v) =>
  Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []

// Nome, cor e pasta do projeto. São os três campos que o banco recusava por
// conta própria (NOT NULL, enum project_color, FK de folder_id) e o erro cru
// voltava como 500 — aqui viram 400 com texto que dá para mostrar na tela.
async function validarProjeto(body) {
  const name = String(body.name || '').trim()
  if (!name) return { erro: 'Informe o nome do projeto.' }
  const folderId = body.folderId || null
  if (folderId) {
    const [f] = await q('SELECT id FROM folders WHERE id = $1', [folderId])
    if (!f) return { erro: 'Pasta não encontrada.' }
  }
  return { name, folderId, color: normCor(body.color) }
}

// Papéis válidos por projeto: 'full' (Edição total) e 'view' (Só exibição).
// Só project_members e users.is_admin dão acesso: quem não está na tabela não
// enxerga o projeto.
const ROLES = ['full', 'view']
const normRole = (r) => (ROLES.includes(r) ? r : 'view')

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

// Enums task_status/task_priority (espelham STATUSES/PRIORITIES do store.js).
// Título, status e prioridade iam crus para o banco: valor fora do enum ou
// título vazio estouravam lá dentro e voltavam como 500.
const TASK_STATUSES = ['todo', 'progress', 'review', 'diligence', 'done']
const TASK_PRIORITIES = ['low', 'medium', 'high']
function validarTarefa(body) {
  const title = String(body.title || '').trim()
  if (!title) return { erro: 'Informe o título da etapa.' }
  const status = body.status ?? 'todo'
  const priority = body.priority ?? 'medium'
  if (!TASK_STATUSES.includes(status)) return { erro: 'Status inválido.' }
  if (!TASK_PRIORITIES.includes(priority)) return { erro: 'Prioridade inválida.' }
  return { title, status, priority }
}

// Papel a partir do usuário já carregado (req.user) e do papel gravado em
// project_members (undefined quando não é membro): admin global > membro > nada.
const papelDe = (req, role) => (req.user.is_admin ? 'admin' : role ? normRole(role) : null)

// Papel efetivo de um usuário num projeto: admin global > pessoa incluída no projeto.
// Quem NÃO foi incluído não tem papel nenhum (null) — não enxerga o projeto.
// É este null que faz o gate() barrar todas as rotas do projeto.
// Admin não vai ao banco: req.user, carregado uma vez por requisição, já diz.
async function effectiveRole(req, projectId) {
  if (req.user.is_admin) return 'admin'
  const [m] = await q('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, req.userId])
  return papelDe(req, m?.role)
}

// Ids dos projetos que um usuário enxerga. Admin vê todos (null = sem filtro).
async function visibleProjectIds(req) {
  if (req.user.is_admin) return null
  const rows = await q('SELECT project_id FROM project_members WHERE user_id = $1', [req.userId])
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

// Middleware: exige que o usuário tenha um papel permitido no projeto.
// resolveProjectId pode ser um valor ou uma função (req) => id (síncrona ou async).
function gate(resolveProjectId, allowed) {
  return wrap(async (req, res, next) => {
    const pid = typeof resolveProjectId === 'function' ? await resolveProjectId(req) : resolveProjectId
    if (!pid) return res.status(404).json({ error: 'Projeto não encontrado.' })
    const role = await effectiveRole(req, pid)
    if (!allowed.includes(role)) return res.status(403).json({ error: 'Você não tem permissão para esta ação.' })
    req.projectRole = role
    next()
  })
}

// Gate das rotas /tasks/:id: projeto da tarefa e papel numa ida só — eram duas
// em série (project_id da tarefa, depois project_members). Tarefa inexistente
// → 404, mesma semântica do gate genérico. Deixa o projeto em req.taskProjectId
// para o handler não repetir a consulta.
function gateTask(allowed) {
  return wrap(async (req, res, next) => {
    const [r] = await q(
      `SELECT t.project_id, pm.role
         FROM tasks t
         LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = $2
        WHERE t.id = $1`, [req.params.id, req.userId])
    if (!r) return res.status(404).json({ error: 'Projeto não encontrado.' })
    const role = papelDe(req, r.role)
    if (!allowed.includes(role)) return res.status(403).json({ error: 'Você não tem permissão para esta ação.' })
    req.projectRole = role
    req.taskProjectId = r.project_id
    next()
  })
}

// Só administradores globais.
const requireAdmin = wrap(async (req, res, next) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Apenas administradores.' })
  next()
})

// Substitui as exceções de permissão (project_members) de um projeto.
// Duas idas ao banco em vez de uma por pessoa: com o Postgres do outro lado da
// rede o custo é quase todo de ida e volta.
async function replaceMembers(client, projectId, members) {
  // Um papel por pessoa: ON CONFLICT DO UPDATE não aceita a mesma chave duas
  // vezes no mesmo comando, e o corpo pode chegar com a pessoa repetida.
  const porUser = new Map()
  for (const m of members || []) if (m && m.userId && ROLES.includes(m.role)) porUser.set(m.userId, m.role)
  const ids = [...porUser.keys()]
  await client.query('DELETE FROM project_members WHERE project_id = $1 AND user_id <> ALL($2::text[])', [projectId, ids])
  if (ids.length) {
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role)
       SELECT $1, t.u, t.r FROM unnest($2::text[], $3::text[]) AS t(u, r)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [projectId, ids, ids.map(u => porUser.get(u))])
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

async function getTask(id) {
  const rows = await q(`${TASK_SELECT} WHERE t.id = $1`, [id])
  return rows[0] ? mapTask(rows[0]) : null
}

// Substitui checklist e membros de uma tarefa.
//
// Upsert por id, e não apaga-e-reinsere: o id do item é apontado por
// changes.checklist_item_id (FK ON DELETE SET NULL), então apagar tudo rompia
// o vínculo mudança→item a cada salvamento do modal. O que saiu da lista é
// removido depois, num comando só.
//
// As colunas viram arrays e tudo entra num INSERT (unnest), como já fazem POST
// /stages e POST /checklist: eram até 11 idas ao banco por salvamento, e o
// custo é quase todo de ida e volta.
async function replaceChildren(client, taskId, checklist = [], memberIds = [], assigneeId) {
  // Quem responde por CADA item. Uma atividade com duas pessoas costuma ter
  // cada uma cuidando de uma parte; sem isto só dá para saber que "alguém do
  // par" está devendo. Aceita null: ligar o item a alguém não é obrigatório.
  const podeAssumir = new Set([assigneeId, ...(memberIds || [])].filter(Boolean))
  // Id repetido no mesmo corpo derrubaria o ON CONFLICT DO UPDATE ("cannot
  // affect row a second time") — vale a primeira ocorrência.
  const vistos = new Set()
  const linhas = (checklist || [])
    .filter((item) => item && (!item.id || (!vistos.has(item.id) && !!vistos.add(item.id))))
    .map((item, i) => {
      // Estado e `done` andam juntos. Item vindo de fora sem estado (modal antigo,
      // mudanca que vira item) cai no equivalente do que o `done` dizia.
      const estado = ESTADOS_ITEM.includes(item.state) ? item.state : (item.done ? 'done' : 'todo')
      return {
        id: item.id || genId('c'),
        text: item.text,
        done: estado === 'done',
        pos: i,
        // Só vale quem participa da atividade — o seletor mostra só eles, mas
        // o servidor não confia no que chega.
        dono: podeAssumir.has(item.assigneeId) ? item.assigneeId : null,
        estado,
      }
    })
  const ids = linhas.map((l) => l.id)
  if (linhas.length) {
    await client.query(
      `INSERT INTO checklist_items (id, task_id, text, done, position, assignee_id, state)
       SELECT e.id, $1, e.text, e.done, e.pos, e.dono, e.state
         FROM unnest($2::text[], $3::text[], $4::bool[], $5::int[], $6::text[], $7::text[]) AS e(id, text, done, pos, dono, state)
       ON CONFLICT (id) DO UPDATE
         SET text = EXCLUDED.text, done = EXCLUDED.done, position = EXCLUDED.position,
             assignee_id = EXCLUDED.assignee_id, state = EXCLUDED.state
         -- id de item de OUTRA tarefa não é sequestrado por quem montou o corpo.
         WHERE checklist_items.task_id = EXCLUDED.task_id`,
      [taskId, ids, linhas.map((l) => l.text), linhas.map((l) => l.done), linhas.map((l) => l.pos),
       linhas.map((l) => l.dono), linhas.map((l) => l.estado)])
  }
  await client.query('DELETE FROM checklist_items WHERE task_id = $1 AND id <> ALL($2::text[])', [taskId, ids])

  // membros = lista informada, sem o responsável (ele já é o assignee).
  const members = [...new Set((memberIds || []).filter((u) => u && u !== assigneeId))]
  await client.query('DELETE FROM task_members WHERE task_id = $1 AND user_id <> ALL($2::text[])', [taskId, members])
  if (members.length) {
    await client.query(
      'INSERT INTO task_members (task_id, user_id) SELECT $1, u FROM unnest($2::text[]) AS u ON CONFLICT DO NOTHING',
      [taskId, members])
  }
}

// ============================================================
// Rotas
// ============================================================

app.get('/api/health', wrap(async (_req, res) => {
  const [{ now }] = await q('SELECT now()')
  res.json({ ok: true, now })
}))

// Forma pública de um usuário (sem hash de senha) — login, /auth/me, listas.
const LIST_USER = 'id, name, initials, color, email, short_name AS "shortName", phone, sector, job_title AS "jobTitle", formation, professional_register AS "professionalRegister", is_admin AS "isAdmin", is_active AS "isActive", is_outsourced AS "isOutsourced", is_dev AS "isDev"'

// ----- autenticação (rotas públicas) -----

// 10 tentativas por 15 min, por IP e e-mail. A API é pública na internet e não
// havia freio nenhum contra força bruta.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').toLowerCase()}`,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
})

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  // O TIPO é conferido, não só a presença: `email: [1]` chegava ao Postgres e
  // voltava como 500 na cara de quem tentou entrar.
  const { email, password } = req.body || {}
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Informe email e senha.' })
  }
  // A MESMA forma das outras rotas: o front usa este objeto como authUser até
  // o próximo F5, e sem `sector` os avisos endereçados ao setor não apareciam.
  const [row] = await q(`SELECT ${LIST_USER}, must_change_password AS "mustChangePassword", password_hash FROM users WHERE lower(email) = lower($1)`, [email])
  // Terceirizado não acessa, e a regra é dita AQUI em vez de depender de ele
  // não ter senha. Ausência de senha é uma ausência: bastaria uma importação
  // ou um formulário mal preenchido gravar um hash para o acesso reabrir em
  // silêncio. Com a checagem explícita, o que vale é o vínculo.
  //
  // Mesma mensagem genérica para senha errada, e-mail inexistente, conta
  // inativa ou terceirizado — nenhuma pode revelar se a conta existe.
  // bcrypt roda SEMPRE — contra um hash de sacrifício quando não há conta ou
  // senha gravada. Pulá-lo fazia a resposta voltar na hora, e esse tempo dizia
  // a quem tentasse se aquele e-mail está cadastrado.
  const senhaOk = await verifyPassword(password, row?.password_hash || DUMMY_HASH)
  if (!row || row.isActive === false || row.isOutsourced || !row.password_hash || !senhaOk) {
    return res.status(401).json({ error: 'Email ou senha incorretos.' })
  }
  const { password_hash, ...user } = row
  res.json({ token: signToken(user), user })
}))

// ===== a partir daqui, tudo exige autenticação =====
app.use('/api', requireAuth)

// Carrega o usuário autenticado uma vez por requisição. Quem foi inativado,
// virou terceirizado ou foi excluído perde o acesso aqui, mesmo com token
// ainda válido por dias (o front trata 401 derrubando a sessão — api.js).
// Os gates e o requireAdmin leem req.user em vez de repetir o SELECT.
app.use('/api', wrap(async (req, res, next) => {
  const [u] = await q('SELECT id, is_admin, is_active, is_outsourced FROM users WHERE id = $1', [req.userId])
  if (!u || u.is_active === false || u.is_outsourced) return res.status(401).json({ error: 'Sessão encerrada.' })
  req.user = u
  next()
}))

// Carimbo do estado do banco — o front consulta de tempos em tempos e só
// refaz o /bootstrap (dezenas de KB) quando o valor muda. A resposta tem ~100 bytes.
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
         (SELECT max(updated_at) FROM folders)   AS pastas_t,
         (SELECT count(*) FROM users)            AS usuarios_n,
         (SELECT max(updated_at) FROM users)     AS usuarios_t,
         (SELECT count(*) FROM checklist_items)  AS checklist_n,
         (SELECT count(*) FROM task_members)     AS membros_tarefa_n,
         (SELECT count(*) FROM project_members)  AS membros_projeto_n,
         -- Sem isto o aviso de relatorio no Hub envelhecia: o bootstrap so e
         -- refeito quando o pulso muda, e salvar um relatorio nao mexia em
         -- nenhuma das contagens acima. O updated_at cobre rascunho e envio.
         (SELECT count(*) FROM weekly_reports)   AS relatorios_n,
         (SELECT max(updated_at) FROM weekly_reports)                                       AS relatorios_t
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
  const [user] = await q(`SELECT ${LIST_USER}, must_change_password AS "mustChangePassword" FROM users WHERE id = $1`, [req.userId])
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' })
  res.json(user)
}))

// Trocar a própria senha.
app.post('/api/auth/change-password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'A nova senha precisa ter ao menos 6 caracteres.' })
  const [row] = await q('SELECT password_hash FROM users WHERE id = $1', [req.userId])
  // 400, não 401: é validação do corpo. O cliente (api.js) trata qualquer 401
  // fora do login como sessão expirada e deslogaria por um erro de digitação.
  if (!row || !row.password_hash || !(await verifyPassword(currentPassword || '', row.password_hash))) {
    return res.status(400).json({ error: 'Senha atual incorreta.' })
  }
  // Trocar a própria senha é o que encerra a provisoriedade: a senha deixa de
  // ser a que o administrador escolheu.
  await q('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [req.userId, await hashPassword(newPassword)])
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
// que roda em série antes); hoje é UMA — quem é admin e quais projetos a
// pessoa enxerga cabem nas CTEs `eu` e `vis`, dentro da própria consulta.
const BOOTSTRAP_SQL = `
  WITH eu  AS (SELECT is_admin FROM users WHERE id = $1),
       vis AS (SELECT project_id FROM project_members WHERE user_id = $1)
  SELECT
    (SELECT is_admin FROM eu) AS "souAdmin",
    (SELECT COALESCE(json_agg(u), '[]'::json) FROM (
       SELECT id, name, initials, color, email, short_name AS "shortName",
              -- Telefone e registro profissional só saem para admin: as únicas
              -- telas que os mostram (Profissionais e a ficha do profissional)
              -- já são só de admin, então para o resto da equipe isto era
              -- contato pessoal viajando sem ninguém para ler.
              CASE WHEN (SELECT is_admin FROM eu) THEN phone END AS phone,
              sector, job_title AS "jobTitle", formation,
              CASE WHEN (SELECT is_admin FROM eu) THEN professional_register END AS "professionalRegister",
              is_admin AS "isAdmin", is_active AS "isActive", is_outsourced AS "isOutsourced", is_dev AS "isDev"
         FROM users ORDER BY id) u) AS users,
    (SELECT COALESCE(json_agg(p), '[]'::json) FROM (${PROJECT_SELECT} WHERE (SELECT is_admin FROM eu) OR id IN (SELECT project_id FROM vis) ORDER BY position, id) p) AS projects,
    (SELECT COALESCE(json_agg(t), '[]'::json) FROM (${TASK_SELECT} WHERE (SELECT is_admin FROM eu) OR t.project_id IN (SELECT project_id FROM vis) ORDER BY t.id) t) AS tasks,
    (SELECT COALESCE(json_agg(s), '[]'::json) FROM (${SESSION_SELECT} WHERE (SELECT is_admin FROM eu) OR task_id IN (SELECT id FROM tasks WHERE project_id IN (SELECT project_id FROM vis)) ORDER BY start_at) s) AS sessions,
    (SELECT COALESCE(json_agg(f), '[]'::json) FROM (${FOLDER_SELECT} ORDER BY position, name) f) AS folders,
    (SELECT COALESCE(json_agg(c), '[]'::json) FROM (${CHANGE_SELECT} WHERE (SELECT is_admin FROM eu) OR c.project_id IN (SELECT project_id FROM vis) ORDER BY c.published_at DESC) c) AS changes,
    -- Em que pe esta o relatorio DESTA pessoa NESTA semana. Vem aqui porque o
    -- bootstrap ja acontece: o Hub perguntando por conta propria custava uma
    -- ida extra a cada visita e, com cache, mostrava o aviso depois de enviado.
    COALESCE((SELECT CASE WHEN sent_at IS NULL THEN 'rascunho' ELSE 'enviado' END
                FROM weekly_reports WHERE user_id = $1 AND week = $2::date), 'nenhum') AS "relatorioSemana"
`

app.get('/api/bootstrap', wrap(async (req, res) => {
  const [linha] = await q(BOOTSTRAP_SQL, [req.userId, sextaDe()])
  const all = !!linha.souAdmin
  const tasks = (linha.tasks || []).map(mapTask)
  const sessions = (linha.sessions || []).map(mapSession)
  const changes = (linha.changes || []).map(mapChange)
  const projects = linha.projects || []
  const folders = linha.folders || []

  res.json({
    users: linha.users || [], projects, tasks, sessions, changes,
    folders: all ? folders : foldersWithProjects(folders, projects),
    relatorioSemana: linha.relatorioSemana,
  })
}))

// Corpo de POST/PUT /users: as duas rotas validavam e normalizavam os mesmos
// catorze campos em ~60 linhas repetidas, e a repetição já tinha deixado as
// duas diferentes entre si. O que é de cada rota (senha obrigatória na
// criação, regras de último admin na edição) fica nela.
async function parseUserBody(body = {}) {
  const { name, phone, shortName, email, sector = null, jobTitle = null, formation = null, professionalRegister = null,
          initials = '', color = 'var(--proj-blue)', isAdmin = false, isActive = true, isOutsourced = false, initialPassword } = body
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim()
  const terceirizado = !!isOutsourced
  if (!cleanName) return { erro: 'O nome é obrigatório.' }
  // E-mail é credencial para quem entra no sistema; para terceirizado é só
  // contato, e contato pode não existir.
  if (!terceirizado && !cleanEmail) return { erro: 'O e-mail é obrigatório.' }
  const senha = typeof initialPassword === 'string' ? initialPassword.trim() : ''
  if (senha && senha.length < 6) return { erro: 'A senha inicial precisa ter ao menos 6 caracteres.' }
  const finalInitials = (String(initials || '').trim() || (() => {
    const parts = cleanName.split(/\s+/).filter(Boolean)
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  })()).toUpperCase()
  return {
    campos: [cleanName, finalInitials, color || 'var(--proj-blue)', cleanEmail || null, phone || null, shortName || null,
             sector || null, jobTitle || null, normFormacao(formation), normRegistro(formation, sector, jobTitle, professionalRegister),
             !!isAdmin, isActive !== false, terceirizado],
    cleanEmail, terceirizado, nextIsAdmin: !!isAdmin, nextIsActive: isActive !== false,
    // Terceirizado não tem login: fica sem senha nenhuma, nem uma inutilizável.
    passwordHash: senha && !terceirizado ? await hashPassword(senha) : null,
  }
}

// E-mail já usado por OUTRO usuário (case-insensitive, como no login).
async function emailEmUso(email, exceptId = null) {
  const [e] = await q('SELECT id FROM users WHERE lower(email) = lower($1) AND ($2::text IS NULL OR id <> $2)', [email, exceptId])
  return !!e
}

app.post('/api/users', requireAdmin, wrap(async (req, res) => {
  const v = await parseUserBody(req.body)
  if (v.erro) return res.status(400).json({ error: v.erro })
  // Na criação a senha é obrigatória para quem vai entrar no sistema; na
  // edição, campo vazio quer dizer "não trocar".
  if (!v.terceirizado && !v.passwordHash) {
    return res.status(400).json({ error: 'A senha inicial precisa ter ao menos 6 caracteres.' })
  }
  if (v.cleanEmail && await emailEmUso(v.cleanEmail)) {
    return res.status(409).json({ error: `O e-mail "${v.cleanEmail}" já está em uso.` })
  }

  const id = genId('u')
  await q(`
    INSERT INTO users (id, name, initials, color, email, phone, short_name, sector, job_title, formation, professional_register, is_admin, is_active, is_outsourced, password_hash, is_dev, must_change_password)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false, $15::text IS NOT NULL)
  `, [id, ...v.campos, v.passwordHash])

  const [row] = await q(`SELECT ${LIST_USER} FROM users WHERE id = $1`, [id])
  res.status(201).json(row)
}))

app.put('/api/users/:id', requireAdmin, wrap(async (req, res) => {
  const v = await parseUserBody(req.body)
  if (v.erro) return res.status(400).json({ error: v.erro })

  const [target] = await q('SELECT is_admin AS "isAdmin", is_active AS "isActive", is_outsourced AS "isOutsourced" FROM users WHERE id = $1', [req.params.id])
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' })
  const isSelf = req.userId === req.params.id

  // Um admin nunca pode tirar a própria permissão — só outro admin pode fazer
  // isso, senão a conta se tranca fora do próprio sistema.
  if (isSelf && target.isAdmin && !v.nextIsAdmin) {
    return res.status(400).json({ error: 'Você não pode remover sua própria permissão de administrador.' })
  }
  // Ninguém desativa a própria conta — pelo mesmo motivo: ficaria sem acesso
  // sem ter como reverter sozinho.
  if (isSelf && target.isActive && !v.nextIsActive) {
    return res.status(400).json({ error: 'Você não pode desativar sua própria conta.' })
  }
  // O login barra terceirizado, então marcar a própria conta é se trancar
  // fora — o mesmo efeito de se desativar.
  if (isSelf && v.terceirizado) {
    return res.status(400).json({ error: 'Você não pode marcar a própria conta como terceirizada.' })
  }

  // O sistema nunca pode ficar sem nenhum administrador ativo: bloqueia tirar
  // o "is_admin", inativar e também marcar como terceirizado quem for o último
  // admin ativo restante. Terceirizado conta como sem acesso porque o login o
  // barra — sem isto, a marca era o caminho para trancar todo mundo fora.
  const wasActiveAdmin = target.isAdmin && target.isActive && !target.isOutsourced
  const willBeActiveAdmin = v.nextIsAdmin && v.nextIsActive && !v.terceirizado
  if (wasActiveAdmin && !willBeActiveAdmin) {
    const [{ count }] = await q('SELECT count(*)::int AS count FROM users WHERE is_admin = true AND is_active = true AND is_outsourced = false')
    if (count <= 1) {
      return res.status(400).json({ error: 'Não é possível remover o último administrador ativo do sistema. Promova outra pessoa antes de continuar.' })
    }
  }

  if (v.cleanEmail && await emailEmUso(v.cleanEmail, req.params.id)) {
    return res.status(409).json({ error: `O e-mail "${v.cleanEmail}" já está em uso.` })
  }

  await q(`
    UPDATE users
    SET name = $2,
        initials = $3,
        color = $4,
        email = $5,
        phone = $6,
        short_name = $7,
        sector = $8,
        job_title = $9,
        formation = $10,
        professional_register = $11,
        is_admin = $12,
        is_active = $13,
        is_outsourced = $14,
        -- Passar alguém para terceirizado apaga a senha que ele tinha: o hash
        -- antigo ficaria guardado, esperando o dia em que a marca fosse
        -- removida por engano. Sem senha nova no corpo, o hash atual fica.
        password_hash = CASE WHEN $14 THEN NULL ELSE COALESCE($15, password_hash) END,
        -- Senha nova vinda do admin entra como provisória. Terceirizado não tem
        -- login, então a marca sai junto com o hash. Sem senha no corpo, nada muda.
        must_change_password = CASE WHEN $14 THEN false WHEN $15::text IS NOT NULL THEN true ELSE must_change_password END,
        updated_at = now()
    WHERE id = $1
  `, [req.params.id, ...v.campos, v.passwordHash])

  const [row] = await q(`SELECT ${LIST_USER} FROM users WHERE id = $1`, [req.params.id])
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado.' })
  res.json(row)
}))

// Exclusão definitiva de um profissional. Sessões de cronômetro e vínculos
// de projeto/tarefa desse usuário são apagados/desvinculados em cascata pelo
// próprio banco (ON DELETE); não há checagem de histórico aqui de propósito.
app.delete('/api/users/:id', requireAdmin, wrap(async (req, res) => {
  const [target] = await q('SELECT is_admin AS "isAdmin", is_active AS "isActive", is_outsourced AS "isOutsourced" FROM users WHERE id = $1', [req.params.id])
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' })

  if (req.userId === req.params.id) {
    return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' })
  }
  if (target.isAdmin && target.isActive && !target.isOutsourced) {
    const [{ count }] = await q('SELECT count(*)::int AS count FROM users WHERE is_admin = true AND is_active = true AND is_outsourced = false')
    if (count <= 1) {
      return res.status(400).json({ error: 'Não é possível excluir o último administrador ativo do sistema. Promova outra pessoa antes de continuar.' })
    }
  }

  try {
    await tx(async (client) => {
      // responsible_ids e target_user_ids são jsonb sem FK: o banco não limpa.
      // Sem isto o projeto fica com responsável fantasma e sem a pendência
      // 'Profissional responsável' (store.js decide pelo .length).
      await client.query(
        'UPDATE projects SET responsible_ids = responsible_ids - $1::text, updated_at = now() WHERE responsible_ids ? $1::text',
        [req.params.id])
      await client.query(
        'UPDATE changes SET target_user_ids = target_user_ids - $1::text WHERE target_user_ids ? $1::text',
        [req.params.id])
      await client.query('DELETE FROM users WHERE id = $1', [req.params.id])
    })
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Não é possível excluir: este profissional publicou ou editou uma mudança registrada no sistema, e esse histórico precisa ser mantido. Inative o profissional em vez de excluir.' })
    }
    throw e
  }
  res.status(204).end()
}))

// ----- projetos -----
// Criar projeto: só administradores. Já grava as exceções por pessoa.
app.post('/api/projects', requireAdmin, wrap(async (req, res) => {
  const {
    desc = '', start, end, notes = '', resources = [], members = [],
    prefeitura = '', secretaria = '', origemRecurso, valorEstimado, valorOrcado, status, tipo, responsibleIds = [],
    ehConvenio = false, convenioNumero = null, convenioValor = null,
  } = req.body
  const v = await validarProjeto(req.body)
  if (v.erro) return res.status(400).json({ error: v.erro })
  const id = genId('p')

  await tx(async (client) => {
    const [{ position }] = await client.query(
      'SELECT COALESCE(max(position), -1) + 1 AS position FROM projects WHERE folder_id IS NOT DISTINCT FROM $1',
      [v.folderId]
    ).then(result => result.rows)
    const clean = normalizeResources(resources)
    await client.query(
      `INSERT INTO projects (id, name, description, color, folder_id, position, start_date, end_date, notes, resources,
                            prefeitura, secretaria, origem_recurso, valor_estimado, valor_orcado, status, tipo, responsible_ids,
                            eh_convenio, convenio_numero, convenio_valor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [id, v.name, desc, v.color, v.folderId, position, normData(start), normData(end), notes, JSON.stringify(clean),
       String(prefeitura || '').trim(), String(secretaria || '').trim(), normOrigem(origemRecurso),
       normValor(valorEstimado), normValor(valorOrcado), normProjStatus(status), normTipo(tipo),
       JSON.stringify(normResponsibles(responsibleIds)),
       !!ehConvenio, ehConvenio ? normConvenioNumero(convenioNumero) : null, ehConvenio ? normValor(convenioValor) : null]
    )
    await replaceMembers(client, id, members)
  })

  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [id])
  res.status(201).json(row)
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
  // Um comando só: eram 11 idas ao banco para reordenar 11 projetos, e o custo
  // é quase todo de ida e volta. `updated_at` entra porque o /pulse não tem
  // outro jeito de enxergar a nova ordem — reordenar não muda contagem nenhuma.
  if (orderedIds.length) {
    await q(
      `UPDATE projects p SET folder_id = $2, position = x.ord - 1, updated_at = now()
         FROM unnest($1::text[]) WITH ORDINALITY AS x(id, ord)
        WHERE p.id = x.id`, [orderedIds, folderId])
  }
  res.status(204).end()
}))

// Editar projeto: precisa de Edição total. As exceções por pessoa (permissões)
// só são alteradas por administradores.
app.put('/api/projects/:id', gate((req) => req.params.id, CAN.edit), wrap(async (req, res) => {
  const {
    desc = '', start, end, notes = '', resources = [], members,
    prefeitura = '', secretaria = '', origemRecurso, valorEstimado, valorOrcado, status, tipo, responsibleIds = [],
    ehConvenio = false, convenioNumero = null, convenioValor = null,
  } = req.body
  const v = await validarProjeto(req.body)
  if (v.erro) return res.status(400).json({ error: v.erro })
  const clean = normalizeResources(resources)
  const isAdmin = req.projectRole === 'admin'
  const ok = await tx(async (client) => {
    const r = await client.query(
      `UPDATE projects SET name = $2, description = $3, color = $4,
                           -- Trocou de pasta? O projeto vai para o fim da pasta nova; se
                           -- mantivesse a posição antiga, empataria com um projeto de lá.
                           -- (Dentro do SET, folder_id e position ainda são os valores
                           -- antigos da linha.)
                           position = CASE WHEN folder_id IS DISTINCT FROM $5
                                           THEN (SELECT COALESCE(max(position), -1) + 1 FROM projects WHERE folder_id IS NOT DISTINCT FROM $5)
                                           ELSE position END,
                           folder_id = $5, start_date = $6, end_date = $7, notes = $8, resources = $9,
                           prefeitura = $10, secretaria = $11, origem_recurso = $12, valor_estimado = $13, valor_orcado = $14, status = $15, tipo = $16, responsible_ids = $17,
                           eh_convenio = $18, convenio_numero = $19, convenio_valor = $20,
                           updated_at = now()
       WHERE id = $1 RETURNING id`,
      [req.params.id, v.name, desc, v.color, v.folderId, normData(start), normData(end), notes, JSON.stringify(clean),
       String(prefeitura || '').trim(), String(secretaria || '').trim(), normOrigem(origemRecurso), normValor(valorEstimado), normValor(valorOrcado), normProjStatus(status), normTipo(tipo), JSON.stringify(normResponsibles(responsibleIds)),
       // Desmarcar "é convênio" leva junto o número e o valor. Sem isso eles
       // ficariam guardados, invisíveis na tela, e voltariam se alguém
       // remarcasse a caixa meses depois.
       !!ehConvenio, ehConvenio ? normConvenioNumero(convenioNumero) : null, ehConvenio ? normValor(convenioValor) : null]
    )
    if (!r.rows.length) return false
    await pruneOrphanFiles(client, req.params.id, clean) // remove arquivos não referenciados
    if (isAdmin && Array.isArray(members)) await replaceMembers(client, req.params.id, members)
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
    await client.query('UPDATE projects SET resources = $2, updated_at = now() WHERE id = $1', [req.params.id, JSON.stringify(next)])
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
    await client.query('UPDATE projects SET resources = $2, updated_at = now() WHERE id = $1', [req.params.id, JSON.stringify(next)])
    await pruneOrphanFiles(client, req.params.id, next)
    return true
  })
  if (!ok) return res.status(404).json({ error: 'Projeto não encontrado.' })
  const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [req.params.id])
  res.json(row)
}))

// ----- pastas (agrupam projetos na sidebar) -----
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
  // Mesmo motivo do reorder de projetos: um comando em vez de uma ida por
  // pasta, e `updated_at` porque o /pulse não tem outro jeito de enxergar a
  // nova ordem — reordenar não muda contagem nenhuma.
  if (orderedIds.length) {
    await q(
      `UPDATE folders f SET parent_id = $2, position = x.ord - 1, updated_at = now()
         FROM unnest($1::text[]) WITH ORDINALITY AS x(id, ord)
        WHERE f.id = x.id`, [orderedIds, parentId])
  }
  res.status(204).end()
}))

// Renomear pasta: só administradores.
app.put('/api/folders/:id', requireAdmin, wrap(async (req, res) => {
  const name = (req.body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Informe um nome para a pasta.' })
  const rows = await q('UPDATE folders SET name = $2, updated_at = now() WHERE id = $1 RETURNING id', [req.params.id, name])
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
// Tipos que podem abrir inline com o Content-Type real. SVG fica de fora de
// propósito: é XML e executa <script> na origem da API.
const MIME_INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])

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
    const kind = ['doc', 'image', 'kmz'].includes(req.query.kind) ? req.query.kind : 'doc'
    const filename = (req.query.filename || 'arquivo').toString().slice(0, 255)
    const label = (req.query.label || '').toString().trim()
    // mime real vem na query (o corpo é enviado como octet-stream — ver api.js).
    const mimeInformado = (req.query.mime || req.headers['content-type'] || 'application/octet-stream').toString()
    // Fora da allowlist grava octet-stream, para o GET nunca devolver um
    // Content-Type executável (text/html, image/svg+xml). Tipo desconhecido não
    // é recusado: o navegador manda file.type vazio para .dwg/.zip/.kmz, e
    // recusar quebraria uploads legítimos.
    const mime = MIME_INLINE.has(mimeInformado) ? mimeInformado : 'application/octet-stream'

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
      await client.query('UPDATE projects SET resources = $2, updated_at = now() WHERE id = $1', [req.params.id, JSON.stringify(next)])
      return true
    })
    if (!updated) return res.status(404).json({ error: 'Projeto não encontrado.' })
    const [row] = await q(`${PROJECT_SELECT} WHERE id = $1`, [req.params.id])
    res.status(201).json(row)
  })
)

// Baixa/serve um arquivo pelo id. Aceita ?token= (para <img>/<a>). Passa pelo
// mesmo gate das outras rotas do projeto: quem saiu dele não baixa mais nada.
// Tokens de link dos arquivos: um por id, cada um abrindo só aquele arquivo.
// Em lote porque a aba Arquivos precisa da URL de todo documento e de toda
// imagem de uma vez — um POST por imagem seria uma rajada a cada abertura.
// Arquivo de projeto que a pessoa não enxerga simplesmente não vem na
// resposta: o lote continua valendo para o resto.
app.post('/api/files/tokens', wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string').slice(0, 300) : []
  if (!ids.length) return res.json({})
  const arquivos = await q('SELECT id, project_id FROM files WHERE id = ANY($1)', [ids])
  const visiveis = await visibleProjectIds(req)   // null = admin, enxerga tudo
  const out = {}
  for (const f of arquivos) {
    if (visiveis === null || visiveis.includes(f.project_id)) out[f.id] = signFileToken(req.userId, f.id)
  }
  res.json(out)
}))

app.get('/api/files/:id',
  gate(async (req) => (await q('SELECT project_id FROM files WHERE id = $1', [req.params.id]))[0]?.project_id, CAN.light),
  wrap(async (req, res) => {
    // Linha de `files` nunca muda (só INSERT/DELETE): o ETag é o próprio id e o
    // cache pode ser longo. Com ETag já definido, o Express não calcula o sha1
    // do corpo — e o 304 dispensa ler o bytea inteiro do banco.
    const etag = `"${req.params.id}"`
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.headers['if-none-match'] === etag) return res.status(304).end()
    const [file] = await q('SELECT filename, mime_type, data FROM files WHERE id = $1', [req.params.id])
    if (!file) return res.status(404).json({ error: 'Arquivo não encontrado.' })
    // Só a allowlist abre inline com o tipo real; o resto desce como download
    // genérico e em sandbox, para não executar nada se o navegador insistir em
    // renderizar. O ramo inline NÃO leva sandbox: o leitor de PDF do Chrome
    // pode se recusar a abrir sob ela.
    const inline = MIME_INLINE.has(file.mime_type)
    res.setHeader('Content-Type', inline ? file.mime_type : 'application/octet-stream')
    if (!inline) res.setHeader('Content-Security-Policy', 'sandbox')
    res.setHeader('Content-Disposition', contentDisposition(file.filename || 'arquivo', { type: inline ? 'inline' : 'attachment' }))
    res.send(file.data)
  })
)

// ----- tarefas -----
app.post('/api/tasks', gate((req) => req.body.projectId, CAN.edit), wrap(async (req, res) => {
  const { projectId, assigneeId, start, end, checklist = [], memberIds = [] } = req.body
  const v = validarTarefa(req.body)
  if (v.erro) return res.status(400).json({ error: v.erro })
  const id = genId('t')
  await tx(async (client) => {
    await client.query(
      `INSERT INTO tasks (id, project_id, title, assignee_id, status, priority, start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, projectId, v.title, assigneeId || null, v.status, v.priority, normData(start), normData(end), req.userId]
    )
    await replaceChildren(client, id, checklist, memberIds, assigneeId)
  })
  res.status(201).json(await getTask(id))
}))

app.put('/api/tasks/:id', gateTask(CAN.edit), wrap(async (req, res) => {
  const { projectId, assigneeId, start, end, checklist = [], memberIds = [] } = req.body
  const v = validarTarefa(req.body)
  if (v.erro) return res.status(400).json({ error: v.erro })
  const id = req.params.id
  // O gate conferiu o projeto de ORIGEM. Trocar de projeto exige Edição total
  // também no de DESTINO — senão um 'full' em A despeja etapas num projeto B
  // onde é só exibição. Sem projectId no corpo, a etapa fica onde está.
  const destino = projectId || req.taskProjectId
  if (destino !== req.taskProjectId && !CAN.edit.includes(await effectiveRole(req, destino))) {
    return res.status(403).json({ error: 'Você não tem permissão no projeto de destino.' })
  }
  const updated = await tx(async (client) => {
    const r = await client.query(
      `UPDATE tasks SET project_id = $2, title = $3, assignee_id = $4, status = $5, priority = $6, start_date = $7, end_date = $8,
              updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id, destino, v.title, assigneeId || null, v.status, v.priority, normData(start), normData(end)]
    )
    if (!r.rows.length) return false
    await replaceChildren(client, id, checklist, memberIds, assigneeId)
    return true
  })
  if (!updated) return res.status(404).json({ error: 'Atividade não encontrada.' })
  res.json(await getTask(id))
}))

// Mover entre colunas do Kanban (só o status) — permitido para 'Só exibição'.
app.patch('/api/tasks/:id/status', gateTask(CAN.light), wrap(async (req, res) => {
  if (!TASK_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Status inválido.' })
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
app.patch('/api/tasks/:id/checklist', gateTask(CAN.light), wrap(async (req, res) => {
  const { checklist = [] } = req.body
  const comTexto = checklist.filter(i => i && i.id && typeof i.text === 'string' && i.text.trim())
  // Responsável, membros e textos atuais numa ida só — eram três em série, e
  // marcar um item é a ação mais repetida do app.
  //
  // Quem pode assumir um item: só quem participa da atividade. O seletor no
  // front já mostra apenas eles, mas o servidor confere de novo.
  const [ctx] = await q(
    `SELECT t.assignee_id,
            COALESCE((SELECT array_agg(user_id) FROM task_members WHERE task_id = t.id), '{}') AS membros,
            COALESCE((SELECT json_object_agg(id, text) FROM checklist_items WHERE task_id = t.id AND id = ANY($2::text[])), '{}'::json) AS textos
       FROM tasks t WHERE t.id = $1`, [req.params.id, comTexto.map(i => i.id)])
  if (!ctx) return res.status(404).json({ error: 'Atividade não encontrada.' })
  const podeAssumir = new Set([ctx.assignee_id, ...ctx.membros].filter(Boolean))

  // Confere a permissão de texto ANTES da transação: barrar no meio dela
  // significaria desfazer marcações que já teriam sido aplicadas.
  const mudouTexto = comTexto.some(i => i.id in ctx.textos && ctx.textos[i.id] !== i.text.trim())
  if (mudouTexto && !CAN.edit.includes(req.projectRole)) {
    return res.status(403).json({ error: 'Só quem tem edição total pode mudar o texto de um item.' })
  }

  await tx(async (client) => {
    let mexeuEstado = false
    for (const item of checklist) {
      if (!item || !item.id) continue
      // Estado manda; `done` é o espelho dele. O ramo do 'done' sozinho é o
      // caminho antigo (marcar/desmarcar), que continua valendo; null é o corpo
      // que não falou de estado, e aí nada muda.
      const estado = ('state' in item && ESTADOS_ITEM.includes(item.state)) ? item.state
        : ('done' in item ? (item.done ? 'done' : 'todo') : null)
      const texto = typeof item.text === 'string' && item.text.trim() ? item.text.trim() : null
      const trocaDono = 'assigneeId' in item
      const dono = trocaDono && podeAssumir.has(item.assigneeId) ? item.assigneeId : null
      if (estado) mexeuEstado = true
      // Cada campo só é tocado quando vem no corpo (COALESCE/CASE), num UPDATE
      // só: marcar não desfaz a atribuição, e atribuir não mexe no que já está
      // marcado. Eram até quatro comandos por item.
      await client.query(
        `UPDATE checklist_items
            SET state = COALESCE($3::text, state),
                done  = (COALESCE($3::text, state) = 'done'),
                text  = COALESCE($4::text, text),
                assignee_id = CASE WHEN $5::bool THEN $6::text ELSE assignee_id END
          WHERE id = $1 AND task_id = $2`,
        [item.id, req.params.id, estado, texto, trocaDono, dono])
    }
    await client.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [req.params.id])
    // Texto e dono não mexem no status da etapa: só recalcula quando algum
    // estado mudou.
    if (mexeuEstado) await ajustarStatusPeloChecklist(client, req.params.id)
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
  // Status atual e contagem do checklist numa ida só — eram duas em série, e
  // esta função roda em toda mexida no checklist.
  const { rows: [c] } = await client.query(
    `SELECT t.status,
            count(ci.id)::int AS total,
            count(ci.id) FILTER (WHERE ci.state = 'done')::int       AS feitos,
            count(ci.id) FILTER (WHERE ci.state = 'review')::int     AS revisao,
            count(ci.id) FILTER (WHERE ci.state = 'diligence')::int  AS diligencia
       FROM tasks t LEFT JOIN checklist_items ci ON ci.task_id = t.id
      WHERE t.id = $1
      GROUP BY t.status`,
    [taskId]
  )
  if (!c || !c.total) return                         // sem checklist: nada a inferir
  const novo = c.feitos === c.total ? 'done'
    : c.diligencia ? 'diligence'
    : c.revisao ? 'review'
    : c.feitos ? 'progress'
    : 'todo'
  if (novo === c.status) return
  await client.query('UPDATE tasks SET status = $2 WHERE id = $1', [taskId, novo])
}

// Entrar/sair de uma atividade — o usuário gerencia só a SUA participação.
// Permitido para 'Só exibição'; adicionar/remover outras pessoas exige Edição total.
app.post('/api/tasks/:id/membership', gateTask(CAN.light), wrap(async (req, res) => {
  const { join } = req.body
  const [t] = await q('SELECT assignee_id FROM tasks WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Atividade não encontrada.' })
  await tx(async (client) => {
    if (join) {
      if (t.assignee_id !== req.userId) {
        await client.query('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, req.userId])
      }
    } else {
      await client.query('DELETE FROM task_members WHERE task_id = $1 AND user_id = $2', [req.params.id, req.userId])
    }
    await client.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [req.params.id])
  })
  res.json(await getTask(req.params.id))
}))

// Criar as etapas que faltam no projeto, de uma vez. Idempotente: só insere o
// que ainda não existe, então clicar duas vezes não duplica — que é justamente
// como a equipe acabou com "9 · Diligências" repetida em três projetos.
//
// São até seis idas ao banco: conferir o projeto, abrir a transação, travar o
// projeto, inserir, confirmar e reler as que entraram.
// Antes eram ~15 — uma consulta para listar os títulos existentes e, dentro de
// uma transação, um INSERT por etapa. Com o Postgres do outro lado da rede o
// custo é quase todo de ida e volta, então criar as 11 etapas levava segundos
// de espera. O filtro do que já existe virou o NOT EXISTS do próprio INSERT, e
// as 11 linhas entram de uma vez. O NOT EXISTS sozinho não basta contra dois
// cliques simultâneos — os dois leriam o estado de antes e inseririam a mesma
// etapa —, então o projeto é travado antes de montar o template.
// adminOnly, nao CAN.edit: montar o template nao e trabalhar no projeto, e
// decidir que ele segue o processo das 11 etapas. Quem e 'full' executa as
// etapas; quem as cria e a coordenacao. Enquanto isto era CAN.edit, qualquer
// membro criava — e era assim que um projeto ganhava etapa repetida.
app.post('/api/projects/:id/stages', gate((req) => req.params.id, CAN.adminOnly), wrap(async (req, res) => {
  const [p] = await q("SELECT to_char(COALESCE(start_date, now()::date), 'YYYY-MM-DD') AS inicio FROM projects WHERE id = $1", [req.params.id])
  if (!p) return res.status(404).json({ error: 'Projeto não encontrado.' })

  const titulos = ETAPAS_PADRAO.map((nome, i) => `${i} · ${nome}`)
  const ids = titulos.map(() => genId('t'))
  const novas = await tx(async (client) => {
    await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [req.params.id])
    const { rows } = await client.query(
      `INSERT INTO tasks (id, project_id, title, status, priority, start_date, end_date, created_by)
       SELECT e.id, $1, e.title, 'todo', 'medium', $2::date, $2::date + $3::int, $4
       FROM unnest($5::text[], $6::text[]) AS e(id, title)
       WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = $1 AND t.title = e.title)
       RETURNING id`,
      [req.params.id, p.inicio, DIAS_PRAZO_ATIVIDADE, req.userId, ids, titulos])
    return rows
  })

  // Devolve as etapas prontas. Sem isto o cliente só sabia quantas foram e
  // precisava recarregar o bootstrap inteiro (dezenas de KB) para enxergar 11 linhas.
  const tasks = novas.length
    ? (await q(`${TASK_SELECT} WHERE t.id = ANY($1) ORDER BY t.id`, [novas.map(r => r.id)])).map(mapTask)
    : []
  res.json({ criadas: novas.length, tasks })
}))

// Acrescentar um item ao checklist de uma atividade. Exige Edição total: o
// item é trabalho novo, diferente de MARCAR um item existente (que 'Só
// exibição' pode fazer, pela rota PATCH).
// Acrescenta uma OU VARIAS atividades a etapa. O corpo aceita `text` (uma so,
// como antes) ou `items` — cada um com texto e dono proprio.
//
// Em lote de proposito: a tela passou a deixar escrever varias linhas de uma
// vez, e uma requisicao por linha repetiria o problema que o "criar template"
// ja teve — com o Postgres do outro lado da rede, o custo e quase todo de ida
// e volta.
app.post('/api/tasks/:id/checklist', gateTask(CAN.edit), wrap(async (req, res) => {
  const entrada = Array.isArray(req.body.items) && req.body.items.length
    ? req.body.items
    : [{ text: req.body.text, assigneeId: req.body.assigneeId }]
  const itens = entrada
    .map(i => ({ text: String(i?.text || '').trim(), assigneeId: i?.assigneeId || null }))
    .filter(i => i.text)
    .slice(0, 50)
  if (!itens.length) return res.status(400).json({ error: 'Escreva o que precisa ser feito.' })

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
  // Dono inválido vira "sem dono" em vez de derrubar a linha inteira: numa
  // lista de cinco atividades, perder tudo por causa de um seletor errado
  // custaria mais que a atividade nascer sem responsável.
  const comDono = itens.map(i => ({ ...i, assigneeId: podeAssumir.has(i.assigneeId) ? i.assigneeId : null }))

  await tx(async (client) => {
    const donos = [...new Set(comDono.map(i => i.assigneeId).filter(d => d && d !== t.assignee_id))]
    for (const d of donos) {
      await client.query('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, d])
    }
    // Duas pessoas acrescentando ao mesmo tempo leriam o mesmo max(position)
    // e os itens nasceriam empatados na ordem.
    await client.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [req.params.id])
    const { rows: [pos] } = await client.query(
      'SELECT COALESCE(max(position), -1) + 1 AS n FROM checklist_items WHERE task_id = $1', [req.params.id])
    // As N linhas entram num INSERT só, pelo mesmo motivo do "criar template":
    // o custo é da ida e volta, não do trabalho de cada uma.
    await client.query(
      `INSERT INTO checklist_items (id, task_id, text, done, position, assignee_id, state)
       SELECT e.id, $1, e.text, false, $2::int + (e.ord::int), e.dono, 'todo'
         FROM unnest($3::text[], $4::text[], $5::text[], $6::int[]) AS e(id, text, dono, ord)`,
      [req.params.id, pos.n,
       comDono.map(() => genId('c')), comDono.map(i => i.text),
       comDono.map(i => i.assigneeId), comDono.map((_, k) => k)])
    await client.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [req.params.id])
    // Item novo numa etapa concluída a devolve para "em andamento".
    await ajustarStatusPeloChecklist(client, req.params.id)
  })
  res.status(201).json(await getTask(req.params.id))
}))

// Registrar que a pessoa ABRIU a atividade. Não é edição — 'Só exibição'
// também marca. É o "acessado" que segura a notificação da atividade que a
// própria pessoa criou para si (ver as notificações em App.jsx).
app.post('/api/tasks/:id/view', gateTask(CAN.light), wrap(async (req, res) => {
  await q(
    `INSERT INTO task_views (task_id, user_id) VALUES ($1, $2)
     ON CONFLICT (task_id, user_id) DO UPDATE SET seen_at = now()`,
    [req.params.id, req.userId]
  )
  res.json(await getTask(req.params.id))
}))

// Excluir UMA atividade da etapa, sem abrir o modal e sem reescrever o
// checklist inteiro. Antes a unica saida era o PUT da etapa, que apaga e
// reinsere todos os itens — muito peso para remover uma linha.
app.delete('/api/tasks/:id/checklist/:itemId', gateTask(CAN.edit), wrap(async (req, res) => {
  await tx(async (client) => {
    await client.query('DELETE FROM checklist_items WHERE id = $1 AND task_id = $2', [req.params.itemId, req.params.id])
    await client.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [req.params.id])
    // O status da etapa espelha o checklist: tirar a ultima atividade pendente
    // pode fechar a etapa, e tirar a ultima de todas devolve o controle manual.
    await ajustarStatusPeloChecklist(client, req.params.id)
  })
  res.json(await getTask(req.params.id))
}))

// Excluir VARIAS etapas de uma vez. A tela tem selecao em massa, e uma
// requisicao por etapa custaria uma ida e volta cada — onze etapas, onze
// esperas. Aqui vai tudo num DELETE so.
//
// O gate() padrao nao serve: ele resolve UM projeto a partir da rota. Como os
// ids podem estar em projetos diferentes, a permissao e conferida por projeto
// antes de apagar qualquer coisa — e uma etapa sem permissao derruba a
// operacao inteira, em vez de apagar metade.
app.post('/api/tasks/bulk-delete', wrap(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(i => typeof i === 'string').slice(0, 100)
  if (!ids.length) return res.status(400).json({ error: 'Nenhuma etapa selecionada.' })

  const alvos = await q('SELECT id, project_id FROM tasks WHERE id = ANY($1::text[])', [ids])
  if (!alvos.length) return res.status(404).json({ error: 'Nenhuma etapa encontrada.' })

  const projetos = [...new Set(alvos.map(t => t.project_id))]
  // Papel em todos os projetos de uma vez (era uma effectiveRole por projeto).
  // Admin não consulta nada: req.user já diz. project_members tem uma linha
  // por (projeto, pessoa), então faltar linha é projeto onde ela não tem papel.
  if (!req.user.is_admin) {
    const papeis = await q('SELECT role FROM project_members WHERE user_id = $1 AND project_id = ANY($2::text[])', [req.userId, projetos])
    if (papeis.length !== projetos.length || papeis.some(m => !CAN.edit.includes(papelDe(req, m.role)))) {
      return res.status(403).json({ error: 'Você não tem permissão para excluir etapas deste projeto.' })
    }
  }

  const apagadas = await q('DELETE FROM tasks WHERE id = ANY($1::text[]) RETURNING id', [alvos.map(t => t.id)])
  res.json({ excluidas: apagadas.map(r => r.id) })
}))

app.delete('/api/tasks/:id', gateTask(CAN.edit), wrap(async (req, res) => {
  const rows = await q('DELETE FROM tasks WHERE id = $1 RETURNING id', [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Atividade não encontrada.' })
  res.status(204).end()
}))

// ----- cronômetro (time sessions) -----
// Só as colunas das linhas que mexeram. O start/stop devolviam a lista de
// sessões visíveis inteira a cada clique no play — uma consulta a mais e
// milhares de linhas para dizer que duas mudaram.
const SESSION_RETURNING = `id, user_id AS "userId", task_id AS "taskId",
  (extract(epoch FROM start_at) * 1000)::bigint AS start,
  CASE WHEN end_at IS NULL THEN NULL ELSE (extract(epoch FROM end_at) * 1000)::bigint END AS "end"`

// Projeto da tarefa informada no corpo (start do cronômetro). null → gate responde 404.
async function taskProjectIdDoCorpo(req) {
  const taskId = String(req.body?.taskId ?? '')
  if (!taskId) return null
  const [t] = await q('SELECT project_id FROM tasks WHERE id = $1', [taskId])
  return t?.project_id ?? null
}

// Inicia: fecha a sessão ativa do usuário (se houver) e abre uma nova.
// O dono da sessão é sempre quem está autenticado: com o userId vindo do corpo,
// qualquer pessoa cronometrava tempo no nome de outra, em qualquer atividade.
app.post('/api/sessions/start',
  (req, res, next) => (req.body?.taskId ? next() : res.status(400).json({ error: 'Informe a atividade.' })),
  gate(taskProjectIdDoCorpo, CAN.light),
  wrap(async (req, res) => {
    const taskId = String(req.body.taskId)
    // Dois plays em voo: o primeiro valeu, e o índice único barrou o segundo.
    // Devolver "nada mudou" é mais honesto que um 500 por corrida de clique.
    let mexeram = { fechadas: [], aberta: null }
    try {
      mexeram = await tx(async (client) => {
        const { rows: fechadas } = await client.query(
          `UPDATE time_sessions SET end_at = now() WHERE user_id = $1 AND end_at IS NULL
           RETURNING ${SESSION_RETURNING}`,
          [req.userId])
        const { rows: [aberta] } = await client.query(
          `INSERT INTO time_sessions (id, user_id, task_id, start_at, end_at) VALUES ($1, $2, $3, now(), NULL)
           RETURNING ${SESSION_RETURNING}`,
          [genId('s'), req.userId, taskId])
        return { fechadas: fechadas.map(mapSession), aberta: mapSession(aberta) }
      })
    } catch (e) {
      if (e.code !== '23505') throw e
    }
    res.status(201).json(mexeram)
  }))

// Para: fecha a sessão ativa de quem está autenticado.
app.post('/api/sessions/stop', wrap(async (req, res) => {
  const rows = await q(
    `UPDATE time_sessions SET end_at = now() WHERE user_id = $1 AND end_at IS NULL
     RETURNING ${SESSION_RETURNING}`,
    [req.userId])
  res.json({ fechadas: rows.map(mapSession), aberta: null })
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

// As três áreas da empresa, com o MESMO id que o front grava (SECTORS, em
// src/data/store.js). As rotas de setor validam contra esta lista, e ela tinha
// ficado com os slugs antigos: quem escolhia "Engenharia" em Meu setor tinha o
// campo APAGADO em vez de gravado, porque normSetor devolvia null.
const SETORES = ['Engenharia', 'Arquitetura', 'TI']
const FORMACOES = ['sistemas-informacao', 'arquitetura', 'engenharia-civil', 'engenharia-eletrica']
const CHANGE_KINDS = ['requisicao', 'sugestao']
const URGENCIES = ['low', 'medium', 'high']
const normSetor = (v) => (SETORES.includes(v) ? v : null)
const normFormacao = (v) => (FORMACOES.includes(v) ? v : null)
// Espelho de conselhoDe() em src/data/store.js: a formação manda, o setor
// responde por quem ainda não tem formação preenchida, e o cargo é o último
// recurso. Fica duplicado aqui porque o servidor não importa o front — as
// listas SETORES e FORMACOES já são duplicadas pelo mesmo motivo.
const CONSELHO_FORMACAO = { 'arquitetura': 'CAU', 'engenharia-civil': 'CREA', 'engenharia-eletrica': 'CREA' }
const CONSELHO_SETOR = { 'Engenharia': 'CREA', 'Arquitetura': 'CAU' }
const CONSELHO_CARGO = { 'arquitetura': 'CAU', 'projetos prediais': 'CREA' }
const chaveCargo = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
// Sistemas de Informação é formação SEM conselho, e isso vence o setor: quem
// tem esse diploma no setor Engenharia não tem CREA.
const conselhoDe = (formacao, setor, cargo) => (normFormacao(formacao)
  ? CONSELHO_FORMACAO[formacao] || null
  : CONSELHO_SETOR[setor] || CONSELHO_CARGO[chaveCargo(cargo)] || null)
// O número só faz sentido para quem tem conselho. Guardar um CAU em quem não
// tem deixa o dado esperando para reaparecer quando a formação mudar.
const normRegistro = (formacao, setor, cargo, v) => (conselhoDe(formacao, setor, cargo) && v ? String(v).trim() || null : null)
// Data em branco é ausência de data, não a string "". O Postgres recusa '' como
// date, e era isso que devolvia 500 para quem salvava um projeto sem prazo: o
// formulário deixava tentar, e a gravação morria no banco.
const normData = (v) => { const s = String(v ?? '').trim(); return s || null }
const normKind = (v) => (CHANGE_KINDS.includes(v) ? v : 'requisicao')
const normUrgency = (v) => (URGENCIES.includes(v) ? v : 'medium')

// Prazo padrão da atividade criada junto com a mudança. A data pode ser
// ajustada depois na própria atividade; aqui só evita nascer sem prazo.
const DIAS_PRAZO_ATIVIDADE = 14

async function getChange(id) {
  const rows = await q(`${CHANGE_SELECT} WHERE c.id = $1`, [id])
  return rows[0] ? mapChange(rows[0]) : null
}

// Quem deve dar ciência: a equipe do projeto, menos quem publicou.
// É a MESMA lista que dá acesso ao projeto — de propósito, para nunca existir
// alguém que enxerga o projeto sem ser avisado, nem o contrário.
// Um INSERT ... SELECT em vez de listar a equipe e inserir uma linha por
// pessoa: eram 1 + N idas ao banco a cada publicação ou edição.
async function abrirCiencia(client, changeId, projectId, autorId, targetSectors = [], targetUserIds = []) {
  // Reabre para quem já tinha confirmado: se o texto mudou, "eu vi" precisa
  // ser dito de novo, e o prazo de cobrança recomeça.
  await client.query(
    `INSERT INTO change_acks (change_id, user_id, sent_at, confirmed_at)
     SELECT $1, pm.user_id, now(), NULL
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $2 AND pm.user_id <> $3
        -- Terceirizado não entra no sistema, então não tem como dar ciência:
        -- cobrá-lo deixaria uma pendência que ninguém pode encerrar.
        AND NOT u.is_outsourced
        AND (u.sector = ANY($4::text[]) OR pm.user_id = ANY($5::text[]))
     ON CONFLICT (change_id, user_id)
     DO UPDATE SET sent_at = now(), confirmed_at = NULL`,
    [changeId, projectId, autorId, targetSectors, targetUserIds]
  )
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
  // Serializa o procura-e-cria da atividade-abrigo: sem o lock, duas
  // publicações simultâneas criariam duas 'Mudanças sem etapa' no projeto.
  await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId])
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
  await client.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [taskId])
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

// Quais destinatários NÃO podem receber a mudança: quem vai fazer precisa estar
// na equipe do projeto. Numa ida só para a lista toda — eram até duas por
// pessoa, em série. Administradores participam de todos os projetos.
async function alvosInvalidos(projectId, alvos) {
  if (!alvos.length) return []
  const ok = await q(
    `SELECT u.id FROM users u WHERE u.id = ANY($2::text[])
       AND (u.is_admin OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = u.id))`,
    [projectId, alvos])
  const okSet = new Set(ok.map(r => r.id))
  return alvos.filter(a => !okSet.has(a))
}

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

  if ((await alvosInvalidos(req.params.id, alvos)).length) {
    return res.status(400).json({ error: 'Quem vai fazer precisa participar do projeto — inclua a pessoa primeiro.' })
  }

  // Só aceita etapa do próprio projeto — o seletor já filtra, o servidor
  // confere. Resolvida AQUI, uma vez: a sugestão guarda a etapa em task_id
  // para o /decide saber onde pôr o item quando alguém aceitar, e a requisição
  // a recebe pronta em vez de o handler repetir o mesmo SELECT.
  const etapa = stageTaskId
    ? (await q('SELECT id FROM tasks WHERE id = $1 AND project_id = $2', [stageTaskId, req.params.id]))[0]?.id || null
    : null

  const id = genId('mc')
  await tx(async (client) => {
    // Requisição obriga: já entra como item do checklist da etapa. Sugestão é
    // proposta — só vira item quando alguém aceitar.
    const criado = tipo === 'requisicao'
      ? await itemDeChecklistDaMudanca(client, {
          projectId: req.params.id, stageTaskId: etapa, kind: tipo,
          title, urgency, changeDate, alvos,
        })
      : null
    const taskId = criado?.taskId || etapa
    const itemId = criado?.itemId || null

    // O emissor é sempre quem publica — não é escolha do formulário, e o que
    // vier no corpo é ignorado de propósito: quem emitiu não é dado do cliente.
    // emitter_sector fica de fora: a coluna existe pelo legado, e todo registro
    // novo já nascia com NULL nela.
    await client.query(
      `INSERT INTO changes (id, project_id, title, description, origin, change_date,
                            responsible_id, target_sector, target_sectors, target_user_ids, task_id, affects_budget,
                            kind, urgency, emitter_user_id,
                            published_by, published_at, checklist_item_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), $17)`,
      [id, req.params.id, String(title).trim(), String(description).trim(), String(requester || '').trim(),
      changeDate, alvos[0] || null, alvoSetor, JSON.stringify(alvosSetores), JSON.stringify(alvos), taskId, !!affectsBudget,
       tipo, normUrgency(urgency), req.userId, req.userId, itemId]
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

  if ((await alvosInvalidos(atual.project_id, alvos)).length) {
    return res.status(400).json({ error: 'Quem vai fazer precisa participar do projeto — inclua a pessoa primeiro.' })
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

  const ch = await getChange(req.params.id)
  if (!ch) return res.status(404).json({ error: 'Mudança não encontrada.' })
  if (ch.kind !== 'sugestao') return res.status(400).json({ error: 'Só sugestões passam por aceite — requisição já vale.' })
  if (ch.decision) return res.status(400).json({ error: 'Esta sugestão já foi decidida.' })

  const [eu] = await q('SELECT sector FROM users WHERE id = $1', [req.userId])
  // Quem é destinatário sai da MESMA leitura que a tela usa (CHANGE_SELECT, e
  // ProjectChanges.jsx decide por ela): refazer a regra aqui com as colunas
  // cruas era uma segunda definição de 'destinatário', esperando divergir.
  const alvos = ch.targetUserIds.length ? ch.targetUserIds : [ch.responsibleId].filter(Boolean)
  const souDestinatario = (eu && ch.targetSectors.includes(eu.sector)) || alvos.includes(req.userId)
  if (!souDestinatario) {
    return res.status(403).json({ error: 'Só o destinatário da sugestão pode aceitar ou recusar.' })
  }

  await tx(async (client) => {
    let taskId = ch.taskId
    let itemId = ch.checklistItemId
    // Aceitar é o que transforma a sugestão em trabalho: só aí ela vira item
    // do checklist, na etapa escolhida na publicação.
    if (aceitar && !itemId) {
      const criado = await itemDeChecklistDaMudanca(client, {
        projectId: ch.projectId, stageTaskId: ch.taskId, kind: 'sugestao',
        title: ch.title, urgency: ch.urgency, changeDate: ch.changeDate,
        alvos,
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
  // null é 'Sem setor', escolha legítima do front; já um texto fora da lista
  // virava null em silêncio e apagava o setor de quem tinha um.
  if (req.body.sector != null && !setor) return res.status(400).json({ error: 'Setor inválido.' })
  const rows = await q('UPDATE users SET sector = $2, updated_at = now() WHERE id = $1 RETURNING id', [req.params.id, setor])
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' })
  res.json({ id: req.params.id, sector: setor })
}))

// A própria pessoa define seu setor — é o vínculo da conta com o setor que
// exerce. Sem isso, endereçar uma mudança a um setor não encontra ninguém.
app.post('/api/auth/sector', wrap(async (req, res) => {
  const setor = normSetor(req.body.sector)
  if (req.body.sector != null && !setor) return res.status(400).json({ error: 'Setor inválido.' })
  await q('UPDATE users SET sector = $2, updated_at = now() WHERE id = $1', [req.userId, setor])
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
  const visiveis = await visibleProjectIds(req)
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
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? iso : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
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
// Derivada de TAGS_OK: repetida a mao, a lista viveria em dois lugares e
// liberar uma tag nova exigiria lembrar do segundo.
const RE_RESTAURA = new RegExp('&lt;(\\/?)(' + TAGS_OK.join('|') + ')>', 'g')
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
    .replace(RE_RESTAURA, '<$1$2>')
  return limpo.length > limite ? limpo.slice(0, limite) : limpo
}

// Texto visivel, para saber se o relatorio tem conteudo de verdade.
const semTags = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

const mapRelatorio = (r) => ({
  id: r.id,
  userId: r.user_id,
  week: r.week,
  projectIds: r.project_ids || [],
  developed: r.developed || '',
  works: r.works || {},
  statuses: r.statuses || {},
  sentAt: r.sent_at,
  updatedAt: r.updated_at,
})

const COLUNAS_REL = "id, user_id, to_char(week, 'YYYY-MM-DD') AS week, project_ids, developed, works, statuses, sent_at, updated_at"

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
  // As duas consultas são independentes: em série somavam duas latências do
  // Neon para abrir a tela.
  const [[r], sugestao] = await Promise.all([
    q(`SELECT ${COLUNAS_REL} FROM weekly_reports WHERE user_id = $1 AND week = $2::date`, [req.userId, semana]),
    sugerirDaSemana(req.userId, semana),
  ])
  res.json({ week: semana, report: r ? mapRelatorio(r) : null, sugestao })
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
    if (PROJ_STATUSES.includes(brutoStatus[id])) statuses[id] = brutoStatus[id]
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
    // Terceirizado não acessa o sistema, então não tem como enviar relatório.
    // Administrador também fica fora: ele não tem a aba "Meu relatório"
    // (Chrome.jsx) e o Hub não o cobra, então listá-lo aqui inflaria os
    // pendentes com quem nunca vai enviar.
    q('SELECT id FROM users WHERE is_active AND NOT is_dev AND NOT is_outsourced AND NOT is_admin ORDER BY id'),
  ])
  const entregou = new Set(enviados.map(r => r.user_id))
  res.json({
    week: semana,
    reports: enviados.map(mapRelatorio),
    faltando: pessoas.map(p => p.id).filter(id => !entregou.has(id)),
  })
}))

// ---------- middleware de erro ----------
// O corpo da resposta nunca carrega o texto de um erro interno: mensagem de
// banco traz nome de tabela, coluna e constraint, e o cliente exibe `.error`
// cru na tela (api.js). O que o suporte precisa vai para o log, com rota,
// usuário e stack — antes se registrava só `err.message`.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  const status = err.status || err.statusCode || 500
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: err.limit >= MAX_FILE_BYTES ? 'Arquivo maior que o limite de 25 MB.' : 'Conteúdo grande demais para salvar de uma vez.',
    })
  }
  // Erro com status próprio é validação, não falha: a mensagem é para ser lida.
  if (status < 500) {
    return res.status(status).json({ error: err.type === 'entity.parse.failed' ? 'Corpo da requisição inválido.' : err.message })
  }
  // Dado inválido chegando ao Postgres é erro de quem chamou, não do servidor.
  if (err.code === '23505' || err.code === '23503') return res.status(409).json({ error: 'Conflito com dados existentes.' })
  if (['22P02', '23502', '22001', '22007', '22008'].includes(err.code)) return res.status(400).json({ error: 'Dados inválidos.' })
  console.error('[promav] erro na API', JSON.stringify({
    metodo: req.method, rota: req.originalUrl, usuario: req.userId || null, status,
    code: err.code, detail: err.detail, constraint: err.constraint,
  }), '\n', err.stack || err)
  res.status(500).json({ error: 'Erro interno no servidor.' })
})

// Garante tabelas/colunas novas (idempotente). O restante do schema é criado à parte.
async function ensureSchema() {
  // São ~80 comandos em sequência (82 hoje, contados) e o erro do Postgres não
  // diz qual deles parou — sem este carimbo o log do boot aponta para
  // ensureSchema inteiro.
  const passo = async (sql, params) => {
    try {
      return await q(sql, params)
    } catch (e) {
      e.passoSchema = sql.trim().replace(/\s+/g, ' ').slice(0, 120)
      throw e
    }
  }

  await passo(`
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
  await passo('CREATE INDEX IF NOT EXISTS files_project_id_idx ON files (project_id)')

  // ----- pastas (agrupam projetos na sidebar) -----
  await passo(`
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
  await passo('ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id text REFERENCES folders(id) ON DELETE CASCADE')
  // Gaveta do projeto. NULL = projeto solto (sem pasta). Apagar a pasta só
  // solta os projetos (ON DELETE SET NULL), nunca os apaga.
  await passo('ALTER TABLE projects ADD COLUMN IF NOT EXISTS folder_id text REFERENCES folders(id) ON DELETE SET NULL')
  // Ordem do projeto na sidebar (dentro da pasta ou entre os soltos). Usado no drag-and-drop.
  await passo('ALTER TABLE projects ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0')

  // ----- ficha do projeto (dados do convênio) -----
  await passo("ALTER TABLE projects ADD COLUMN IF NOT EXISTS prefeitura text NOT NULL DEFAULT ''")
  await passo("ALTER TABLE projects ADD COLUMN IF NOT EXISTS secretaria text NOT NULL DEFAULT ''")
  // Origem do recurso: federal | estadual | municipal | emenda | outro.
  await passo("ALTER TABLE projects ADD COLUMN IF NOT EXISTS origem_recurso text NOT NULL DEFAULT 'federal'")
  // Valor ESTIMADO do projeto, em reais (coluna com o nome antigo). NULL = não informado.
  // Os nomes originais mentiam sobre o conteudo: `valor_convenio` guardava o
  // valor ESTIMADO e `valor_disponivel`, o ORCADO. Com a entrada do convenio de
  // verdade isso virou armadilha — havia `valor_convenio` e `convenio_valor`
  // lado a lado, significando coisas diferentes, e escrever na errada
  // sobrescreveria o valor estimado de todo projeto em silencio.
  //
  // O rename vem ANTES do ADD COLUMN abaixo de proposito: invertido, o ADD
  // recriaria a coluna velha vazia logo depois de ela ser renomeada.
  await passo(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'projects' AND column_name = 'valor_convenio')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'projects' AND column_name = 'valor_estimado')
      THEN ALTER TABLE projects RENAME COLUMN valor_convenio TO valor_estimado;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'projects' AND column_name = 'valor_disponivel')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'projects' AND column_name = 'valor_orcado')
      THEN ALTER TABLE projects RENAME COLUMN valor_disponivel TO valor_orcado;
      END IF;
    END $$`)

  await passo('ALTER TABLE projects ADD COLUMN IF NOT EXISTS valor_estimado numeric(14,2)')
  // Valor ORÇADO do projeto, em reais (coluna com o nome antigo). NULL = não informado.
  await passo('ALTER TABLE projects ADD COLUMN IF NOT EXISTS valor_orcado numeric(14,2)')

  // ----- convenio -----
  // O numero do convenio nao tinha onde morar, e por isso 10 projetos o
  // carregam dentro do NOME ("..._CONV. 030979/2026", "..._MAPP 6112") — o que
  // alonga o nome, impede filtrar por ele e convida ao erro de digitacao.
  //
  // `convenio_valor` e o valor do convenio, e nada mais: o antigo homonimo
  // `valor_convenio`, que na verdade guardava o estimado, foi renomeado acima.
  await passo('ALTER TABLE projects ADD COLUMN IF NOT EXISTS eh_convenio boolean NOT NULL DEFAULT false')
  await passo('ALTER TABLE projects ADD COLUMN IF NOT EXISTS convenio_numero text')
  await passo('ALTER TABLE projects ADD COLUMN IF NOT EXISTS convenio_valor numeric(14,2)')
  // Status do projeto: mesma lista de PROJ_STATUSES, em ordem de criticidade
  // (planejamento | andamento | revisao | pendente | diligencia | paralisado | concluido).
  // A coluna é text livre, então status novos não pedem migração: basta entrar
  // na lista aqui e em PROJECT_STATUSES (store.js), que é quem dá rótulo e cor.
  await passo("ALTER TABLE projects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planejamento'")
  // Tipo de obra: piçarramento | pavimentacao | construcao | reforma. Mesma
  // ideia do status acima — texto livre, lista fica em PROJ_TIPOS/store.js.
  await passo("ALTER TABLE projects ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'construcao'")
  // Profissionais responsáveis: lista (jsonb) de ids de usuários.
  await passo(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS responsible_ids jsonb NOT NULL DEFAULT '[]'::jsonb`)

  // ----- mudanças do projeto (orientações) + ciência -----
  await passo(`
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
  await passo('CREATE INDEX IF NOT EXISTS changes_project_idx ON changes (project_id, published_at DESC)')
  // O lado REFERENCIADOR de uma FK não ganha índice sozinho, e é ele que o
  // gatilho de integridade varre a cada DELETE de etapa.
  await passo('CREATE INDEX IF NOT EXISTS changes_task_idx ON changes (task_id)')
  // Requisição obriga; sugestão é proposta e só vira atividade depois de aceita.
  await passo("ALTER TABLE changes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'requisicao'")
  // Urgência usa os mesmos ids da prioridade da atividade — vira a prioridade do cartão.
  await passo("ALTER TABLE changes ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'medium'")
  // Emissor: quem PEDIU a mudança (≠ published_by, que é quem digitou). Pessoa ou setor.
  await passo('ALTER TABLE changes ADD COLUMN IF NOT EXISTS emitter_user_id text REFERENCES users(id) ON DELETE SET NULL')
  await passo('ALTER TABLE changes ADD COLUMN IF NOT EXISTS emitter_sector text')
  // Destinatário setor. Quando é pessoa, fica em responsible_id (quem vai fazer).
  await passo('ALTER TABLE changes ADD COLUMN IF NOT EXISTS target_sector text')
  await passo(`ALTER TABLE changes ADD COLUMN IF NOT EXISTS target_sectors jsonb NOT NULL DEFAULT '[]'::jsonb`)
  // Destinatários pessoa: a mudança pode ir para mais de uma. O primeiro vira
  // responsável da atividade; os demais entram como membros dela.
  await passo(`ALTER TABLE changes ADD COLUMN IF NOT EXISTS target_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb`)
  // Decisão da sugestão: NULL = pendente.
  await passo('ALTER TABLE changes ADD COLUMN IF NOT EXISTS decision text')
  await passo('ALTER TABLE changes ADD COLUMN IF NOT EXISTS decided_by text REFERENCES users(id) ON DELETE SET NULL')
  await passo('ALTER TABLE changes ADD COLUMN IF NOT EXISTS decided_at timestamptz')
  await passo('ALTER TABLE changes ADD COLUMN IF NOT EXISTS decision_reason text')
  // O item de checklist que a mudança criou dentro da etapa. task_id passa a
  // apontar para a ETAPA hospedeira, não para uma atividade própria.
  await passo('ALTER TABLE changes ADD COLUMN IF NOT EXISTS checklist_item_id text REFERENCES checklist_items(id) ON DELETE SET NULL')
  // Mesmo motivo do changes_task_idx, e DEPOIS do ADD COLUMN acima: num banco
  // novo a coluna só passa a existir aqui, e indexá-la antes derrubava o
  // ensureSchema no 22º comando — nada depois dele rodava.
  await passo('CREATE INDEX IF NOT EXISTS changes_item_idx ON changes (checklist_item_id)')
  // Uma linha por (mudança, pessoa). confirmed_at NULL = ainda não deu ciência.
  await passo(`
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
  await passo('ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at timestamptz')
  await passo('UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL')
  await passo('ALTER TABLE projects ALTER COLUMN updated_at SET DEFAULT now()')

  // Mesmo motivo em users e folders: sem carimbo, o /api/pulse só via a
  // contagem, e editar uma pessoa ou renomear uma pasta não mudava nada do
  // que ele compara — a outra aba só descobria no F5.
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()')
  await passo('ALTER TABLE folders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()')

  // Responsável por CADA item do checklist. Uma atividade com duas pessoas
  // costuma ter cada uma cuidando de uma parte; sem isto só dá para saber que
  // "alguém do par" está devendo. NULL = item sem dono, que é permitido.
  await passo('ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS assignee_id text REFERENCES users(id) ON DELETE SET NULL')

  // ----- atividade: autoria, último toque e leitura -----
  // Quem criou a atividade. NULL nas linhas antigas (não dá para descobrir
  // depois) — a regra de "criei para mim mesmo" simplesmente não as alcança.
  await passo('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by text REFERENCES users(id) ON DELETE SET NULL')
  // Último toque na atividade (edição, status, checklist, participação).
  // Entra sem DEFAULT para não carimbar now() nas linhas antigas: elas herdam
  // o próprio created_at logo abaixo, que é a data real mais próxima.
  await passo('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz')
  await passo('UPDATE tasks SET updated_at = created_at WHERE updated_at IS NULL')
  await passo('ALTER TABLE tasks ALTER COLUMN updated_at SET DEFAULT now()')
  // Quando cada pessoa abriu a atividade pela última vez. Uma linha por
  // (atividade, pessoa) — é o "acessado" da regra de notificação.
  await passo(`
    CREATE TABLE IF NOT EXISTS task_views (
      task_id text NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      seen_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (task_id, user_id)
    )
  `)

  // Setor da pessoa (engenharia, arquitetura…). É o que faz "destinatário:
  // Engenharia" resolver para gente de verdade na hora de cobrar ciência.
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS sector text')
  // Cargo, formação, telefone, nome curto e situação ativa/inativa da pessoa.
  //
  // Cargo e formação são campos diferentes e os dois ficam: o cargo é o que a
  // pessoa faz ("Projetos Prediais", "Estagiário de TI") e a formação é o
  // diploma, que é de onde sai o conselho. O cadastro real tem 'Coordenação' e
  // 'Orçamentista' como cargo — nenhum é diploma, e nenhum caberia na lista de
  // formações sem inventar o dado.
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text')
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS formation text')
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text')
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS short_name text')
  // Senha que um administrador definiu é provisória: quem entra com ela troca
  // antes de usar o sistema. Nasce `false` para as contas que já existem — a
  // marca é posta por quem define a senha daqui para a frente, não por este
  // backfill, que não tem como saber quais senhas foram escolhidas pelo dono.
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false')
  // Número do registro profissional (CREA ou CAU, conforme a formação — ver
  // FORMACAO_CONSELHO em data/store.js). Só o número; a sigla não é gravada
  // porque é sempre derivada da formação, nunca escolhida à parte.
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_register text')
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true')
  // Se a pessoa é terceirizada (Sim/Não na ficha) — não confundir com o setor.
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_outsourced boolean NOT NULL DEFAULT false')
  // Terceirizado não tem login, então a conta pode ficar sem senha.
  await passo('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL')

  // ----- cronômetro -----
  // Um cronômetro ativo por pessoa, garantido pelo banco. O índice existia só
  // no banco de desenvolvimento, criado à mão: em produção dois cliques no
  // "play" deixavam duas sessões abertas, e o tempo da pessoa contava dobrado.
  // Fecha as sobras antes de criar o índice (mantém a mais recente de cada
  // pessoa) — com duplicata viva, a criação falharia e o boot nunca o teria.
  await passo(`UPDATE time_sessions SET end_at = now() WHERE end_at IS NULL AND id NOT IN (
    SELECT DISTINCT ON (user_id) id FROM time_sessions WHERE end_at IS NULL ORDER BY user_id, start_at DESC)`)
  await passo('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_active_per_user ON time_sessions (user_id) WHERE end_at IS NULL')

  // ----- permissões -----
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false')
  // Coluna legada: desde que o acesso passou a sair só de project_members e de
  // users.is_admin, nenhuma rota lê ou escreve default_role. O passo fica porque
  // um deploy anterior do servidor ainda a seleciona em /api/projects; tirar a
  // coluna de vez é migração à parte.
  await passo("ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_role text NOT NULL DEFAULT 'full'")
  await passo(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    text NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      role       text NOT NULL DEFAULT 'view',
      PRIMARY KEY (project_id, user_id)
    )
  `)
  // O lado REFERENCIADOR de uma FK não ganha índice sozinho, e é ele que o
  // gatilho de integridade varre a cada DELETE de pessoa. Vem DEPOIS do CREATE
  // TABLE acima: num banco novo a tabela só passa a existir aqui, e um índice
  // sobre tabela inexistente derruba o ensureSchema inteiro (IF NOT EXISTS
  // protege só o nome do índice).
  await passo('CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members (user_id)')

  // ----- relatorio semanal -----
  // Uma linha por pessoa por semana, atualizada no lugar: o rascunho e o
  // enviado sao o MESMO registro. Salvar automatico criando linha nova faria
  // um relatorio virar duzentas.
  //
  // So texto. O PDF nunca e gravado: ele se regenera daqui em milissegundos, e
  // guardar ~80 KB por relatorio custaria uns 40 MB/ano — mais de quatro vezes
  // o banco inteiro de hoje, para armazenar o que ja esta em `developed`.
  await passo(`
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
  await passo('CREATE INDEX IF NOT EXISTS weekly_reports_week_idx ON weekly_reports (week)')

  // O que foi feito passou a ser POR PROJETO: um texto unico para a semana
  // obrigava a pessoa a repetir o nome do projeto dentro da frase para se fazer
  // entender. `developed` (texto unico) fica para os relatorios ja enviados —
  // eles continuam sendo lidos e impressos como foram escritos.
  await passo("ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS works jsonb NOT NULL DEFAULT '{}'::jsonb")

  // ----- revisao e diligencia -----
  // ADD VALUE num enum do Postgres e de mao unica: valor de enum NAO pode ser
  // removido depois. Por isso os dois entram com o nome definitivo e na ordem
  // do fluxo — a ordem declarada aqui e a que qualquer ORDER BY status usa.
  await passo("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'review' AFTER 'progress'")
  await passo("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'diligence' AFTER 'review'")

  // O item do checklist deixa de ser so marcado/desmarcado. `done` continua
  // existindo e em dia (done = state 'done') porque quem le progresso, o
  // indicador dos cartoes e os relatorios olham esse campo — nenhum deles
  // precisa aprender os estados novos para continuar certo.
  await passo("ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'todo'")

  // ----- terceirizado -----
  // Quem e terceirizado nao entra no sistema: nao tem senha, e o e-mail, quando
  // existe, e contato e nao credencial. Por isso as duas colunas deixam de ser
  // obrigatorias. Guardamos NULL e nunca string vazia: a checagem de e-mail
  // repetido compara lower(email), e dois '' colidiriam entre si.
  await passo('ALTER TABLE users ALTER COLUMN email DROP NOT NULL')

  // ----- prazo deixa de ser obrigatorio -----
  // Projeto e etapa passam a poder nascer sem prazo: o cadastro aceita o que a
  // pessoa tem na mao e cobra o resto pelo aviso de pendencia. As colunas eram
  // NOT NULL enquanto o formulario ja deixava salvar em branco — a gravacao
  // morria no banco, com 500 na cara de quem tentava.
  await passo('ALTER TABLE projects ALTER COLUMN start_date DROP NOT NULL')
  await passo('ALTER TABLE projects ALTER COLUMN end_date DROP NOT NULL')
  await passo('ALTER TABLE tasks ALTER COLUMN start_date DROP NOT NULL')
  await passo('ALTER TABLE tasks ALTER COLUMN end_date DROP NOT NULL')

  // ----- setor passa a ser so a AREA -----
  // Setor é ÁREA, e a empresa tem três: Engenharia, Arquitetura e TI. A coluna
  // acumulou gerações de valor — cargos que eram setor (Orçamento, Coordenação,
  // Direção, Estágio), a lista em slug do início do app ('engenharia',
  // 'tecnologia-informacao') e a segunda lista em slug que chegou junto com a
  // formação ('projetos-prediais', 'projetos-eletricos').
  //
  // Qualquer valor fora das três atuais é setor inválido: o campo abre vazio no
  // cadastro e o conselho some — a mesma falha que os usuários apontaram.
  //
  // Estágio depende do cargo: o estagiário fica na área em que trabalha, e
  // "Estagiário" é o cargo dele. A busca por TI é por palavra inteira porque
  // '%TI%' casa com "OrçamenTIsta", que é engenharia.
  const estagios = await passo(`
    UPDATE users SET sector = CASE
      WHEN job_title ILIKE '%arquitet%' THEN 'Arquitetura'
      WHEN job_title ~* '(^|[^a-zà-ú])ti([^a-zà-ú]|$)' THEN 'TI'
      ELSE 'Engenharia' END
    WHERE lower(sector) IN ('estagio', 'estágio')
    RETURNING id`)

  // A mesma tabela de equivalência serve aos dois UPDATEs abaixo (cadastro da
  // pessoa e destinatário de mudança): copiada em cada um, um setor novo
  // entraria em uma cópia e seria esquecido na outra.
  const SETORES_ANTIGOS = [
    ['engenharia', 'Engenharia'],
    ['orcamento', 'Engenharia'],
    ['orçamento', 'Engenharia'],
    ['coordenacao', 'Engenharia'],
    ['coordenação', 'Engenharia'],
    ['coordenacão', 'Engenharia'],
    ['direcao', 'Engenharia'],
    ['direção', 'Engenharia'],
    ['direcão', 'Engenharia'],
    ['estagio', 'Engenharia'],
    ['estágio', 'Engenharia'],
    ['projetos-prediais', 'Engenharia'],
    ['projetos prediais', 'Engenharia'],
    ['projetos-eletricos', 'Engenharia'],
    ['projetos elétricos', 'Engenharia'],
    ['arquitetura', 'Arquitetura'],
    ['ti', 'TI'],
    ['tecnologia-informacao', 'TI'],
    ['tecnologia da informação', 'TI'],
  ]
  const deAntigo = SETORES_ANTIGOS.map(p => p[0])
  const paraNovo = SETORES_ANTIGOS.map(p => p[1])

  // O resto sai por equivalência. A comparação é em minúsculas e aceita as duas
  // grafias de cada nome, com e sem acento, porque a coluna tem as duas.
  //
  // Vem DEPOIS do estágio de propósito: a tabela também traduz "Estágio", para
  // dar conta dos destinatários de mudança (que não têm cargo para consultar),
  // e se rodasse primeiro atropelaria a regra por cargo acima.
  const setoresAntigos = await passo(`
    UPDATE users u SET sector = m.novo
      FROM unnest($1::text[], $2::text[]) AS m(antigo, novo)
     WHERE lower(u.sector) = m.antigo AND u.sector IS DISTINCT FROM m.novo
    RETURNING u.id`, [deAntigo, paraNovo])

  if (setoresAntigos.length || estagios.length) {
    console.log(`[promav] setor normalizado para area em ${setoresAntigos.length + estagios.length} cadastro(s)`)
  }

  // As mudanças endereçadas a um setor antigo deixariam de encontrar alguém — o
  // destinatário fica gravado pelo nome do setor, não por id de tabela.
  await passo(`
    UPDATE changes c SET target_sectors = novo.lista
      FROM (
        SELECT ch.id, jsonb_agg(DISTINCT COALESCE(m.novo, s)) AS lista
          FROM changes ch, jsonb_array_elements_text(COALESCE(ch.target_sectors, '[]'::jsonb)) s
          LEFT JOIN unnest($1::text[], $2::text[]) AS m(antigo, novo) ON lower(s) = m.antigo
         GROUP BY ch.id
      ) novo
     WHERE c.id = novo.id AND c.target_sectors IS DISTINCT FROM novo.lista`, [deAntigo, paraNovo])
  await passo("UPDATE checklist_items SET done = (state = 'done') WHERE done <> (state = 'done')")

  // Equipe de desenvolvimento do app: contas que mantêm o sistema, não gente
  // que toca obra. Ficam fora da equipe dos projetos (e da responsabilidade),
  // por isso a marca é por e-mail — id muda, e-mail não. A lista é a fonte da
  // verdade: tirar alguém daqui devolve a pessoa ao cadastro no próximo boot.
  await passo('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false')
  const devEmails = (process.env.DEV_EMAILS || 'kauaalbuquerque77@gmail.com,janylson.promav@gmail.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  await passo('UPDATE users SET is_dev = (lower(email) = ANY($1)) WHERE is_dev IS DISTINCT FROM (lower(email) = ANY($1))', [devEmails])

  // Bootstrap do administrador: promove o ADMIN_EMAIL e garante ao menos um admin.
  const adminEmail = process.env.ADMIN_EMAIL || 'engenharia.promav@gmail.com'
  await passo('UPDATE users SET is_admin = true WHERE lower(email) = lower($1)', [adminEmail])
  const [{ count }] = await passo('SELECT count(*)::int AS count FROM users WHERE is_admin')
  if (!count) {
    await passo('UPDATE users SET is_admin = true WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)')
    console.warn('[promav] nenhum admin encontrado — promovi o primeiro usuário. Defina ADMIN_EMAIL para escolher.')
  }

  // Órfãos deixados por exclusões antigas de usuário (antes de o DELETE limpar
  // os jsonb): id de responsável que não existe mais em users.
  await passo(`
    UPDATE projects p
       SET responsible_ids = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(p.responsible_ids) x
                                        WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = x)), '[]'::jsonb)
     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.responsible_ids) x
                    WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x))`)
}

let server = null
let encerrando = false
// O Render manda SIGTERM a cada deploy e a cada spin-down: sem tratar, o
// processo morre no meio das requisições em voo e deixa conexões abertas no
// Neon. Para de aceitar novas, espera as que estão rodando e fecha o pool.
const encerrar = (sinal) => {
  if (encerrando) return
  encerrando = true
  console.log('[promav] recebi', sinal, '— encerrando')
  const fim = () => pool.end().finally(() => process.exit(0))
  if (!server) return fim()                 // sinal chegou durante o ensureSchema
  server.close(fim)
  server.closeIdleConnections?.()
  // Conexão pendurada não segura o deploy para sempre.
  setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGTERM', encerrar)
process.on('SIGINT', encerrar)

ensureSchema()
  .catch((e) => console.error('[promav] falha ao garantir schema (tabelas-base ausentes? aplique server/schema.sql):', e.message,
    '\n  statement:', e.passoSchema || '?', '\n', e.stack || e))
  .finally(() => {
    server = app.listen(PORT, () => {
      console.log(`[promav] backend rodando em http://localhost:${PORT}`)
    })
  })
