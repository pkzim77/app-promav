import './ReportView.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { Logo } from '../../components/Logo/Logo.jsx'
import { AvatarStack, StatusTag } from '../../components/primitives/primitives.jsx'
import { PROJECT_COLORS, checklistStats, taskProgress, taskMembers, parseDate, fmtFull, fmtMed, todayISO } from '../../data/store.js'
// ReportView — o relatório gerado: resumo geral + rollup por projeto + detalhe por atividade.

function donut(pct, size = 76, stroke = 9, color = 'var(--brand)') {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-muted)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct/100)} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset .6s var(--ease)' }} />
    </svg>
  )
}

export function ReportView({ report, projects, users, onBack }) {
  const { tasks } = report
  const userOf = (id) => users.find(u => u.id === id)
  const projOf = (id) => projects.find(p => p.id === id)

  const total = tasks.length
  const doneCount = tasks.filter(t => t.status === 'done').length
  const overall = total ? Math.round(tasks.reduce((s, t) => s + taskProgress(t), 0) / total) : 0
  const allItems = tasks.reduce((s, t) => s + (t.checklist || []).length, 0)
  const doneItems = tasks.reduce((s, t) => s + (t.checklist || []).filter(i => i.done).length, 0)

  // group by project
  const byProject = {}
  tasks.forEach(t => { (byProject[t.projectId] = byProject[t.projectId] || []).push(t) })
  const groups = Object.keys(byProject).map(pid => {
    const list = byProject[pid]
    const pct = Math.round(list.reduce((s, t) => s + taskProgress(t), 0) / list.length)
    return { project: projOf(pid), list, pct }
  })

  const print = () => window.print()

  return (
    <div className="page report-doc">
      <div className="sec-head no-print">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginLeft: -8 }}>
          <Icon name="chevronLeft" size={16} />Voltar à seleção
        </button>
        <button className="btn btn-secondary" onClick={print}><Icon name="history" size={16} />Imprimir / PDF</button>
      </div>

      {/* header */}
      <div className="report-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={18} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>Relatório de progresso</div>
            <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>Gerado em {fmtFull(todayISO())} · {total} atividades</div>
          </div>
        </div>
      </div>

      {/* summary */}
      <div className="report-summary card">
        <div className="rep-donut">
          <div style={{ position: 'relative', width: 76, height: 76 }}>
            {donut(overall, 76, 9, overall === 100 ? 'var(--success)' : 'var(--brand)')}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 19, color: 'var(--fg-1)' }}>{overall}%</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>Conclusão geral</div>
            <div style={{ fontSize: 14, color: 'var(--fg-2)', marginTop: 2 }}>{100 - overall}% restante</div>
          </div>
        </div>
        <div className="rep-stat-grid">
          <div><span className="num">{doneCount}</span><span className="lab">Concluídas</span></div>
          <div><span className="num">{total - doneCount}</span><span className="lab">Em aberto</span></div>
          <div><span className="num">{doneItems}/{allItems || '—'}</span><span className="lab">Itens do checklist</span></div>
        </div>
      </div>

      {/* per project */}
      {groups.map(g => (
        <div key={g.project.id} className="report-group">
          <div className="report-group-head">
            <span className="dot" style={{ width: 12, height: 12, borderRadius: 50, background: PROJECT_COLORS[g.project.color] }} />
            <h3>{g.project.name}</h3>
            <span className="rep-count">{g.list.length} ativ.</span>
            <div style={{ flex: 1 }} />
            <div style={{ width: 160, display: 'flex', alignItems: 'center', gap: 10 }}>
              <RepBar value={g.pct} color={PROJECT_COLORS[g.project.color]} />
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: 'var(--fg-1)', width: 38 }}>{g.pct}%</span>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {g.list.map(t => {
              const cs = checklistStats(t)
              const pct = taskProgress(t)
              const overdue = t.status !== 'done' && parseDate(t.end) < parseDate(todayISO())
              return (
                <div key={t.id} className="report-task">
                  <div className="report-task-top">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--fg-1)' }}>{t.title}</span>
                        <StatusTag status={t.status} />
                        {overdue && (
                          <span className="report-late"><Icon name="clock" size={12} stroke={2.4} />Atrasada</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12.5, color: 'var(--fg-3)' }}>
                        <AvatarStack users={taskMembers(t).map(id => userOf(id))} size={20} max={4} />
                        {(() => { const m = taskMembers(t).map(id => userOf(id)).filter(Boolean); const first = m[0]?.name.split(' ')[0] || '—'; return m.length > 1 ? `${first} +${m.length - 1}` : first })()} · {fmtMed(t.start)} – {fmtMed(t.end)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: pct === 100 ? 'var(--success)' : 'var(--fg-1)' }}>{pct}%</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>{cs.total ? `${cs.done}/${cs.total} itens` : 'sem checklist'}</div>
                    </div>
                  </div>
                  <div className="progress" style={{ margin: '10px 0 0' }}><div style={{ width: pct + '%', background: pct === 100 ? 'var(--success)' : 'var(--brand)' }} /></div>
                  {cs.total > 0 && (
                    <div className="report-checklist">
                      {(t.checklist || []).map(it => (
                        <div key={it.id} className={'report-ck-item' + (it.done ? ' done' : '')}>
                          <span className="report-ck-box">{it.done ? <Icon name="check" size={11} stroke={3} /> : null}</span>
                          {it.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function RepBar({ value, color }) {
  return <div className="progress" style={{ flex: 1 }}><div style={{ width: value + '%', background: color }} /></div>
}
