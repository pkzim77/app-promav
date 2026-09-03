import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { AvatarStack, StatusTag, PriorityTag, ProgressBar } from '../../../components/primitives/primitives.jsx'
import { TaskTimerButton } from '../../../components/TimeTracker/TimeTracker.jsx'
import { PROJECT_COLORS, projectProgress, taskProgress, checklistStats, taskMembers, fmtShort, fmtMed, canPublishProjectChange } from '../../../data/store.js'
import { EmptyState } from '../shared/EmptyState.jsx'
import { ProjectCover } from './ProjectCover.jsx'
import { ProjectTechSheet } from './ProjectTechSheet.jsx'
import { ProjectChanges } from './ProjectChanges.jsx'

function TaskRow({ task, members, sessions, currentUserId, now, canEdit, onStartTimer, onStopTimer, onEdit, onDelete }) {
  const resp = members[0]
  return (
    <tr id={'task-' + task.id} className='task-row-clickable' onClick={() => onEdit(task)}>
      <td style={{ width: '28%' }}><button className="task-title task-title-btn" onClick={() => onEdit(task)}>{task.title}</button></td>
      <td><StatusTag status={task.status} /></td>
      <td><PriorityTag priority={task.priority} /></td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AvatarStack users={members} size={24} max={4} />
          <span style={{ fontSize: 13 }}>{resp ? resp.name.split(' ')[0] : '—'}{members.length > 1 ? ` +${members.length - 1}` : ''}</span>
        </div>
      </td>
      <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--fg-3)' }}>{fmtShort(task.start)}–{fmtShort(task.end)}</span></td>
      <td style={{ width: 120 }}>
        {task.checklist && task.checklist.length
          ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="progress" style={{ width: 56 }}><div style={{ width: taskProgress(task) + '%', background: taskProgress(task) === 100 ? 'var(--success)' : 'var(--brand)' }} /></div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)' }}>{checklistStats(task).done}/{checklistStats(task).total}</span>
            </div>
          : <span style={{ fontSize: 12.5, color: 'var(--fg-4)' }}>—</span>}
      </td>
      <td style={{ width: 96 }}>
        <TaskTimerButton task={task} sessions={sessions} currentUserId={currentUserId} now={now} onStart={onStartTimer} onStop={onStopTimer} />
      </td>
      <td style={{ width: 70 }}>
        <div className="row-actions">
          <button className="btn-icon" onClick={() => onEdit(task)} aria-label={canEdit ? 'Editar' : 'Ver'}><Icon name={canEdit ? 'pencil' : 'externalLink'} size={15} /></button>
          {canEdit && <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onDelete(task) }} aria-label="Excluir"><Icon name="trash" size={15} /></button>}
        </div>
      </td>
    </tr>
  )
}

export function ProjectDetail({ project, tasks, users, sessions, changes = [], currentUserId, now, canEdit = true, role, initialTab, focusId, focusNonce, onStartTimer, onStopTimer, onBack, onEdit, onNewTask, onEditTask, onDeleteTask, onCopyResource, onDeleteResource, onAddResource, onNewChange, onEditChange, onAckChange, onDecideChange }) {
  // O Panorama abre primeiro: é o que se mostra numa reunião com o cliente.
  // Uma notificação clicada entra com a aba já escolhida em 'initialTab'.
  const [tab, setTab] = React.useState(initialTab || 'panorama') // 'panorama' | 'tecnica' | 'atividades' | 'mudancas'

  // Vindo de uma notificação: troca a aba. O 'focusNonce' entra nas dependências
  // para funcionar também quando a mesma notificação é clicada de novo depois
  // de o usuário ter mudado de aba na mão.
  React.useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab, focusNonce])

  // Rola até o item da notificação e o destaca por alguns segundos. Depende de
  // 'tab' porque o elemento só existe depois que a aba certa renderiza.
  React.useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(focusId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('is-focused')
    const t = setTimeout(() => el.classList.remove('is-focused'), 2800)
    return () => { clearTimeout(t); el.classList.remove('is-focused') }
  }, [focusId, focusNonce, tab])

  const cienciasPendentes = changes
    .filter(c => c.projectId === project.id)
    .reduce((total, c) => total + (c.acks || []).some(a => a.userId === currentUserId && !a.confirmedAt), 0)
  const list = tasks.filter(t => t.projectId === project.id)
  const pct = projectProgress(tasks, project.id)
  const color = PROJECT_COLORS[project.color]
  const canPublish = canPublishProjectChange(role)
  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 16, marginLeft: -8 }}>
        <Icon name="chevronLeft" size={16} />Projetos
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
        <span style={{ width: 46, height: 46, borderRadius: 'var(--r-lg)', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ font: 'var(--text-h1)', margin: 0, letterSpacing: 'var(--tracking-tight)', overflowWrap: 'anywhere' }}>{project.name}</h1>
          <p style={{ fontSize: 14, color: 'var(--fg-3)', margin: '5px 0 0' }}>{project.desc}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-3)', marginTop: 10 }}>
            <Icon name="calendar" size={15} />{fmtMed(project.start)} — {fmtMed(project.end)}
          </div>
        </div>
        {canEdit && <button className="btn btn-secondary" onClick={() => onEdit(project)}><Icon name="pencil" size={16} />Editar</button>}
        {canEdit && <button className="btn btn-primary" onClick={() => onNewTask(project.id)}><Icon name="plus" size={17} stroke={2.2} />Nova atividade</button>}
      </div>

      {/* Abas: Panorama (cliente) → Ficha técnica (equipe) → Atividades. */}
      <div className="proj-tabs">
        <button className={'proj-tab' + (tab === 'panorama' ? ' on' : '')} onClick={() => setTab('panorama')}>
          <Icon name="landmark" size={15} />Panorama
        </button>
        <button className={'proj-tab' + (tab === 'tecnica' ? ' on' : '')} onClick={() => setTab('tecnica')}>
          <Icon name="file" size={15} />Ficha técnica
        </button>
        <button className={'proj-tab' + (tab === 'atividades' ? ' on' : '')} onClick={() => setTab('atividades')}>
          <Icon name="list" size={15} />Atividades
        </button>
        <button className={'proj-tab' + (tab === 'mudancas' ? ' on' : '')} onClick={() => setTab('mudancas')}>
          <Icon name="history" size={15} />Mudanças{cienciasPendentes > 0 && <span className="proj-tab-dot" />}
        </button>
      </div>

      {tab === 'panorama' ? (
        <ProjectCover project={project} tasks={tasks} users={users} />
      ) : tab === 'tecnica' ? (
        <ProjectTechSheet project={project} canEdit={canEdit}
          onCopyResource={onCopyResource} onDeleteResource={onDeleteResource} onAddResource={onAddResource} />
      ) : tab === 'mudancas' ? (
        <ProjectChanges project={project} changes={changes} tasks={tasks} users={users}
          currentUserId={currentUserId} canEdit={canEdit} canPublish={canPublish} onNew={onNewChange} onEdit={onEditChange}
          onAck={onAckChange} onDecide={onDecideChange} onOpenTask={onEditTask} />
      ) : (
      <>
      <div className="card" style={{ padding: 18, marginBottom: 22, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>Progresso do projeto</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: 'var(--fg-1)' }}>{pct}%</span>
          </div>
          <ProgressBar value={pct} color={color} />
        </div>
        <div style={{ display: 'flex', gap: 24, paddingLeft: 20, borderLeft: '1px solid var(--border)' }}>
          {['todo','progress','done'].map(s => (
            <div key={s} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)' }}>{list.filter(t => t.status === s).length}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>{{ todo: 'A fazer', progress: 'Em and.', done: 'Concluído' }[s]}</div>
            </div>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState icon="list" title="Nenhuma atividade por aqui ainda"
          text="Crie a primeira atividade para começar a acompanhar o progresso deste projeto."
          action={canEdit ? <button className="btn btn-primary" onClick={() => onNewTask(project.id)}><Icon name="plus" size={17} stroke={2.2} />Adicionar atividade</button> : null} />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tasktable">
            <thead><tr><th>Atividade</th><th>Status</th><th>Prioridade</th><th>Responsável</th><th>Datas</th><th>Checklist</th><th>Tempo</th><th></th></tr></thead>
            <tbody>
              {list.map(t => <TaskRow key={t.id} task={t} members={taskMembers(t).map(id => users.find(u => u.id === id))} sessions={sessions} currentUserId={currentUserId} now={now} canEdit={canEdit} onStartTimer={onStartTimer} onStopTimer={onStopTimer} onEdit={onEditTask} onDelete={onDeleteTask} />)}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  )
}
