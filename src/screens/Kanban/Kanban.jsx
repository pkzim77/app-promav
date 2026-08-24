import './Kanban.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { AvatarStack, PriorityTag, ChecklistMini } from '../../components/primitives/primitives.jsx'
import { TaskTimerButton } from '../../components/TimeTracker/TimeTracker.jsx'
import { STATUSES, PROJECT_COLORS, taskMembers, fmtShort, effectiveProjectRole, canEditProject } from '../../data/store.js'
// Kanban — columns by status, cross-project cards, drag & drop, filters.

function KanbanCard({ task, project, users, sessions, currentUserId, now, onStartTimer, onStopTimer, onDragStart, onDragEnd, dragging, onClick }) {
  const members = taskMembers(task).map(id => users.find(u => u.id === id))
  return (
    <div
      className={'kcard' + (dragging ? ' dragging' : '')}
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(task)}
      style={{ borderLeftColor: PROJECT_COLORS[project.color] }}>
      <div className="kc-proj" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="proj-pill" style={{ fontSize: 12 }}>
          <span className="dot" style={{ background: PROJECT_COLORS[project.color] }} />{project.name}
        </span>
        <TaskTimerButton task={task} sessions={sessions} currentUserId={currentUserId} now={now} onStart={onStartTimer} onStop={onStopTimer} />
      </div>
      <p className="kc-title">{task.title}</p>
      <div className="kc-foot">
        <PriorityTag priority={task.priority} />
        <div className="right">
          <ChecklistMini task={task} />
          <span className="kc-date">{fmtShort(task.start)}–{fmtShort(task.end)}</span>
          <AvatarStack users={members} size={24} max={3} />
        </div>
      </div>
    </div>
  )
}

export function Kanban({ tasks, projects, users, authUser, filterProject, mine, currentUserId, onFilterProject, onToggleMine, onMoveTask, onNewTask, onEditTask, sessions, now, onStartTimer, onStopTimer }) {
  const [draggingId, setDraggingId] = React.useState(null)
  const [overCol, setOverCol] = React.useState(null)

  const projOf = (id) => projects.find(p => p.id === id)
  // Pode criar atividade no contexto atual? (no projeto filtrado, ou em algum se "Todos").
  const canCreate = filterProject
    ? canEditProject(effectiveProjectRole(projOf(filterProject), authUser))
    : projects.some(p => canEditProject(effectiveProjectRole(p, authUser)))
  const createProjectId = filterProject || projects.find(p => canEditProject(effectiveProjectRole(p, authUser)))?.id || null

  let visible = tasks
  if (filterProject) visible = visible.filter(t => t.projectId === filterProject)
  if (mine) visible = visible.filter(t => t.assigneeId === currentUserId)

  const onDragStart = (e, id) => { setDraggingId(id); e.dataTransfer.effectAllowed = 'move' }
  const onDragEnd = () => { setDraggingId(null); setOverCol(null) }
  const onDrop = (e, status) => {
    e.preventDefault()
    if (draggingId) onMoveTask(draggingId, status)
    setDraggingId(null); setOverCol(null)
  }

  return (
    <div className="page">
      <div className="sec-head">
        <div><h2>Kanban</h2><div className="sub">Arraste os cards entre as colunas para mudar o status.</div></div>
        {canCreate && <button className="btn btn-primary" onClick={() => onNewTask(createProjectId)}><Icon name="plus" size={17} stroke={2.2} />Nova atividade</button>}
      </div>
      <div className="filterbar">
          <select className="filter-select" value={filterProject || ''} aria-label="Filtrar por projeto"
            onChange={(e) => onFilterProject(e.target.value || null)}>
            <option value="">Todos os projetos</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
          <button className={'chip' + (mine ? ' active' : '')} onClick={onToggleMine}>
            <Icon name="inbox" size={15} />Minhas tarefas
          </button>
        </div>

      <div className="board">
        {STATUSES.map(col => {
          const colTasks = visible.filter(t => t.status === col.id)
          return (
            <div
              key={col.id}
              className={'column' + (overCol === col.id ? ' dragover' : '')}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.id) }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null) }}
              onDrop={(e) => onDrop(e, col.id)}>
              <div className="col-head">
                <span className="dot" style={{ background: col.color }} />
                <span className="name">{col.label}</span>
                <span className="count">{colTasks.length}</span>
              </div>
              {colTasks.map(t => (
                <KanbanCard key={t.id} task={t} project={projOf(t.projectId)} users={users}
                  sessions={sessions} currentUserId={currentUserId} now={now} onStartTimer={onStartTimer} onStopTimer={onStopTimer}
                  onDragStart={onDragStart} onDragEnd={onDragEnd} dragging={draggingId === t.id} onClick={onEditTask} />
              ))}
              {colTasks.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--fg-4)', textAlign: 'center', padding: '18px 0' }}>Nenhuma atividade</div>
              )}
              {canCreate && (
                <button className="col-add" onClick={() => onNewTask(createProjectId, col.id)}>
                  <Icon name="plus" size={15} stroke={2.2} />Adicionar
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
