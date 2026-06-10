import React from 'react'
import { PROJECT_COLORS, parseDate, dayDiff, addDays, fmtShort, MONTHS_PT, todayISO } from '../data/store.js'
// Gantt — horizontal bars per task, grouped by project, date ruler on top.

const DAY_W = 26

export function Gantt({ tasks, projects, filterProject, onFilterProject }) {
  // visible projects
  const shownProjects = filterProject ? projects.filter(p => p.id === filterProject) : projects
  const shownTasks = tasks.filter(t => shownProjects.some(p => p.id === t.projectId))

  // date range across project + task bounds, padded to whole weeks-ish
  const allDates = []
  shownProjects.forEach(p => { allDates.push(p.start, p.end) })
  shownTasks.forEach(t => { allDates.push(t.start, t.end) })
  if (!allDates.length) allDates.push(todayISO(), addDays(todayISO(), 14))
  const minD = allDates.reduce((a, b) => parseDate(b) < parseDate(a) ? b : a)
  const maxD = allDates.reduce((a, b) => parseDate(b) > parseDate(a) ? b : a)
  const rangeStart = addDays(minD, -2)
  const rangeEnd = addDays(maxD, 2)
  const totalDays = dayDiff(rangeStart, rangeEnd) + 1

  // build day cells
  const days = []
  for (let i = 0; i < totalDays; i++) {
    const iso = addDays(rangeStart, i)
    const d = parseDate(iso)
    const wd = d.getDay()
    days.push({ iso, num: d.getDate(), month: d.getMonth(), weekend: wd === 0 || wd === 6, today: iso === todayISO() })
  }
  // month segments
  const months = []
  days.forEach(dy => {
    const last = months[months.length - 1]
    if (last && last.month === dy.month) last.count++
    else months.push({ month: dy.month, count: 1 })
  })

  const trackW = totalDays * DAY_W
  const todayLeft = (dayDiff(rangeStart, todayISO())) * DAY_W + DAY_W / 2

  const scrollRef = React.useRef(null)
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, todayLeft - 220)
  }, [filterProject])

  const barStyle = (item, color) => {
    const offset = dayDiff(rangeStart, item.start)
    const dur = dayDiff(item.start, item.end) + 1
    return { left: offset * DAY_W + 2, width: dur * DAY_W - 4, background: color }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 28px 0' }}>
        <div className="sec-head" style={{ marginBottom: 14 }}>
          <div><h2>Gantt</h2><div className="sub">Linha do tempo das atividades, agrupadas por projeto.</div></div>
        </div>
        <div className="filterbar">
          <button className={'chip' + (!filterProject ? ' active' : '')} onClick={() => onFilterProject(null)}>Todos os projetos</button>
          {projects.map(p => (
            <button key={p.id} className={'chip' + (filterProject === p.id ? ' active' : '')} onClick={() => onFilterProject(p.id)}>
              <span className="dot" style={{ background: PROJECT_COLORS[p.color] }} />{p.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 28px 32px', flex: 1, minHeight: 0 }}>
        <div className="gantt">
          <div className="gantt-scroll" ref={scrollRef}>
            <div className="gantt-grid" style={{ minWidth: 220 + trackW }}>
              {/* ruler */}
              <div className="gantt-ruler">
                <div className="gantt-label-col" style={{ display: 'flex', alignItems: 'flex-end', padding: '0 12px 6px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--fg-4)' }}>Atividade</span>
                </div>
                <div style={{ width: trackW }}>
                  <div style={{ display: 'flex' }}>
                    {months.map((m, i) => (
                      <div key={i} className="gantt-month" style={{ width: m.count * DAY_W, borderLeft: i ? '1px solid var(--border)' : 'none' }}>
                        {MONTHS_PT[m.month]}
                      </div>
                    ))}
                  </div>
                  <div className="gantt-days">
                    {days.map((dy, i) => (
                      <div key={i} className={'gantt-day' + (dy.weekend ? ' weekend' : '') + (dy.today ? ' today' : '')}>{dy.num}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* today line */}
              <div className="gantt-today-line" style={{ left: 220 + todayLeft }} />

              {/* rows grouped by project */}
              {shownProjects.map(p => {
                const list = tasks.filter(t => t.projectId === p.id)
                const color = PROJECT_COLORS[p.color]
                return (
                  <React.Fragment key={p.id}>
                    <div className="gantt-row gantt-group">
                      <div className="gantt-rowlabel">
                        <span className="dot" style={{ width: 10, height: 10, borderRadius: 50, background: color }} />{p.name}
                      </div>
                      <div className="gantt-track" style={{ width: trackW, height: 38 }}>
                        <div className="gantt-bar" style={{ ...barStyle(p, color), opacity: .28, top: 13, height: 12, color: 'transparent', boxShadow: 'none' }} />
                      </div>
                    </div>
                    {list.map(t => (
                      <div className="gantt-row" key={t.id}>
                        <div className="gantt-rowlabel" style={{ paddingLeft: 26, color: 'var(--fg-2)', fontSize: 12.5 }}>{t.title}</div>
                        <div className="gantt-track" style={{ width: trackW }}>
                          <div className="gantt-bar" style={barStyle(t, color)} title={`${fmtShort(t.start)} – ${fmtShort(t.end)}`}>
                            {t.title}
                          </div>
                        </div>
                      </div>
                    ))}
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12, color: 'var(--fg-4)' }}>
          <span style={{ width: 14, height: 2, background: 'var(--brand)', opacity: .55 }} />Hoje · {fmtShort(todayISO())}
        </div>
      </div>
    </div>
  )
}
