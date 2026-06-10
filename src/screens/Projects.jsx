import React from 'react'
import { Icon } from '../components/Icon.jsx'
import { AvatarStack, StatusTag, PriorityTag, ProgressBar } from '../components/primitives.jsx'
import { TaskTimerButton } from '../components/TimeTracker.jsx'
import { PROJECT_COLORS, projectProgress, taskProgress, checklistStats, taskMembers, fmtShort, fmtMed } from '../data/store.js'
// Projetos — grid of project cards, and a project detail view with task table.

function ProjectGridCard({ project, tasks, onOpen, onEdit, onDelete }) {
  const pct = projectProgress(tasks, project.id)
  const count = tasks.filter(t => t.projectId === project.id).length
  const color = PROJECT_COLORS[project.color]
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: 'var(--r-md)', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <button onClick={() => onOpen(project.id)} style={{ font: 'var(--text-h4)', color: 'var(--fg-1)', textAlign: 'left', padding: 0 }}>{project.name}</button>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: '3px 0 0', lineHeight: 1.45 }}>{project.desc}</p>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="btn-icon" onClick={() => onEdit(project)} aria-label="Editar"><Icon name="pencil" size={16} /></button>
          <button className="btn-icon" onClick={() => onDelete(project)} aria-label="Excluir"><Icon name="trash" size={16} /></button>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg-3)', marginBottom: 14 }}>
        <Icon name="calendar" size={14} />{fmtShort(project.start)} — {fmtShort(project.end)}
      </div>
      <div style={{ marginTop: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{count} atividades</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--fg-2)' }}>{pct}%</span>
        </div>
        <ProgressBar value={pct} color={color} />
      </div>
    </div>
  )
}

export function ProjectList({ projects, tasks, onOpen, onEdit, onDelete, onNew }) {
  return (
    <div className="page">
      <div className="sec-head">
        <div>
          <h2>Projetos</h2>
          <div className="sub">{projects.length} projetos · {tasks.length} atividades no total</div>
        </div>
        <button className="btn btn-primary" onClick={onNew}><Icon name="plus" size={17} stroke={2.2} />Novo projeto</button>
      </div>
      {projects.length === 0 ? (
        <EmptyState icon="folder" title="Nenhum projeto ainda"
          text="Crie seu primeiro projeto para começar a organizar atividades, prazos e responsáveis."
          action={<button className="btn btn-primary" onClick={onNew}><Icon name="plus" size={17} stroke={2.2} />Criar projeto</button>} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(264px, 1fr))', gap: 16 }}>
          {projects.map(p => <ProjectGridCard key={p.id} project={p} tasks={tasks} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />)}
        </div>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="card empty">
      <div className="ic"><Icon name={icon} size={26} stroke={1.9} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

function TaskRow({ task, members, sessions, currentUserId, now, onStartTimer, onStopTimer, onEdit, onDelete }) {
  const resp = members[0]
  return (
    <tr>
      <td style={{ width: '28%' }}><span className="task-title">{task.title}</span></td>
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
          <button className="btn-icon" onClick={() => onEdit(task)} aria-label="Editar"><Icon name="pencil" size={15} /></button>
          <button className="btn-icon" onClick={() => onDelete(task)} aria-label="Excluir"><Icon name="trash" size={15} /></button>
        </div>
      </td>
    </tr>
  )
}

export function ProjectDetail({ project, tasks, users, sessions, currentUserId, now, onStartTimer, onStopTimer, onBack, onEdit, onNewTask, onEditTask, onDeleteTask }) {
  const list = tasks.filter(t => t.projectId === project.id)
  const pct = projectProgress(tasks, project.id)
  const color = PROJECT_COLORS[project.color]
  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 16, marginLeft: -8 }}>
        <Icon name="chevronLeft" size={16} />Projetos
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
        <span style={{ width: 46, height: 46, borderRadius: 'var(--r-lg)', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <h1 style={{ font: 'var(--text-h1)', margin: 0, letterSpacing: 'var(--tracking-tight)' }}>{project.name}</h1>
          <p style={{ fontSize: 14, color: 'var(--fg-3)', margin: '5px 0 0' }}>{project.desc}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-3)', marginTop: 10 }}>
            <Icon name="calendar" size={15} />{fmtMed(project.start)} — {fmtMed(project.end)}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => onEdit(project)}><Icon name="pencil" size={16} />Editar</button>
        <button className="btn btn-primary" onClick={() => onNewTask(project.id)}><Icon name="plus" size={17} stroke={2.2} />Nova atividade</button>
      </div>

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
          action={<button className="btn btn-primary" onClick={() => onNewTask(project.id)}><Icon name="plus" size={17} stroke={2.2} />Adicionar atividade</button>} />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tasktable">
            <thead><tr><th>Atividade</th><th>Status</th><th>Prioridade</th><th>Responsável</th><th>Datas</th><th>Checklist</th><th>Tempo</th><th></th></tr></thead>
            <tbody>
              {list.map(t => <TaskRow key={t.id} task={t} members={taskMembers(t).map(id => users.find(u => u.id === id))} sessions={sessions} currentUserId={currentUserId} now={now} onStartTimer={onStartTimer} onStopTimer={onStopTimer} onEdit={onEditTask} onDelete={onDeleteTask} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
