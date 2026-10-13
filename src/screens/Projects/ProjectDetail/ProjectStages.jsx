import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { AvatarStack, SegControl, SemResponsavel, AvisoPendencias, useFecharFora } from '../../../components/primitives/primitives.jsx'
import { TaskTimerButton } from '../../../components/TimeTracker/TimeTracker.jsx'
import { STATUSES, STATUS_MAP, CHECK_STATES, estadoDoItem, calcularProgresso, checklistStats, taskMembers, pendenciasDaEtapa } from '../../../data/store.js'
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

const ORDEM_STATUS = { todo: 0, progress: 1, review: 2, diligence: 3, done: 4 }
const ROTULO_STATUS = { todo: 'PENDENTE', progress: 'EM ANDAMENTO', review: 'EM REVISÃO', diligence: 'EM DILIGÊNCIA', done: 'CONCLUÍDA' }

// Opções do seletor: as MESMAS de STATUSES (ids, cores) usadas no TaskModal,
// só que com o vocabulário desta aba. Aqui o estado é de uma ETAPA, e o selo
// no cabeçalho já diz PENDENTE/CONCLUÍDA — escrever "A fazer"/"Concluído" no
// mesmo cartão daria dois nomes ao mesmo estado.
const ROTULO_BOTAO = { todo: 'Pendente', progress: 'Em andamento', review: 'Em revisão', diligence: 'Em diligência', done: 'Concluída' }
const OPCOES_STATUS = STATUSES.map(s => ({ ...s, label: ROTULO_BOTAO[s.id] }))

// O status NÃO vira nome de classe direto. 'progress' colidia com a .progress
// global do kit (a barra de progresso: height 7px, overflow hidden), e a linha
// da etapa em andamento era achatada para 7px de altura. Prefixo próprio.
const CLASSE_STATUS = { todo: 'et-todo', progress: 'et-prog', review: 'et-review', diligence: 'et-dilig', done: 'et-done' }

// Quantas etapas há em cada status. Parte de STATUSES para que todo status
// exista com zero: o menu de filtro lê `contagem[f.id]`, e um status sem
// etapa nenhuma mostraria `undefined` no lugar do número.
const contarPorStatus = (lista) => {
  const c = { all: lista.length }
  for (const s of STATUSES) c[s.id] = 0
  for (const e of lista) c[e.status] = (c[e.status] || 0) + 1
  return c
}

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
    <span className={'et-selo ' + (CLASSE_STATUS[status] || '')}>
      <span className="et-selo-dot" />{ROTULO_STATUS[status]}
    </span>
  )
}

// Troca o status na própria linha. Numa atividade SEM checklist não havia
// nada clicável aqui — o estado só mudava abrindo o modal ou arrastando no
// Kanban, então na prática ela ficava parada em "pendente" para sempre.
//
// Sem gate de canEdit, igual ao checklist: PATCH /tasks/:id/status usa o
// mesmo CAN.light no servidor, o mesmo que libera marcar item para quem só
// visualiza. Quem faz o serviço registra que fez.
function SeletorStatus({ task, onMoveTask }) {
  if (!onMoveTask) return null
  const atual = task.status || 'todo'
  return (
    <div className="et-status" role="group" aria-label={`Status: ${task.title}`}>
      <span className="et-status-lab">Status</span>
      <SegControl options={OPCOES_STATUS} value={atual}
        onChange={(id) => { if (id !== atual) onMoveTask(task.id, id) }} />
    </div>
  )
}

// Checklist marcável na própria linha. O PATCH /tasks/:id/checklist já é
// permitido para 'Só exibição' — quem só visualiza marca o que fez.
//
// Cada item pode ter dono próprio: numa atividade com duas pessoas, cada uma
// costuma cuidar de uma parte, e sem isso só se sabe que "alguém do par" está
// devendo. Com um único responsável o dono é ele, sem precisar escolher;
// com mais de um aparece o seletor, e deixar em branco é permitido.
function Checklist({ task, responsaveis, canEdit, onAssign, onSetState, onEditItem, onExcluirItem }) {
  const itens = task.checklist || []
  const [editando, setEditando] = React.useState(null)
  if (!itens.length) return null
  const unico = responsaveis.length === 1 ? responsaveis[0] : null
  return (
    <ul className="et-ck">
      {itens.map(item => {
        // Sem dono gravado e com um só responsável, é ele por dedução — não
        // gravamos para não congelar o nome se a atividade trocar de mãos.
        const dono = responsaveis.find(u => u.id === item.assigneeId) || unico
        const estado = estadoDoItem(item)
        const cor = STATUS_MAP[estado] || STATUS_MAP.todo
        const salvar = (valor) => { onEditItem(task, item.id, valor); setEditando(null) }
        return (
          <li key={item.id} className={estado === 'done' ? 'ok' : ''}>
            {/* Era uma caixa de marcar, que só sabia dizer feito ou não feito.
                Revisão e diligência não cabiam ali — e é justamente nelas que o
                serviço passa mais tempo parado. */}
            <select className="estado-chip" value={estado}
              style={{ background: cor.soft, color: cor.text }}
              aria-label={`Estado de: ${item.text}`}
              onChange={(e) => onSetState(task, item.id, e.target.value)}>
              {CHECK_STATES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {editando === item.id ? (
              // Corrigir o texto na própria linha. Antes era apagar e refazer, e
              // o item novo nascia sem dono, desmarcado e no fim da lista — um
              // erro de digitação custava os três.
              //
              // Esc devolve o texto original ANTES de sair: o blur da saída
              // ainda dispara, e sem isso o cancelamento gravaria assim mesmo.
              <input className="control et-ck-editar" defaultValue={item.text} autoFocus
                aria-label={`Texto de: ${item.text}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); salvar(e.target.value) }
                  if (e.key === 'Escape') { e.preventDefault(); e.target.value = item.text; setEditando(null) }
                }}
                onBlur={(e) => salvar(e.target.value)} />
            ) : (
              <span className="et-ck-texto">{item.text}</span>
            )}
            {canEdit && editando !== item.id && (<>
              <button type="button" className="btn-icon et-ck-lapis" onClick={() => setEditando(item.id)}
                title="Corrigir o texto" aria-label={`Corrigir: ${item.text}`}>
                <Icon name="pencil" size={13} />
              </button>
              {/* Excluir a atividade sem abrir o modal da etapa. */}
              <button type="button" className="btn-icon et-ck-lixo" onClick={() => onExcluirItem(task, item)}
                title="Excluir a atividade" aria-label={`Excluir: ${item.text}`}>
                <Icon name="trash" size={13} />
              </button>
            </>)}
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

function CorpoDaTask({ task, users, sessions, currentUserId, now, canEdit, mostrarTitulo, avulsa = false,
                      onAssignChecklist, onSetChecklistState, onEditChecklistItem, onExcluirChecklistItem, onMoveTask, onEditTask, onDeleteTask, onStartTimer, onStopTimer }) {
  const membros = taskMembers(task).map(id => users.find(u => u.id === id)).filter(Boolean)
  const semChecklist = !(task.checklist || []).length
  return (
    // O id é a âncora do clique na notificação (ver ProjectDetail). Fica na
    // task, não na etapa, para alcançar as avulsas e cada cópia duplicada.
    <div className="et-task" id={'task-' + task.id}>
      {mostrarTitulo && (
        <div className="et-task-tit">
          {task.title}
          {/* Fora do template não há cabeçalho de etapa para carregar o estado,
              então ele vem para o título. Com checklist o selo é a única pista;
              sem checklist quem mostra é o seletor logo abaixo, e repetir aqui
              seria dizer a mesma coisa duas vezes na mesma caixa. */}
          {avulsa && !semChecklist && <SeloEtapa status={task.status || 'todo'} />}
        </div>
      )}
      {semChecklist
        ? <p className="et-vazio">{avulsa ? 'Esta atividade não tem sub-atividades.' : 'Esta etapa não tem atividades.'}</p>
        : <Checklist task={task} responsaveis={membros} canEdit={canEdit} onAssign={onAssignChecklist}
            onSetState={onSetChecklistState} onEditItem={onEditChecklistItem}
            onExcluirItem={onExcluirChecklistItem} />}
      {/* O seletor aparece exatamente onde o checklist NÃO decide o status:
          ajustarStatusPeloChecklist() (server/index.js) espelha o status a cada
          marcação e sai cedo quando não há itens. Com checklist, um seletor aqui
          seria desfeito no clique seguinte; sem checklist, nada o encosta. */}
      {semChecklist && <SeletorStatus task={task} onMoveTask={onMoveTask} />}
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

// O cabeçalho deixou de ser um botão só: a caixa de seleção e a lixeira são
// controles próprios, e botão dentro de botão não é HTML válido — o navegador
// desmancha a marcação e o clique passa a cair em qualquer um dos dois.
function Etapa({ etapa, aberta, onToggleAberta, selecionando, selecionada, onSelecionar, onExcluirEtapa, canEdit, ...resto }) {
  const duplicada = etapa.tasks.length > 1
  return (
    <li id={'etapa-' + etapa.n} className={'et-item ' + (CLASSE_STATUS[etapa.status] || '') + (selecionada ? ' et-marcada' : '')}>
      <div className="et-cab-linha">
        {selecionando && (
          <label className="et-marca" onClick={e => e.stopPropagation()}>
            <input type="checkbox" className="ck-nativo" checked={selecionada}
              aria-label={`Selecionar a etapa ${etapa.n} · ${etapa.nome}`}
              onChange={() => onSelecionar(etapa)} />
          </label>
        )}
        <button type="button" className="et-cab" aria-expanded={aberta} onClick={onToggleAberta}>
          <span className="et-num">{etapa.n}</span>
          <span className="et-linha">
            <Icon name="chevronRight" size={14} className="et-seta" />
            <span className="et-nome">{etapa.nome}</span>
            {/* A etapa pode nascer sem responsável, sem prazo ou sem atividades.
                O aviso é o que impede isso de virar esquecimento: a etapa existe,
                mas ninguém sabe de quem é nem para quando. */}
            <AvisoPendencias itens={pendenciasDaEtapa({
              assigneeId: etapa.tasks.some(t => t.assigneeId) || null,
              end: etapa.tasks.find(t => t.end)?.end || null,
              checklist: etapa.tasks.flatMap(t => t.checklist || []),
            })} oque="Falta nesta etapa" />
            <SeloEtapa status={etapa.status} />
            {etapa.total > 0 && <span className="et-conta">{etapa.feitos}/{etapa.total}</span>}
            {duplicada && <span className="et-dup">{etapa.tasks.length}× duplicada</span>}
          </span>
        </button>
        {/* Só com a etapa fechada. Aberta, cada atividade já tem a sua lixeira
            logo abaixo, e duas lixeiras à mesma distância do olho — uma que
            apaga a etapa inteira e outra que apaga uma linha — é o tipo de
            vizinhança que faz alguém apagar a coisa errada. */}
        {canEdit && !selecionando && !aberta && (
          <button type="button" className="btn-icon et-lixo" onClick={() => onExcluirEtapa(etapa)}
            title="Excluir a etapa" aria-label={`Excluir a etapa ${etapa.n} · ${etapa.nome}`}>
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
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
            <CorpoDaTask key={t.id} task={t} mostrarTitulo={duplicada} canEdit={canEdit} {...resto} />
          ))}
        </div>
      )}
    </li>
  )
}

// Criar o template fala com o banco, e demora o que a rede demorar. Sem
// nenhum sinal o clique parecia não ter pegado: a pessoa clicava de novo, e
// era assim que projetos acabavam com a mesma etapa cadastrada duas vezes.
// O rótulo muda junto com o giro — só a animação não diz nada a quem usa
// leitor de tela, e ela some inteira sob prefers-reduced-motion.
function BotaoCriarTemplate({ projectId, onCreateStages }) {
  const [criando, setCriando] = React.useState(false)
  const criar = async () => {
    setCriando(true)
    try { await onCreateStages(projectId) } finally { setCriando(false) }
  }
  return (
    <button className="btn btn-primary" onClick={criar} disabled={criando} aria-busy={criando}>
      {criando
        ? <><span className="spin" aria-hidden="true" />Criando etapas…</>
        : <><Icon name="plus" size={17} stroke={2.2} />Criar template</>}
    </button>
  )
}

const FILTROS = [
  { id: 'all', label: 'Todas' },
  { id: 'progress', label: 'Em andamento' },
  { id: 'review', label: 'Em revisão' },
  { id: 'diligence', label: 'Em diligência' },
  { id: 'done', label: 'Concluídas' },
  { id: 'todo', label: 'Pendentes' },
]

// Os seis estados viravam seis chips numa fileira que empurrava os botões de
// ação para a linha de baixo — e cinco deles costumam marcar zero. Como só um
// vale por vez, eles cabem num botão que diz qual está valendo.
//
// Não é <select> porque o rótulo carrega a contagem de cada estado, e o
// seletor nativo não deixa desenhar isso do lado direito de cada linha.
function FiltroEstado({ valor, contagem, onEscolher }) {
  const [aberto, setAberto] = React.useState(false)
  const caixa = React.useRef(null)

  useFecharFora(caixa, () => setAberto(false), aberto)

  const atual = FILTROS.find(f => f.id === valor) || FILTROS[0]
  return (
    <div className="msel et-filtro" ref={caixa}>
      <button type="button" className={'chip et-filtro-botao' + (valor === 'all' ? '' : ' active')}
        aria-expanded={aberto} aria-haspopup="true" onClick={() => setAberto(a => !a)}>
        <Icon name="filter" size={14} />
        {atual.label} ({contagem[atual.id]})
        <Icon name="chevronDown" size={15} className="et-filtro-seta" />
      </button>

      {aberto && (
        <div className="msel-lista et-filtro-lista" role="menu">
          {FILTROS.map(f => (
            <button key={f.id} type="button" role="menuitemradio" aria-checked={f.id === valor}
              className={'msel-item' + (f.id === valor ? ' on' : '')}
              onClick={() => { onEscolher(f.id); setAberto(false) }}>
              <span className="msel-nome">{f.label}</span>
              <span className="msel-tag">{contagem[f.id]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// "Minhas" é tudo em que a pessoa está: atividade no nome dela OU a etapa no
// nome dela. A primeira versão exigia atividade marcada, e escondia a etapa que
// é sua mas cujas atividades ainda não foram distribuídas — que é justamente
// quando você precisa vê-la.
//
// Status não entra: etapa concluída também é sua, e some da lista quem escolhe
// o estado no filtro ao lado, não este botão.
const etapaDaPessoa = (etapa, userId) => !!userId && etapa.tasks.some(t =>
  taskMembers(t).includes(userId) || (t.checklist || []).some(i => i.assigneeId === userId))

export function ProjectStages({ project, tasks, users, sessions, currentUserId, now, canEdit = true, isAdmin = false, focusId,
                               onAssignChecklist, onSetChecklistState, onEditChecklistItem, onExcluirChecklistItem,
                               onMoveTask, onNewStageItem, onNewStage, onCreateStages,
                               onEditTask, onDeleteTask, onDeleteStages, onStartTimer, onStopTimer }) {
  const doProjeto = React.useMemo(() => tasks.filter(t => t.projectId === project.id), [tasks, project.id])
  const { etapas, avulsas } = React.useMemo(() => agruparEtapas(doProjeto), [doProjeto])

  // Task apontada pela notificação ('task-<id>'). Os ids são strings (genId do
  // servidor), então só o prefixo sai. A etapa dela precisa nascer aberta — e
  // o bloco de avulsas também — senão o pai não acha o elemento para rolar e
  // destacar; o pai remonta este componente a cada clique em notificação.
  const focoId = String(focusId || '').replace(/^task-/, '') || null
  const etapaFoco = focoId ? etapas.find(e => e.tasks.some(t => t.id === focoId)) : null

  const [filtro, setFiltro] = React.useState('all')
  // Seleção em massa: a lista só ganha caixas quando o modo está ligado. Caixas
  // permanentes numa lista de onze etapas competem com o clique que abre cada
  // uma, que é o gesto de sempre.
  const [selecionando, setSelecionando] = React.useState(false)
  const [selecionadas, setSelecionadas] = React.useState([])
  const [somenteMinhas, setSomenteMinhas] = React.useState(false)
  // Abre sozinhas as etapas em andamento — é onde o trabalho está agora — e a
  // da notificação, quando há uma.
  // Reaproveita o `etapas` do useMemo acima — o inicializador do useState
  // refazia o agrupamento inteiro por conta própria, calculando duas vezes a
  // mesma coisa na montagem.
  const [abertas, setAbertas] = React.useState(
    () => new Set([...etapas.filter(e => e.status === 'progress').map(e => e.n), ...(etapaFoco ? [etapaFoco.n] : [])])
  )
  const alternar = (n) => setAbertas(prev => {
    const s = new Set(prev)
    s.has(n) ? s.delete(n) : s.add(n)
    return s
  })

  const contagem = contarPorStatus(etapas)
  // A legenda tem três linhas porque o progresso tem três fatias. Revisão e
  // diligência entram em "em andamento" — é onde o cálculo as põe, e separá-las
  // aqui faria a soma das linhas não bater com o total de etapas.
  contagem.andamento = contagem.progress + contagem.review + contagem.diligence
  const itens = checklistDaEtapa(doProjeto)

  // Mesmo cálculo do Panorama (src/data/progresso.js), sobre a MESMA lista de
  // atividades: toda atividade pesa 100/N, concluída entra inteira e as demais
  // entram com a fração do checklist já marcada. Antes saía daqui um
  // `done / total` — contagem seca de etapas fechadas, que ignorava tudo já
  // marcado dentro de uma etapa em curso e dava, para o mesmo projeto, um
  // número sempre menor que o da primeira aba.
  const prog = React.useMemo(() => calcularProgresso(doProjeto), [doProjeto])
  const pctExecutado = Math.round(prog.executado)
  // Hachurado: o que ainda falta marcar nas atividades em andamento. A parte
  // já marcada delas está no sólido, então desenhar a fatia inteira contaria
  // duas vezes o mesmo trabalho.
  const pctEmCurso = prog.detalhes.reduce(
    (a, d) => a + (d.fatia === 'emAndamento' ? d.peso - d.executado : 0), 0)
  // O recorte pessoal vem ANTES do estado: "minhas em andamento" é a pergunta
  // que se faz, e a contagem do menu tem de bater com o que a lista mostra.
  // A legenda do progresso continua sobre o projeto inteiro (contagem, acima):
  // ela responde pelo projeto, não por quem está olhando.
  const minhas = React.useMemo(
    () => etapas.filter(e => etapaDaPessoa(e, currentUserId)), [etapas, currentUserId])
  const base = somenteMinhas ? minhas : etapas
  const contagemFiltro = contarPorStatus(base)
  const visiveis = filtro === 'all' ? base : base.filter(e => e.status === filtro)

  // Uma etapa duplicada são várias linhas de tarefa com o mesmo número; excluir
  // a etapa leva todas, senão a duplicata sobreviveria à exclusão.
  const idsDaEtapa = (e) => e.tasks.map(t => t.id)
  const marcada = (e) => selecionadas.includes(e.n)
  const alternarSelecao = (e) => setSelecionadas(sel =>
    sel.includes(e.n) ? sel.filter(n => n !== e.n) : [...sel, e.n])

  const sairDaSelecao = () => { setSelecionando(false); setSelecionadas([]) }
  const escolhidas = visiveis.filter(marcada)
  const excluirSelecionadas = () => {
    if (!escolhidas.length) return
    onDeleteStages(escolhidas, sairDaSelecao)
  }

  const semEtapas = etapas.length === 0
  const repasse = { users, sessions, currentUserId, now, canEdit, onAssignChecklist, onSetChecklistState, onEditChecklistItem, onExcluirChecklistItem, onMoveTask, onEditTask, onDeleteTask, onStartTimer, onStopTimer }

  // O que está fora do template numerado. Com etapas na tela é o apêndice da
  // lista, fechado. Sem template, é tudo o que o projeto tem — e ficava
  // escondido atrás do aviso de "nenhuma etapa", que saía sozinho e dava a
  // impressão de projeto vazio mesmo com atividades cadastradas. Aqui ele
  // aparece nos dois casos, já aberto quando é o único conteúdo ou quando a
  // notificação clicada aponta para uma atividade daqui.
  const blocoAvulsas = avulsas.length > 0 && (
    <details className="et-avulsas" open={semEtapas || avulsas.some(t => t.id === focoId)}>
      <summary>
        <Icon name="chevronRight" size={14} className="et-seta" />
        {semEtapas
          ? `Atividades deste projeto (${avulsas.length})`
          : `Outras atividades (${avulsas.length}) — fora do template de etapas`}
      </summary>
      <div className="et-avulsas-corpo">
        {avulsas.map(t => (
          <CorpoDaTask key={t.id} task={t} mostrarTitulo avulsa {...repasse} />
        ))}
      </div>
    </details>
  )

  // 29 dos 36 projetos não tinham etapa nenhuma, e a equipe vinha recriando as
  // 11 à mão — foi assim que surgiram as duplicatas. O botão cria de uma vez.
  //
  // Só para a coordenação, porque só ela pode: a rota é adminOnly. Oferecer o
  // botão a quem o servidor vai recusar é pior que não oferecer nada — a pessoa
  // clica, espera, recebe um erro e continua sem saber de quem cobrar. O aviso
  // diz quem cria, que é a informação que ela precisa.
  if (semEtapas) {
    return (
      <div className="proj-etapas">
        {isAdmin ? (
          <EmptyState icon="list" title="Nenhuma etapa cadastrada"
            text={'As 11 etapas do processo — de Contratação direta até Licitação — ainda não existem neste projeto.'
              + (avulsas.length ? ' As atividades já cadastradas estão logo abaixo.' : '')}
            action={
              <div className="et-nova">
                <BotaoCriarTemplate projectId={project.id} onCreateStages={onCreateStages} />
                <button className="btn btn-ghost" onClick={() => onNewStage(project.id)}>Criar etapa</button>
              </div>
            } />
        ) : (
          <EmptyState icon="list" title="Nenhuma etapa criada pela coordenação"
            text={'As 11 etapas do processo — de Contratação direta até Licitação — são cadastradas pela coordenação. Enquanto isso não acontece, esta aba fica sem o acompanhamento por etapa.'
              + (avulsas.length ? ' As atividades já cadastradas estão logo abaixo.' : '')} />
        )}
        {blocoAvulsas}
      </div>
    )
  }

  return (
    <div className="proj-etapas">
      <div className="card et-resumo">
        <div className="et-resumo-topo">
          <div>
            <span className="et-resumo-lab">Progresso do projeto</span>
            <div className="et-resumo-sub">
              <b>{contagem.done} de {etapas.length}</b> etapas
              {itens.total > 0 && <> · <b>{itens.done} de {itens.total}</b> itens</>}
            </div>
          </div>
          <span className="et-resumo-pct">{pctExecutado}%</span>
        </div>
        {/* Sólido é o executado: etapa concluída inteira + a parte marcada das
            demais. Hachurado é o que falta marcar nas que já começaram. */}
        <div className="et-barra">
          <i className="feito" style={{ width: pctExecutado + '%' }} />
          <i className="curso" style={{ width: pctEmCurso + '%' }} />
        </div>
        <div className="et-legenda">
          <span><i className="sw feito" />{contagem.done} concluídas — contam inteiras</span>
          <span><i className="sw curso" />{contagem.andamento} em andamento — contam pelo checklist marcado</span>
          <span><i className="sw falta" />{contagem.todo} pendentes</span>
        </div>
      </div>

      {selecionando && (
        <div className="et-selecao">
          <span>
            {escolhidas.length
              ? <><strong>{escolhidas.length}</strong> etapa{escolhidas.length === 1 ? '' : 's'} selecionada{escolhidas.length === 1 ? '' : 's'}</>
              : 'Marque as etapas que devem ser excluídas.'}
          </span>
          <div className="et-selecao-acoes">
            <button type="button" className="btn btn-ghost btn-sm" onClick={sairDaSelecao}>Cancelar</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={excluirSelecionadas}
              disabled={!escolhidas.length}>
              <Icon name="trash" size={15} />Excluir selecionadas
            </button>
          </div>
        </div>
      )}

      <div className="et-barra-acoes">
        <FiltroEstado valor={filtro} contagem={contagemFiltro} onEscolher={setFiltro} />

        <button type="button" aria-pressed={somenteMinhas}
          className={'chip' + (somenteMinhas ? ' active' : '')}
          onClick={() => setSomenteMinhas(v => !v)}
          title="Mostra só as etapas que têm atividade sua">
          <Icon name="user" size={14} />Minhas atividades ({minhas.length})
        </button>
        {/* O modo de seleção só serve para excluir, então o nome diz o que ele
            faz e não o gesto que ele pede: quem quer apagar três etapas de uma
            vez procura "excluir", não "selecionar". */}
        {canEdit && !selecionando && (
          <button type="button" className="btn btn-ghost btn-sm et-excluir-varias"
            onClick={() => setSelecionando(true)}>
            <Icon name="trash" size={15} />Excluir etapas
          </button>
        )}
        {canEdit && (
          <div className="et-nova">
            {/* "Nova atividade" agora pergunta a ETAPA e o trabalho entra como
                item do checklist dela. Antes criava texto livre, que não batia
                o padrão "N · Nome" e nascia direto em "Outras atividades". */}
            <button className="btn btn-primary btn-sm" onClick={() => onNewStageItem(project.id)}>
              <Icon name="plus" size={16} stroke={2.2} />Nova atividade
            </button>
            {/* Cria uma etapa do template. A caixa no topo do modal é que troca
                para atividade avulsa — o caminho existe, mas deixou de ser o
                rótulo do botão: etapa é o que se cria aqui todo dia. */}
            <button className="btn btn-ghost btn-sm" onClick={() => onNewStage(project.id)}
              title="Cria uma etapa do processo neste projeto">
              <Icon name="flag" size={15} />Criar etapa
            </button>
          </div>
        )}
      </div>

      {visiveis.length === 0 ? (
        <p className="et-vazio-filtro">
          {somenteMinhas && !minhas.length
            ? 'Você não tem atividade nenhuma neste projeto.'
            : somenteMinhas
              ? 'Nenhuma etapa sua neste estado.'
              : 'Nenhuma etapa neste estado.'}
        </p>
      ) : (
        <ol className="et-lista">
          {visiveis.map(e => (
            <Etapa key={e.n} etapa={e} aberta={abertas.has(e.n)} onToggleAberta={() => alternar(e.n)}
              selecionando={selecionando} selecionada={marcada(e)} onSelecionar={alternarSelecao}
              onExcluirEtapa={onDeleteStages ? (etapa) => onDeleteStages([etapa]) : undefined}
              {...repasse} />
          ))}
        </ol>
      )}

      {blocoAvulsas}
    </div>
  )
}
