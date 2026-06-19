import React from 'react'
import { Icon } from '../components/Icon.jsx'
import { Avatar } from '../components/primitives.jsx'
import { PROJECT_COLORS } from '../data/store.js'
// Relatório da equipe — tempo gasto por pessoa em cada atividade, com filtro dia/semana/mês.

const MS_MIN = 60000
const MONTHS_FULL = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
const DAYS_FULL = ['domingo','segunda','terça','quarta','quinta','sexta','sábado']

function fmtH(ms) {
  const min = Math.round(ms / MS_MIN)
  if (min < 1) return '0min'
  const h = Math.floor(min / 60), m = min % 60
  if (h && m) return `${h}h ${m}min`
  if (h) return `${h}h`
  return `${m}min`
}
function startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime() }
function periodBounds(anchor, mode) {
  const d = new Date(anchor)
  if (mode === 'day') { const s = startOfDay(anchor); return [s, s + 86400000] }
  if (mode === 'week') {
    const dow = (d.getDay() + 6) % 7 // segunda = 0
    const s = startOfDay(anchor) - dow * 86400000
    return [s, s + 7 * 86400000]
  }
  // month
  const s = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  return [s, e]
}
function shift(anchor, mode, dir) {
  const d = new Date(anchor)
  if (mode === 'day') return anchor + dir * 86400000
  if (mode === 'week') return anchor + dir * 7 * 86400000
  return new Date(d.getFullYear(), d.getMonth() + dir, Math.min(d.getDate(), 28)).getTime()
}
function periodLabel(anchor, mode) {
  const [s, e] = periodBounds(anchor, mode)
  const sd = new Date(s), ed = new Date(e - 1)
  if (mode === 'day') {
    const isToday = startOfDay(Date.now()) === s
    return `${DAYS_FULL[sd.getDay()]}, ${sd.getDate()} de ${MONTHS_FULL[sd.getMonth()]}${isToday ? ' · hoje' : ''}`
  }
  if (mode === 'week') {
    const sameMonth = sd.getMonth() === ed.getMonth()
    return sameMonth
      ? `${sd.getDate()}–${ed.getDate()} de ${MONTHS_FULL[sd.getMonth()]}`
      : `${sd.getDate()} ${MONTHS_FULL[sd.getMonth()].slice(0,3)} – ${ed.getDate()} ${MONTHS_FULL[ed.getMonth()].slice(0,3)}`
  }
  return `${MONTHS_FULL[sd.getMonth()]} de ${sd.getFullYear()}`
}
// tempo (ms) de uma sessão dentro da janela [s,e)
function clip(sess, s, e, now) {
  const start = Math.max(sess.start, s)
  const end = Math.min(sess.end || now, e)
  return Math.max(0, end - start)
}

export function TeamReport({ users, tasks, projects, sessions, now }) {
  const [mode, setMode] = React.useState('week')
  const [anchor, setAnchor] = React.useState(Date.now())
  const [projFilter, setProjFilter] = React.useState(null)

  const taskOf = (id) => tasks.find(t => t.id === id)
  const projOf = (id) => projects.find(p => p.id === id)
  const [s, e] = periodBounds(anchor, mode)
  const atStart = mode === 'day' ? startOfDay(Date.now()) : periodBounds(Date.now(), mode)[0]
  const isCurrent = s === atStart

  // tempo por usuário e por atividade dentro do período
  const inPeriod = sessions.filter(ss => clip(ss, s, e, now) > 0 && (!projFilter || taskOf(ss.taskId)?.projectId === projFilter))
  const totalAll = inPeriod.reduce((sum, ss) => sum + clip(ss, s, e, now), 0)

  const perUser = users.map(u => {
    const us = inPeriod.filter(ss => ss.userId === u.id)
    const byTask = {}
    us.forEach(ss => { byTask[ss.taskId] = (byTask[ss.taskId] || 0) + clip(ss, s, e, now) })
    const rows = Object.keys(byTask).map(tid => ({ task: taskOf(tid), ms: byTask[tid] }))
      .filter(r => r.task).sort((a, b) => b.ms - a.ms)
    const total = rows.reduce((sum, r) => sum + r.ms, 0)
    return { user: u, rows, total }
  }).sort((a, b) => b.total - a.total)

  const maxUser = Math.max(1, ...perUser.map(p => p.total))

  return (
    <div className="page">
      <div className="sec-head">
        <div>
          <h2>Relatório da equipe</h2>
          <div className="sub">Quanto tempo cada pessoa dedicou a cada atividade.</div>
        </div>
        <div className="seg" style={{ background: 'var(--bg-muted)', padding: 3, borderRadius: 'var(--r-md)', display: 'inline-flex', gap: 2 }}>
          {[['day','Dia'],['week','Semana'],['month','Mês']].map(([m, lbl]) => (
            <button key={m} onClick={() => setMode(m)}
              style={{ padding: '7px 16px', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600,
                background: mode === m ? 'var(--surface)' : 'transparent', color: mode === m ? 'var(--fg-1)' : 'var(--fg-3)',
                boxShadow: mode === m ? 'var(--shadow-xs)' : 'none' }}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* navegador de período */}
      <div className="team-nav">
        <button className="btn-icon" onClick={() => setAnchor(a => shift(a, mode, -1))} aria-label="Anterior"><Icon name="chevronLeft" size={18} /></button>
        <span className="team-period">{periodLabel(anchor, mode)}</span>
        <button className="btn-icon" onClick={() => setAnchor(a => shift(a, mode, 1))} disabled={isCurrent} aria-label="Próximo"><Icon name="chevronRight" size={18} /></button>
        {!isCurrent && <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(Date.now())}>Voltar para o atual</button>}
        <div style={{ flex: 1 }} />
        <div className="team-total"><span className="lab">Total da equipe</span><span className="val">{fmtH(totalAll)}</span></div>
      </div>

      {/* filtro de projeto */}
      <div className="filterbar">
        <button className={'chip' + (!projFilter ? ' active' : '')} onClick={() => setProjFilter(null)}>Todos os projetos</button>
        {projects.map(p => (
          <button key={p.id} className={'chip' + (projFilter === p.id ? ' active' : '')} onClick={() => setProjFilter(p.id)}>
            <span className="dot" style={{ background: PROJECT_COLORS[p.color] }} />{p.name}
          </button>
        ))}
      </div>

      {totalAll === 0 ? (
        <div className="card empty">
          <div className="ic"><Icon name="timer" size={26} stroke={1.9} /></div>
          <h3>Nenhum tempo registrado</h3>
          <p>Ninguém registrou tempo neste período. Use as setas para navegar ou troque o filtro.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {perUser.map(({ user, rows, total }) => (
            <div key={user.id} className="card team-card">
              <div className="team-card-head">
                <Avatar user={user} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="team-name">{user.name}</div>
                  <div className="team-meta">{rows.length} {rows.length === 1 ? 'atividade' : 'atividades'}{total > 0 ? ` · ${Math.round(total / totalAll * 100)}% do total` : ''}</div>
                </div>
                <div className="team-card-total">{fmtH(total)}</div>
              </div>
              {total === 0 ? (
                <div className="team-empty">Sem registros neste período.</div>
              ) : (
                <div className="team-bars">
                  {rows.map(({ task, ms }) => {
                    const proj = projOf(task.projectId)
                    const color = PROJECT_COLORS[proj?.color] || 'var(--fg-4)'
                    return (
                      <div key={task.id} className="team-bar-row">
                        <div className="team-bar-label" title={`${task.title}${proj ? ' · ' + proj.name : ''}`}>
                          <span className="dot" style={{ background: color }} />
                          <span className="team-bar-text">
                            <span className="ttl">{task.title}</span>
                            {proj && <span className="prj">{proj.name}</span>}
                          </span>
                        </div>
                        <div className="team-bar-track">
                          <div className="team-bar-fill" style={{ width: Math.max(3, ms / maxUser * 100) + '%', background: color }} />
                        </div>
                        <span className="team-bar-time">{fmtH(ms)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
