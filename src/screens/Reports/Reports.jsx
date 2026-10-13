import './Reports.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { StatusTag, ProgressBar } from '../../components/primitives/primitives.jsx'
import { ReportView } from '../ReportView/ReportView.jsx'
import { PROJECT_COLORS, checklistStats, taskProgress } from '../../data/store.js'
// Relatórios — escolha quais PROJETOS e quais ATIVIDADES entram, e gere o relatório.

// Memoizado: o pai re-renderiza a cada segundo por causa do `now` do
// cronômetro, e nada nesta tela depende dele.
export const Reports = React.memo(function Reports({ projects, tasks, users }) {
  // Começa com tudo selecionado; o usuário desmarca o que não quer. Guardar os
  // desmarcados (e não os marcados) mantém a lista em dia com o polling:
  // atividade nova entra marcada e atividade excluída sai da contagem.
  const [desmarcadas, setDesmarcadas] = React.useState(() => new Set())
  const [report, setReport] = React.useState(null)
  const selecionadas = tasks.filter(t => !desmarcadas.has(t.id))

  const tasksOf = (pid) => tasks.filter(t => t.projectId === pid)

  const toggleTask = (id) => setDesmarcadas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const setMany = (ids, on) => setDesmarcadas(s => { const n = new Set(s); ids.forEach(id => on ? n.delete(id) : n.add(id)); return n })

  const projState = (pid) => {
    const ids = tasksOf(pid).map(t => t.id)
    const sel = ids.filter(id => !desmarcadas.has(id)).length
    return { ids, sel, total: ids.length, all: ids.length > 0 && sel === ids.length, some: sel > 0 && sel < ids.length }
  }
  const toggleProject = (pid) => { const st = projState(pid); setMany(st.ids, !st.all) }

  const allIds = tasks.map(t => t.id)
  const allOn = selecionadas.length === tasks.length
  const selectedProjectCount = projects.filter(p => projState(p.id).sel > 0).length

  const generate = () => setReport({ tasks: selecionadas })

  if (report) return <ReportView report={report} projects={projects} users={users} onBack={() => setReport(null)} />

  return (
    <div className="page">
      <div className="sec-head">
        <div>
          <h2>Relatórios</h2>
          <div className="sub">Marque os projetos e as atividades que devem entrar no relatório.</div>
        </div>
        <button className="btn btn-primary" disabled={selecionadas.length === 0} onClick={generate}>
          <Icon name="trendingUp" size={17} />Gerar relatório
        </button>
      </div>

      <div className="rep-toolbar">
        <div className="rep-summary">
          <strong>{selecionadas.length}</strong> de {tasks.length} atividades · <strong>{selectedProjectCount}</strong> de {projects.length} projetos
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setMany(allIds, true)} disabled={allOn}>Selecionar tudo</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setMany(allIds, false)} disabled={selecionadas.length === 0}>Limpar</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {projects.map(p => {
          const st = projState(p.id)
          const list = tasksOf(p.id)
          return (
            <div key={p.id} className="card rep-group">
              <div className={'rep-group-head' + (st.sel > 0 ? ' on' : '')} onClick={() => toggleProject(p.id)}>
                <button className={'ck-box' + (st.all ? ' on' : st.some ? ' some' : '')} role="checkbox" aria-checked={st.all ? true : st.some ? 'mixed' : false} aria-label="Selecionar projeto">
                  {st.all ? <Icon name="check" size={12} stroke={3} /> : st.some ? <span className="ck-dash" /> : null}
                </button>
                <span className="dot" style={{ width: 12, height: 12, borderRadius: 4, background: PROJECT_COLORS[p.color] }} />
                <span className="rep-group-name">{p.name}</span>
                <span className="rep-count">{st.sel}/{st.total}</span>
              </div>
              {list.length === 0 && <div className="rep-group-empty">Sem atividades neste projeto.</div>}
              {list.map(t => {
                const cs = checklistStats(t)
                const on = !desmarcadas.has(t.id)
                const pct = taskProgress(t)
                return (
                  <div key={t.id} className={'rep-selrow' + (on ? ' on' : '')} onClick={() => toggleTask(t.id)}>
                    <button className={'ck-box' + (on ? ' on' : '')} role="checkbox" aria-checked={on} aria-label="Selecionar atividade">
                      {on && <Icon name="check" size={12} stroke={3} />}
                    </button>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: 'var(--fg-1)', fontSize: 14 }}>{t.title}</span>
                    <StatusTag status={t.status} />
                    <div style={{ width: 130, display: 'flex', alignItems: 'center', gap: 9 }}>
                      <ProgressBar value={pct} color={pct === 100 ? 'var(--success)' : 'var(--brand)'} style={{ flex: 1 }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)', width: 34 }}>{cs.total ? cs.done + '/' + cs.total : '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
})
