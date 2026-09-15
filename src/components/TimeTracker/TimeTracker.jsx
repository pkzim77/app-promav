import './TimeTracker.css'
import React from 'react'
import { Icon } from '../Icon.jsx'
import { PROJECT_COLORS } from '../../data/store.js'
// Cronômetro por atividade — cada sessão é vinculada a uma tarefa (taskId).

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}
export function fmtDur(ms) {
  const min = Math.round(ms / 60000)
  if (min < 1) return '0min'
  const h = Math.floor(min / 60), m = min % 60
  if (h && m) return `${h}h ${m}min`
  if (h) return `${h}h`
  return `${m}min`
}
export function fmtHM(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
export function sameDay(a, b) { const x = new Date(a), y = new Date(b); return x.toDateString() === y.toDateString() }

// total de tempo (ms) numa atividade, para um usuário (ou todos se userId omitido)
export function taskTimeFor(sessions, taskId, userId, now) {
  return sessions
    .filter(s => s.taskId === taskId && (!userId || s.userId === userId))
    .reduce((sum, s) => sum + ((s.end || now) - s.start), 0)
}
export function activeSessionFor(sessions, userId) {
  return sessions.find(s => s.userId === userId && !s.end) || null
}

// Botão play/parar reutilizável, embutido em cards e linhas de tabela.
export function TaskTimerButton({ task, sessions, currentUserId, now, onStart, onStop, compact }) {
  const active = sessions.find(s => s.taskId === task.id && s.userId === currentUserId && !s.end)
  const total = taskTimeFor(sessions, task.id, currentUserId, now)
  if (active) {
    return (
      <button className="timerbtn running" onClick={(e) => { e.stopPropagation(); onStop() }} title="Parar cronômetro">
        <Icon name="stop" size={13} /><span className="t">{fmtClock(now - active.start)}</span>
      </button>
    )
  }
  return (
    <button className="timerbtn" onClick={(e) => { e.stopPropagation(); onStart(task.id) }} title="Iniciar cronômetro nesta atividade">
      <Icon name="play" size={13} stroke={2.4} />{total > 0 && !compact && <span className="t">{fmtDur(total)}</span>}
    </button>
  )
}

export function TimeClock({ currentUser, tasks, projects, sessions, now, onStart, onStop }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const mine = sessions.filter(s => s.userId === currentUser.id)
  const active = activeSessionFor(sessions, currentUser.id)
  const activeTask = active ? tasks.find(t => t.id === active.taskId) : null
  const projOf = (id) => projects.find(p => p.id === id)
  const todays = mine.filter(s => sameDay(s.start, now))
  const todayTotal = todays.reduce((sum, s) => sum + ((s.end || now) - s.start), 0)

  // tempo de hoje agrupado por atividade
  const byTask = {}
  todays.forEach(s => { byTask[s.taskId] = (byTask[s.taskId] || 0) + ((s.end || now) - s.start) })
  const todayTasks = Object.keys(byTask).map(tid => ({ task: tasks.find(t => t.id === tid), ms: byTask[tid] }))
    .filter(x => x.task).sort((a, b) => b.ms - a.ms)

  // atividades do usuário disponíveis para iniciar (responsável ou membro, não concluídas)
  const myTasks = tasks.filter(t => (t.assigneeId === currentUser.id || (t.memberIds || []).includes(currentUser.id)) && t.status !== 'done')

  return (
    <div className="userselect" ref={ref}>
      <button className={'ponto-pill' + (active ? ' on' : '')} onClick={() => setOpen(o => !o)} title="Cronômetro por atividade">
        {/* Parado, o rótulo só mostra o total de hoje a partir de um minuto:
            abaixo disso o fmtDur arredonda para "0min", que lê como defeito. */}
        {active
          ? <><span className="ponto-dot" /><span className="ponto-time">{fmtClock(now - active.start)}</span></>
          : <><Icon name="timer" size={17} /><span className="ponto-today">{todayTotal >= 60000 ? fmtDur(todayTotal) : 'Cronômetro'}</span></>}
      </button>
      {open && (
        <div className="menu ponto-pop">
          {active ? (
            <div className="ponto-head running">
              <div style={{ minWidth: 0 }}>
                <div className="ponto-head-label">Cronometrando agora</div>
                <div className="ponto-head-task">
                  <span className="dot" style={{ background: PROJECT_COLORS[projOf(activeTask?.projectId)?.color] || 'var(--fg-4)' }} />
                  {activeTask ? activeTask.title : 'Atividade'}
                </div>
                <div className="ponto-head-time live">{fmtClock(now - active.start)}</div>
              </div>
              <button className="btn btn-danger" onClick={onStop}><Icon name="stop" size={16} />Parar</button>
            </div>
          ) : (
            <div className="ponto-head">
              <div>
                <div className="ponto-head-label">Cronômetro parado</div>
                <div className="ponto-head-time">{fmtDur(todayTotal)}</div>
                <div className="ponto-since">registrado hoje</div>
              </div>
            </div>
          )}

          <div className="menu-label">Iniciar nas minhas atividades</div>
          <div className="ponto-list">
            {myTasks.length === 0 && <div className="ponto-empty">Você não tem atividades em aberto. Escolha uma atividade em Projetos ou no Kanban.</div>}
            {myTasks.map(t => {
              const isActive = active && active.taskId === t.id
              const total = taskTimeFor(sessions, t.id, currentUser.id, now)
              return (
                <button key={t.id} className={'ponto-task' + (isActive ? ' on' : '')} onClick={() => isActive ? onStop() : onStart(t.id)}>
                  <span className="dot" style={{ background: PROJECT_COLORS[projOf(t.projectId)?.color] }} />
                  <span className="ponto-task-title">{t.title}</span>
                  {total > 0 && <span className="ponto-task-total">{fmtDur(total)}</span>}
                  <span className={'timerbtn' + (isActive ? ' running' : '')}>
                    <Icon name={isActive ? 'stop' : 'play'} size={13} stroke={2.4} />
                  </span>
                </button>
              )
            })}
          </div>

          {todayTasks.length > 0 && (
            <>
              <div className="menu-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="history" size={13} />Tempo de hoje por atividade</div>
              <div className="ponto-list">
                {todayTasks.map(({ task, ms }) => (
                  <div className="ponto-row" key={task.id}>
                    <span className="dot" style={{ width: 8, height: 8, borderRadius: 50, background: PROJECT_COLORS[projOf(task.projectId)?.color] }} />
                    <span className="ponto-range" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                    <span className="ponto-dur">{fmtDur(ms)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
