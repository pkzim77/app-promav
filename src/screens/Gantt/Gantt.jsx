import './Gantt.css'
import React from 'react'
import { PROJECT_COLORS, parseDate, dayDiff, addDays, fmtShort, MONTHS_PT, todayISO } from '../../data/store.js'
// Gantt — horizontal bars per task, grouped by project, date ruler on top.

const DAY_W = 26

// Memoizado: o pai re-renderiza a cada segundo por causa do `now` do
// cronômetro, e nada aqui depende dele. Como o memo também barra o render que
// trazia o dia novo, quem cuida da data de hoje é o próprio componente.
export const Gantt = React.memo(function Gantt({ tasks, projects, filterProject, onFilterProject, embedded }) {
  // O dia fica em estado e se reagenda para a meia-noite seguinte, senão a
  // coluna destacada, a linha de hoje e a legenda ficariam no dia anterior até
  // alguma prop mudar.
  const [hojeISO, setHojeISO] = React.useState(todayISO)
  React.useEffect(() => {
    const agora = new Date()
    const proximaMeiaNoite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1)
    const id = setTimeout(() => setHojeISO(todayISO()), proximaMeiaNoite - agora + 1000)
    return () => clearTimeout(id)
  }, [hojeISO])
  // visible projects
  const shownProjects = filterProject ? projects.filter(p => p.id === filterProject) : projects
  const shownTasks = tasks.filter(t => shownProjects.some(p => p.id === t.projectId))

  // date range across project + task bounds, padded to whole weeks-ish
  // Sem prazo não há barra para desenhar, e uma data vazia no meio do cálculo
  // de extremos contaminava o intervalo inteiro.
  const allDates = [...shownProjects.flatMap(p => [p.start, p.end]), ...shownTasks.flatMap(t => [t.start, t.end])].filter(Boolean)
  if (!allDates.length) allDates.push(hojeISO, addDays(hojeISO, 14))
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
    days.push({ iso, num: d.getDate(), month: d.getMonth(), year: d.getFullYear(), weekend: wd === 0 || wd === 6, today: iso === hojeISO })
  }
  // Segmentos de mês. O ano entra na comparação porque um intervalo de vários
  // anos tem 'jan' mais de uma vez, e sem isso eles virariam um bloco só.
  const months = []
  days.forEach(dy => {
    const last = months[months.length - 1]
    if (last && last.month === dy.month && last.year === dy.year) last.count++
    else months.push({ month: dy.month, year: dy.year, count: 1 })
  })

  const trackW = totalDays * DAY_W
  const todayLeft = (dayDiff(rangeStart, hojeISO)) * DAY_W + DAY_W / 2
  // O intervalo vem das datas do projeto, que pode ter terminado meses atrás
  // ou nem ter começado: hoje nem sempre tem coluna onde cair.
  const hojeNoIntervalo = todayLeft >= 0 && todayLeft <= trackW

  const scrollRef = React.useRef(null)
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = hojeNoIntervalo ? Math.max(0, todayLeft - 220) : 0
  }, [filterProject])

  // Devolve null quando falta prazo: quem desenha decide o que fazer, em vez de
  // receber uma barra em NaN, que o navegador desenha como uma faixa na origem.
  const barStyle = (item, color) => {
    const offset = dayDiff(rangeStart, item.start)
    const dias = dayDiff(item.start, item.end)
    if (offset == null || dias == null) return null
    return { left: offset * DAY_W + 2, width: (dias + 1) * DAY_W - 4, background: color }
  }

  return (
    <div className={embedded ? 'page-embutida' : undefined} style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 1280, width: '100%', margin: '0 auto' }}>
      <div style={{ padding: embedded ? 0 : '28px 36px 0' }}>
        <div className="sec-head" style={{ marginBottom: 14 }}>
          <div><h2>Gantt</h2><div className="sub">Linha do tempo das atividades, agrupadas por projeto.</div></div>
        </div>
        <div className="filterbar">
          <select className="filter-select" value={filterProject || ''} aria-label="Filtrar por projeto"
            onChange={(e) => onFilterProject(e.target.value || null)}>
            <option value="">Todos os projetos</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ padding: embedded ? '0 0 32px' : '0 36px 32px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="gantt">
          <div className="gantt-scroll" ref={scrollRef}>
            <div className="gantt-grid" style={{ minWidth: 220 + trackW, '--gantt-day-w': DAY_W + 'px' }}>
              {/* ruler */}
              <div className="gantt-ruler">
                <div className="gantt-label-col" style={{ display: 'flex', alignItems: 'flex-end', padding: '0 12px 6px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--fg-4)' }}>Atividade</span>
                </div>
                <div style={{ width: trackW }}>
                  <div style={{ display: 'flex' }}>
                    {months.map((m, i) => (
                      <div key={i} className="gantt-month" title={`${MONTHS_PT[m.month]} ${m.year}`} style={{ width: m.count * DAY_W, borderLeft: i ? '1px solid var(--border)' : 'none' }}>
                        {/* O ano só cabe a partir de 3 dias de segmento; nas pontas curtas o nowrap da régua cortaria o ano no meio, e 'AGO 2' se lê como outro ano. O title guarda o rótulo inteiro. */}
                        {m.count >= 3 ? `${MONTHS_PT[m.month]} ${String(m.year).slice(2)}` : MONTHS_PT[m.month]}
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
              {hojeNoIntervalo && <div className="gantt-today-line" style={{ left: 220 + todayLeft }} />}

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
                        {barStyle(p, color) && (
                          <div className="gantt-bar" style={{ ...barStyle(p, color), opacity: .28, top: 13, height: 12, color: 'transparent', boxShadow: 'none' }} />
                        )}
                      </div>
                    </div>
                    {list.map(t => (
                      <div className="gantt-row" key={t.id}>
                        <div className="gantt-rowlabel" style={{ paddingLeft: 26, color: 'var(--fg-2)', fontSize: 12.5 }}>{t.title}</div>
                        <div className="gantt-track" style={{ width: trackW }}>
                          {barStyle(t, color) ? (
                            <div className="gantt-bar" style={barStyle(t, color)} title={`${fmtShort(t.start)} – ${fmtShort(t.end)}`}>
                              {t.title}
                            </div>
                          ) : (
                            <span className="gantt-sem-prazo">sem prazo definido</span>
                          )}
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
          <span style={{ width: 14, height: 2, background: 'var(--brand)', opacity: .55 }} />Hoje · {fmtShort(hojeISO)}{!hojeNoIntervalo && ' (fora do período exibido)'}
        </div>
      </div>
    </div>
  )
})
