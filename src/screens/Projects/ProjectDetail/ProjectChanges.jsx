import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { fmtFull, CHANGE_KIND_MAP, URGENCY_MAP, ladoDaMudanca } from '../../../data/store.js'
import { EmptyState } from '../shared/EmptyState.jsx'
import { NotesText } from '../shared/NotesText.jsx'

const DIAS_PARA_COBRAR_CIENCIA = 2
const haQuantoTempo = (ms) => {
  const dias = Math.floor((Date.now() - ms) / 86400000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `há ${dias} dias`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`
  const anos = Math.floor(meses / 12)
  return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`
}
const cienciaAtrasada = (ack) => !ack.confirmedAt && (Date.now() - ack.sentAt) / 86400000 >= DIAS_PARA_COBRAR_CIENCIA

function Ciencia({ acks, users }) {
  if (!acks.length) return null
  return <div className="mud-ciencia">{acks.map(a => {
    const nome = users.find(u => u.id === a.userId)?.name || 'Alguém'
    const atrasada = cienciaAtrasada(a)
    return <span key={a.userId} className={'mud-ack' + (a.confirmedAt ? ' ok' : atrasada ? ' late' : '')}
      title={a.confirmedAt ? `Confirmou ${haQuantoTempo(a.confirmedAt)}` : `Avisado ${haQuantoTempo(a.sentAt)}`}>
      {a.confirmedAt && <Icon name="check" size={12} stroke={3} />}{nome}{a.confirmedAt ? '' : ' ainda não viu'}</span>
  })}</div>
}

function SelosDaMudanca({ change }) {
  const tipo = CHANGE_KIND_MAP[change.kind] || CHANGE_KIND_MAP.requisicao
  const urg = URGENCY_MAP[change.urgency] || URGENCY_MAP.medium
  return <>
    <span className={'mud-selo tipo-' + change.kind} title={tipo.hint}>{tipo.label}</span>
    {change.urgency !== 'medium' && <span className="mud-selo" style={{ color: urg.color, background: urg.color + '1a' }}>{urg.label}</span>}
    {change.affectsBudget && <span className="mud-selo"><Icon name="banknote" size={13} />Altera orçamento ou prazo</span>}
  </>
}

function LadoChip({ lado }) {
  if (!lado.tipo) return <span className="mud-lado vazio">—</span>
  return <span className="mud-lado">
    {lado.tipo === 'pessoa' && lado.user
      ? <span className="av" style={{ width: 22, height: 22, background: lado.user.color, fontSize: 9 }}>{lado.user.initials}</span>
      : <span className="mud-lado-ic"><Icon name="users" size={13} /></span>}
    {lado.nome}
  </span>
}

function DeParaMudanca({ change, users }) {
  const de = ladoDaMudanca({ userId: change.emitterUserId, sector: change.emitterSector }, users)
  const paras = [
    ...(change.targetSectors || (change.targetSector ? [change.targetSector] : [])).map(sector => ladoDaMudanca({ sector }, users)),
    ...(change.targetUserIds || []).map(id => ladoDaMudanca({ userId: id }, users)),
  ]
  return <div className="mud-depara"><span className="mud-depara-lab">De</span><LadoChip lado={de} />
    <Icon name="arrowRight" size={16} style={{ color: 'var(--fg-4)' }} /><span className="mud-depara-lab">Para</span>
    {paras.length ? paras.map((p, i) => <LadoChip lado={p} key={i} />) : <LadoChip lado={{ tipo: null }} />}</div>
}

const alvosDaMudanca = (change) => change.targetUserIds?.length ? change.targetUserIds : [change.responsibleId].filter(Boolean)
function ehDestinatario(change, user) {
  const setores = change.targetSectors || (change.targetSector ? [change.targetSector] : [])
  return !!user && (change.targetUserIds || []).includes(user.id) || !!user && setores.includes(user.sector) || !!user && !setores.length && alvosDaMudanca(change).includes(user.id)
}

function CartaoMudanca({ change, users, tasks, currentUser, canEdit, onEdit, onAck, onDecide, onOpenTask }) {
  const autor = users.find(u => u.id === change.publishedBy)
  const decisor = users.find(u => u.id === change.decidedBy)
  const tarefa = tasks.find(t => t.id === change.taskId)
  const minhaCiencia = change.acks.find(a => a.userId === currentUser?.id && !a.confirmedAt)
  const pendente = change.kind === 'sugestao' && !change.decision
  // O id é a âncora usada pelo clique na notificação (ver ProjectDetail).
  return <div id={'change-' + change.id} className={'card mud-card' + (pendente ? ' pendente' : '')}>
    <div className="mud-card-topo"><span className="mud-data">{fmtFull(change.changeDate)}</span><div className="mud-selos"><SelosDaMudanca change={change} /></div>
      {canEdit && <button className="btn-icon" onClick={() => onEdit(change)} aria-label="Editar mudança"><Icon name="pencil" size={16} /></button>}</div>
    <h3 className="mud-titulo">{change.title}</h3>
    <div className="mud-meta">{autor && <span>Registrada por {autor.name} {haQuantoTempo(change.publishedAt)}</span>}{change.editedAt && <span className="mud-editada">· editada {haQuantoTempo(change.editedAt)}</span>}</div>
    <DeParaMudanca change={change} users={users} /><NotesText text={change.description} />
    {change.requester && <p className="mud-origem"><strong>Solicitante:</strong> {change.requester}</p>}
    {pendente && <div className="mud-decisao pendente"><div><strong>Sugestão aguardando decisão</strong><p>{ehDestinatario(change, currentUser) ? 'Você é o destinatário. Aceitar cria a atividade no quadro; recusar exige um motivo.' : 'Aguardando o destinatário aceitar ou recusar.'}</p></div>
      {ehDestinatario(change, currentUser) && <div className="mud-decisao-acoes"><button className="btn btn-primary btn-sm" onClick={() => onDecide(change, true)}><Icon name="check" size={15} stroke={2.4} />Aceitar</button><button className="btn btn-secondary btn-sm" onClick={() => onDecide(change, false)}><Icon name="x" size={15} stroke={2.4} />Recusar</button></div>}</div>}
    {change.decision === 'aceita' && <div className="mud-decisao aceita"><strong>Sugestão aceita{decisor ? ` por ${decisor.name}` : ''}</strong></div>}
    {change.decision === 'recusada' && <div className="mud-decisao recusada"><strong>Sugestão recusada{decisor ? ` por ${decisor.name}` : ''}</strong><p>{change.decisionReason}</p></div>}
    {(minhaCiencia || tarefa) && <div className="mud-acoes">{minhaCiencia && <button className="btn btn-primary btn-sm" onClick={() => onAck(change)}><Icon name="check" size={15} stroke={2.4} />Confirmo que vi esta mudança</button>}{tarefa && <button className="btn btn-ghost btn-sm" onClick={() => onOpenTask(tarefa)}>Ver a atividade<Icon name="arrowRight" size={15} /></button>}</div>}
    <Ciencia acks={change.acks} users={users} />
  </div>
}

export function ProjectChanges({ project, changes, tasks, users, currentUserId, canEdit, canPublish, onNew, onEdit, onAck, onDecide, onOpenTask }) {
  const lista = changes.filter(c => c.projectId === project.id).sort((a, b) => b.publishedAt - a.publishedAt)
  const currentUser = users.find(u => u.id === currentUserId)
  if (!lista.length) return <EmptyState icon="history" title="Nenhuma mudança registrada" text="Registre aqui o que mudou no projeto. A equipe será avisada e uma requisição já vira atividade no quadro." action={canPublish ? <button className="btn btn-primary" onClick={() => onNew(project.id)}><Icon name="plus" size={17} stroke={2.2} />Registrar mudança</button> : null} />
  return <div className="proj-mudancas"><div className="mud-topo"><span className="mud-contagem">{lista.length} {lista.length === 1 ? 'mudança registrada' : 'mudanças registradas'}</span>{canPublish && <button className="btn btn-primary btn-sm" onClick={() => onNew(project.id)}><Icon name="plus" size={16} stroke={2.2} />Registrar mudança</button>}</div>
    {lista.map(c => <CartaoMudanca key={c.id} change={c} users={users} tasks={tasks} currentUser={currentUser} canEdit={canEdit} onEdit={onEdit} onAck={onAck} onDecide={onDecide} onOpenTask={onOpenTask} />)}</div>
}
