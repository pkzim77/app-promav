// ============================================================
// Promav — shared store (single source of truth)
// Seed data for users, projects, tasks + helpers. Imported by
// every screen so they read/write the same data shape.
// ============================================================

export const PROJECT_COLORS = {
  indigo: 'var(--proj-indigo)', blue: 'var(--proj-blue)', teal: 'var(--proj-teal)',
  green: 'var(--proj-green)', amber: 'var(--proj-amber)', coral: 'var(--proj-coral)',
  pink: 'var(--proj-pink)', purple: 'var(--proj-purple)',
}
export const PROJECT_HEX = {
  indigo: '#6366F1', blue: '#2D7FF9', teal: '#14B8A6', green: '#22B07D',
  amber: '#F5A623', coral: '#F0603F', pink: '#EC4899', purple: '#A855F7',
}

export const STATUSES = [
  { id: 'todo',     label: 'A fazer',      color: 'var(--status-todo)',     soft: 'var(--status-todo-soft)',     text: '#5c5c78' },
  { id: 'progress', label: 'Em andamento', color: 'var(--status-progress)', soft: 'var(--status-progress-soft)', text: '#1f64cc' },
  { id: 'done',     label: 'Concluído',    color: 'var(--status-done)',     soft: 'var(--status-done-soft)',     text: '#157a49' },
]
export const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]))

export const PRIORITIES = [
  { id: 'low',    label: 'Baixa', color: 'var(--prio-low)',    hex: '#7B8794', soft: 'var(--prio-low-soft)',    text: '#5a6470' },
  { id: 'medium', label: 'Média', color: 'var(--prio-medium)', hex: '#E8920C', soft: 'var(--prio-medium-soft)', text: '#a8680a' },
  { id: 'high',   label: 'Alta',  color: 'var(--prio-high)',   hex: '#E5484D', soft: 'var(--prio-high-soft)',   text: '#c5333a' },
]
export const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map(p => [p.id, p]))

export const SEED_USERS = [
  { id: 'u1', name: 'Marina Souza',  initials: 'MS', color: 'var(--proj-blue)' },
  { id: 'u2', name: 'Lucas Rocha',   initials: 'LR', color: 'var(--proj-purple)' },
  { id: 'u3', name: 'Camila Alves',  initials: 'CA', color: 'var(--proj-green)' },
  { id: 'u4', name: 'João Pereira',  initials: 'JP', color: 'var(--proj-coral)' },
  { id: 'u5', name: 'Rafael Brito',  initials: 'RB', color: 'var(--proj-teal)' },
]

export const SEED_PROJECTS = [
  { id: 'p1', name: 'Rebrand 2026',       desc: 'Nova identidade visual e site institucional.', color: 'coral', start: '2026-05-04', end: '2026-06-19' },
  { id: 'p2', name: 'App mobile',         desc: 'Lançamento do app iOS e Android.',             color: 'teal',  start: '2026-05-11', end: '2026-07-03' },
  { id: 'p3', name: 'Marketing Q2',       desc: 'Campanhas e conteúdo do segundo trimestre.',   color: 'amber', start: '2026-05-01', end: '2026-06-12' },
  { id: 'p4', name: 'Onboarding clientes',desc: 'Melhorar a ativação de novos clientes.',       color: 'blue',  start: '2026-05-18', end: '2026-06-30' },
]

export const SEED_TASKS = [
  { id: 't1',  projectId: 'p1', title: 'Finalizar manual de marca', assigneeId: 'u1', status: 'progress', priority: 'high',   start: '2026-05-14', end: '2026-05-28' },
  { id: 't2',  projectId: 'p1', title: 'Aprovar nova paleta',       assigneeId: 'u3', status: 'done',     priority: 'high',   start: '2026-05-04', end: '2026-05-12' },
  { id: 't3',  projectId: 'p1', title: 'Wireframes do site',        assigneeId: 'u2', status: 'progress', priority: 'medium', start: '2026-05-18', end: '2026-05-30' },
  { id: 't4',  projectId: 'p1', title: 'Sessão de fotos',           assigneeId: 'u4', status: 'todo',     priority: 'low',    start: '2026-06-01', end: '2026-06-08' },
  { id: 't5',  projectId: 'p1', title: 'Publicar site institucional', assigneeId: 'u1', status: 'todo',  priority: 'high',   start: '2026-06-10', end: '2026-06-19' },
  { id: 't6',  projectId: 'p2', title: 'Telas de onboarding',       assigneeId: 'u2', status: 'progress', priority: 'medium', start: '2026-05-20', end: '2026-05-30' },
  { id: 't7',  projectId: 'p2', title: 'Integração de login',       assigneeId: 'u5', status: 'todo',     priority: 'high',   start: '2026-05-25', end: '2026-06-05' },
  { id: 't8',  projectId: 'p2', title: 'Design system mobile',      assigneeId: 'u3', status: 'done',     priority: 'medium', start: '2026-05-11', end: '2026-05-22' },
  { id: 't9',  projectId: 'p2', title: 'Testes beta',               assigneeId: 'u4', status: 'todo',     priority: 'medium', start: '2026-06-08', end: '2026-06-20' },
  { id: 't10', projectId: 'p2', title: 'Publicar nas lojas',        assigneeId: 'u1', status: 'todo',     priority: 'high',   start: '2026-06-25', end: '2026-07-03' },
  { id: 't11', projectId: 'p3', title: 'Calendário editorial',      assigneeId: 'u3', status: 'done',     priority: 'low',    start: '2026-05-01', end: '2026-05-08' },
  { id: 't12', projectId: 'p3', title: 'Campanha de lançamento',    assigneeId: 'u4', status: 'progress', priority: 'high',   start: '2026-05-12', end: '2026-05-30' },
  { id: 't13', projectId: 'p3', title: 'Newsletter de maio',        assigneeId: 'u1', status: 'done',     priority: 'medium', start: '2026-05-05', end: '2026-05-15' },
  { id: 't14', projectId: 'p3', title: 'Anúncios pagos',            assigneeId: 'u5', status: 'todo',     priority: 'medium', start: '2026-05-28', end: '2026-06-12' },
  { id: 't15', projectId: 'p4', title: 'Fluxo de ativação',         assigneeId: 'u2', status: 'progress', priority: 'high',   start: '2026-05-18', end: '2026-06-02' },
  { id: 't16', projectId: 'p4', title: 'E-mails de boas-vindas',    assigneeId: 'u3', status: 'todo',     priority: 'medium', start: '2026-05-12', end: '2026-05-22' },
  { id: 't17', projectId: 'p4', title: 'Tutorial in-app',           assigneeId: 'u1', status: 'todo',     priority: 'low',    start: '2026-06-05', end: '2026-06-18' },
]

// ---------- checklists (subetapas por atividade) ----------
// Fonte do progresso fino de cada atividade. done=true marca o item concluído.
const CHECKLISTS = {
  t1:  [['Coletar referências',1],['Definir grid e tipografia',1],['Diagramar páginas',0],['Revisão final',0]],
  t2:  [['Testar contraste',1],['Aprovar com o time',1],['Documentar tokens',1]],
  t3:  [['Mapa do site',1],['Wireframe da home',1],['Wireframe internas',0],['Validar com stakeholders',0]],
  t4:  [['Briefing da sessão',0],['Reservar estúdio',0],['Lista de cenas',0]],
  t5:  [['Configurar hospedagem',0],['Migrar conteúdo',0],['Testes de QA',0],['Go live',0]],
  t6:  [['Fluxo de telas',1],['Protótipo navegável',1],['Microcopy',0],['Handoff para dev',0]],
  t7:  [['Tela de login',0],['Integração OAuth',0],['Recuperação de senha',0]],
  t8:  [['Componentes base',1],['Tokens de cor',1],['Documentação',1]],
  t9:  [['Recrutar testers',0],['Roteiro de testes',0],['Coletar feedback',0]],
  t10: [['Assets das lojas',0],['Ficha App Store',0],['Ficha Play Store',0],['Enviar para revisão',0]],
  t11: [['Levantar datas-chave',1],['Montar calendário',1]],
  t12: [['Conceito criativo',1],['Peças gráficas',1],['Plano de mídia',0],['Aprovação final',0]],
  t13: [['Definir pauta',1],['Redigir texto',1],['Disparar',1]],
  t14: [['Definir público',0],['Criar anúncios',0],['Configurar campanha',0]],
  t15: [['Mapear jornada',1],['Definir gatilhos',1],['Implementar fluxo',0],['Medir conversão',0]],
  t16: [['Escrever copy',0],['Montar template',0],['Programar envio',0]],
  t17: [['Roteiro do tour',0],['Telas guiadas',0],['Publicar',0]],
}
SEED_TASKS.forEach(t => {
  t.checklist = (CHECKLISTS[t.id] || []).map(([text, done], i) => ({ id: `${t.id}-c${i}`, text, done: !!done }))
})

// ---------- membros adicionais por atividade (além do responsável) ----------
const MEMBERS = {
  t1:  ['u3','u4'],
  t3:  ['u1'],
  t6:  ['u5'],
  t7:  ['u2','u3'],
  t12: ['u1','u5'],
  t15: ['u3'],
}
SEED_TASKS.forEach(t => { t.memberIds = MEMBERS[t.id] ? [...MEMBERS[t.id]] : [] })

// Todas as pessoas de uma atividade: responsável + membros (sem duplicar).
export function taskMembers(task) {
  const ids = [task.assigneeId, ...(task.memberIds || [])].filter(Boolean)
  return [...new Set(ids)]
}

// ---------- date helpers ----------
export const MONTHS_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
export function parseDate(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d) }
export function fmtShort(s) { const d = parseDate(s); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}` }
export function fmtMed(s) { const d = parseDate(s); return `${d.getDate()} de ${MONTHS_PT[d.getMonth()]}` }
export function fmtFull(s) { const d = parseDate(s); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` }
export function dayDiff(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000) }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
export function todayISO() { return '2026-05-26' } // fixed "today" for the prototype

// ---------- checklist / progress helpers ----------
export function checklistStats(task) {
  const list = task.checklist || []
  const total = list.length
  const done = list.filter(i => i.done).length
  return { total, done, remaining: total - done, pct: total ? Math.round(done / total * 100) : null }
}
// Progresso fino de uma atividade: usa o checklist se houver; senão, infere do status.
export function taskProgress(task) {
  const { total, pct } = checklistStats(task)
  if (total) return pct
  return task.status === 'done' ? 100 : task.status === 'progress' ? 50 : 0
}

export function projectProgress(tasks, projectId) {
  const list = tasks.filter(t => t.projectId === projectId)
  if (!list.length) return 0
  return Math.round(list.reduce((s, t) => s + taskProgress(t), 0) / list.length)
}
