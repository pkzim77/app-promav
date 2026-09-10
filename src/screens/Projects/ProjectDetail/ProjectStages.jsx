import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { AvatarStack, SemResponsavel } from '../../../components/primitives/primitives.jsx'
import { TaskTimerButton } from '../../../components/TimeTracker/TimeTracker.jsx'
import { checklistStats, taskMembers } from '../../../data/store.js'
import { EmptyState } from '../shared/EmptyState.jsx'

// Etapas — substitui a antiga aba Atividades. As duas mostravam a MESMA tabela
// de tasks: 74 das 85 atividades já seguem o template numerado do processo
// (0 · Contratação direta … 10 · Licitação), que a equipe recriava à mão.
// Aqui elas são lidas como as etapas que são; o que não segue o padrão cai em
// "Outras atividades" no fim, para nada sumir.
//
// Clicar na etapa abre o CHECKLIST na própria linha — o modal de edição
// continua acessível, mas por um botão explícito.

// "2 · Projetos" → { n: 2, nome: 'Projetos' }. O separador é o ponto médio.
const PADRAO_ETAPA = /^(\d+)\s*·\s*(.+)$/

const ORDEM_STATUS = { todo: 0, progress: 1, done: 2 }
const ROTULO_STATUS = { todo: 'PENDENTE', progress: 'EM ANDAMENTO', done: 'CONCLUÍDA' }

// O status NÃO vira nome de classe direto. 'progress' colidia com a .progress
// global do kit (a barra de progresso: height 7px, overflow hidden), e a linha
// da etapa em andamento era achatada para 7px de altura. Prefixo próprio.
const CLASSE_STATUS = { todo: 'et-todo', progress: 'et-prog', done: 'et-done' }

// Uma etapa pode ter mais de uma task quando o template foi recriado duas
// vezes (acontece: "9 · Diligências" está duplicada em três projetos). Em vez
// de esconder, agrupa pelo número e avisa.
function agruparEtapas(tasks) {
  const porNumero = new Map()
  const avulsas = []
  for (const t of tasks) {
    const m = PADRAO_ETAPA.exec(t.title || '')
    if (!m) { avulsas.push(t); continue }
    const n = Number(m[1])
    if (!porNumero.has(n)) porNumero.set(n, { n, nome: m[2].trim(), tasks: [] })
    porNumero.get(n).tasks.push(t)
  }
  const etapas = [...porNumero.values()].sort((a, b) => a.n - b.n)
  for (const e of etapas) {
    const st = checklistDaEtapa(e.tasks)
    e.feitos = st.done
    e.total = st.total
    // Status da etapa: o MENOS avançado entre as suas tasks. Uma etapa com
    // uma cópia concluída e outra pendente não está concluída.
    e.status = e.tasks.reduce((pior, t) =>
      ORDEM_STATUS[t.status] < ORDEM_STATUS[pior] ? t.status : pior, 'done')
    e.membros = [...new Set(e.tasks.flatMap(t => taskMembers(t)))]
  }
  return { etapas, avulsas }
}

const checklistDaEtapa = (tasks) => tasks.reduce((acc, t) => {
  const s = checklistStats(t)
  return { done: acc.done + s.done, total: acc.total + s.total }
}, { done: 0, total: 0 })

function SeloEtapa({ status }) {
  return (
    <span className={'et-selo ' + CLASSE_STATUS[status]}>
      <span className="et-selo-dot" />{ROTULO_STATUS[status]}
    </span>
  )
}

// Checklist marcável na própria linha. O PATCH /tasks/:id/checklist já é
// permitido para 'Só exibição' — quem só visualiza marca o que fez.
//
// Cada item pode ter dono próprio: numa atividade com duas pessoas, cada uma
// costuma cuidar de uma parte, e sem isso só se sabe que "alguém do par" está
// devendo. Com um único responsável o dono é ele, sem precisar escolher;
// com mais de um aparece o seletor, e deixar em branco é permitido.
function Checklist({ task, responsaveis, onToggle, onAssign }) {
  const itens = task.checklist || []
  if (!itens.length) return null
  const unico = responsaveis.length === 1 ? responsaveis[0] : null
  return (
    <ul className="et-ck">
      {itens.map(item => {
        // Sem dono gravado e com um só responsável, é ele por dedução — não
        // gravamos para não congelar o nome se a atividade trocar de mãos.
        const dono = responsaveis.find(u => u.id === item.assigneeId) || unico
        return (
          <li key={item.id} className={item.done ? 'ok' : ''}>
            <label>
              <input type="checkbox" checked={!!item.done}
                onChange={() => onToggle(task, item.id)} />
              <span>{item.text}</span>
            </label>
            {responsaveis.length > 1 ? (
              <select className="et-ck-dono" value={item.assigneeId || ''}
                aria-label={`Responsável por: ${item.text}`}
                onChange={(e) => onAssign(task, item.id, e.target.value || null)}>
                <option value="">Sem responsável</option>
                {responsaveis.map(u => <option key={u.id} value={u.id}>{u.name.split(' ')[0]}</option>)}
              </select>
            ) : dono ? (
              <span className="et-ck-dono-fixo" title={dono.name}>
                <span className="av" style={{ width: 20, height: 20, background: dono.color, fontSize: 9 }}>{dono.initials}</span>
                {dono.name.split(' ')[0]}
              </span>
            ) : (
              // Etapa sem ninguém: o item também fica sem dono, e isso precisa
              // aparecer. São 147 dos 152 itens hoje.
              <SemResponsavel compacto />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function CorpoDaTask({ task, users, sessions, currentUserId, now, canEdit, mostrarTitulo,
                      onToggleChecklist, onAssignChecklist, onEditTask, onDeleteTask, onStartTimer, onStopTimer }) {
  const membros = taskMembers(task).map(id => users.find(u => u.id === id)).filter(Boolean)
  const semChecklist = !(task.checklist || []).length
  return (
    <div className="et-task">
      {mostrarTitulo && <div className="et-task-tit">{task.title}</div>}
      {semChecklist
        ? <p className="et-vazio">Esta etapa não tem checklist.</p>
        : <Checklist task={task} responsaveis={membros} onToggle={onToggleChecklist} onAssign={onAssignChecklist} />}
      <div className="et-acoes">
        {membros.length > 0
          ? <><AvatarStack users={membros} size={24} max={4} />
              <span className="et-quem">{membros[0].name.split(' ')[0]}{membros.length > 1 ? ` +${membros.length - 1}` : ''}</span></>
          : <SemResponsavel />}
        <div className="et-botoes">
          <TaskTimerButton task={task} sessions={sessions} currentUserId={currentUserId} now={now}
            onStart={onStartTimer} onStop={onStopTimer} />
          <button className="btn btn-secondary btn-sm" onClick={() => onEditTask(task)}>
            <Icon name={canEdit ? 'pencil' : 'externalLink'} size={14} />{canEdit ? 'Editar' : 'Ver'}
          </button>
          {canEdit && (
            <button className="btn-icon" onClick={() => onDeleteTask(task)} aria-label="Excluir atividade">
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Etapa({ etapa, aberta, onToggleAberta, ...resto }) {
  const duplicada = etapa.tasks.length > 1
  const primeira = etapa.tasks[0]
  return (
    <li id={'task-' + primeira.id} className={'et-item ' + CLASSE_STATUS[etapa.status]}>
      <button type="button" className="et-cab" aria-expanded={aberta} onClick={onToggleAberta}>
        <span className="et-num">{etapa.n}</span>
        <span className="et-linha">
          <Icon name="chevronRight" size={14} className="et-seta" />
          <span className="et-nome">{etapa.nome}</span>
          <SeloEtapa status={etapa.status} />
          {etapa.total > 0 && <span className="et-conta">{etapa.feitos}/{etapa.total}</span>}
          {duplicada && <span className="et-dup">{etapa.tasks.length}× duplicada</span>}
        </span>
      </button>
      {aberta && (
        <div className="et-corpo">
          {duplicada && (
            <p className="et-aviso">
              <Icon name="flag" size={14} />
              Esta etapa está cadastrada {etapa.tasks.length} vezes neste projeto. Cada
              cópia aparece abaixo — apagar as sobrando limpa o Kanban e a contagem.
            </p>
          )}
          {etapa.tasks.map(t => (
            <CorpoDaTask key={t.id} task={t} mostrarTitulo={duplicada} {...resto} />
          ))}
        </div>
      )}
    </li>
  )
}

const FILTROS = [
  { id: 'all', label: 'Todas' },
  { id: 'progress', label: 'Em andamento' },
  { id: 'done', label: 'Concluídas' },
  { id: 'todo', label: 'Pendentes' },
]

export function ProjectStages({ project, tasks, users, sessions, currentUserId, now, canEdit = true,
                               onToggleChecklist, onAssignChecklist, onNewTask, onNewStageItem, onCreateStages,
                               onEditTask, onDeleteTask, onStartTimer, onStopTimer }) {
  const doProjeto = React.useMemo(() => tasks.filter(t => t.projectId === project.id), [tasks, project.id])
  const { etapas, avulsas } = React.useMemo(() => agruparEtapas(doProjeto), [doProjeto])

  const [filtro, setFiltro] = React.useState('all')
  // Abre sozinhas as etapas em andamento: é onde o trabalho está agora.
  // Reaproveita o `etapas` do useMemo acima — o inicializador do useState
  // refazia o agrupamento inteiro por conta própria, calculando duas vezes a
  // mesma coisa na montagem.
  const [abertas, setAbertas] = React.useState(
    () => new Set(etapas.filter(e => e.status === 'progress').map(e => e.n))
  )
  const alternar = (n) => setAbertas(prev => {
    const s = new Set(prev)
    s.has(n) ? s.delete(n) : s.add(n)
    return s
  })

  const contagem = {
    all: etapas.length,
    done: etapas.filter(e => e.status === 'done').length,
    progress: etapas.filter(e => e.status === 'progress').length,
    todo: etapas.filter(e => e.status === 'todo').length,
  }
  const itens = checklistDaEtapa(doProjeto)
  const pctEtapas = etapas.length ? Math.round(contagem.done / etapas.length * 100) : 0
  const pctEmCurso = etapas.length ? contagem.progress / etapas.length * 100 : 0
  const visiveis = filtro === 'all' ? etapas : etapas.filter(e => e.status === filtro)

  // 29 dos 36 projetos não tinham etapa nenhuma, e a equipe vinha recriando as
  // 11 à mão — foi assim que surgiram as duplicatas. O botão cria de uma vez.
  const semEtapas = etapas.length === 0
  if (semEtapas) {
    return <EmptyState icon="list" title="Nenhuma etapa cadastrada"
      text="As 11 etapas do processo — de Contratação direta até Licitação — ainda não existem neste projeto."
      action={canEdit ? (
        <div className="et-nova">
          <button className="btn btn-primary" onClick={() => onCreateStages(project.id)}>
            <Icon name="plus" size={17} stroke={2.2} />Criar template
          </button>
          <button className="btn btn-ghost" onClick={() => onNewTask(project.id)}>Atividade avulsa</button>
        </div>
      ) : null} />
  }

  const repasse = { users, sessions, currentUserId, now, canEdit, onToggleChecklist, onAssignChecklist, onEditTask, onDeleteTask, onStartTimer, onStopTimer }

  return (
    <div className="proj-etapas">
      <div className="card et-resumo">
        <div className="et-resumo-topo">
          <div>
            <span className="et-resumo-lab">Progresso das etapas</span>
            <div className="et-resumo-sub">
              <b>{contagem.done} de {etapas.length}</b> etapas
              {itens.total > 0 && <> · <b>{itens.done} de {itens.total}</b> itens</>}
            </div>
          </div>
          <span className="et-resumo-pct">{pctEtapas}%</span>
        </div>
        {/* Sólido conta no percentual; hachurado é o que está em curso e ainda
            não conta — sem isso a barra misturaria feito com fazendo. */}
        <div className="et-barra">
          <i className="feito" style={{ width: pctEtapas + '%' }} />
          <i className="curso" style={{ width: pctEmCurso + '%' }} />
        </div>
        <div className="et-legenda">
          <span><i className="sw feito" />{contagem.done} concluídas — contam no percentual</span>
          <span><i className="sw curso" />{contagem.progress} em andamento — não contam</span>
          <span><i className="sw falta" />{contagem.todo} pendentes</span>
        </div>
      </div>

      <div className="et-barra-acoes">
        {FILTROS.map(f => (
          <button key={f.id} type="button"
            className={'chip' + (filtro === f.id ? ' active' : '')}
            aria-pressed={filtro === f.id}
            onClick={() => setFiltro(f.id)}>
            {f.label} ({contagem[f.id]})
          </button>
        ))}
        {canEdit && (
          <div className="et-nova">
            {/* "Nova atividade" agora pergunta a ETAPA e o trabalho entra como
                item do checklist dela. Antes criava texto livre, que não batia
                o padrão "N · Nome" e nascia direto em "Outras atividades". */}
            <button className="btn btn-primary btn-sm" onClick={() => onNewStageItem(project.id)}>
              <Icon name="plus" size={16} stroke={2.2} />Nova atividade
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onNewTask(project.id)}
              title="Cria uma atividade fora do template de etapas">
              Atividade avulsa
            </button>
          </div>
        )}
      </div>

      {visiveis.length === 0 ? (
        <p className="et-vazio-filtro">Nenhuma etapa neste estado.</p>
      ) : (
        <ol className="et-lista">
          {visiveis.map(e => (
            <Etapa key={e.n} etapa={e} aberta={abertas.has(e.n)} onToggleAberta={() => alternar(e.n)} {...repasse} />
          ))}
        </ol>
      )}

      {avulsas.length > 0 && (
        <details className="et-avulsas">
          <summary>
            <Icon name="chevronRight" size={14} className="et-seta" />
            Outras atividades ({avulsas.length}) — fora do template de etapas
          </summary>
          <div className="et-avulsas-corpo">
            {avulsas.map(t => (
              <CorpoDaTask key={t.id} task={t} mostrarTitulo {...repasse} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
