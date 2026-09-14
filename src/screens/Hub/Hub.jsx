import './Hub.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { ProgressBar } from '../../components/primitives/primitives.jsx'
import { sameDay, fmtDur } from '../../components/TimeTracker/TimeTracker.jsx'
import { PROJECT_COLORS, SEM_ATIVIDADES, projectProgress, tasksByProject } from '../../data/store.js'
// Hub / Visão geral — summary stats + big navigation cards + recent projects.

function StatCard({ num, label }) {
  return (
    <div className="stat-card">
      <div className="stat-num">{num}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function HubCard({ icon, title, desc, tint, ink, onClick }) {
  return (
    <button className="hubcard" onClick={onClick}>
      <div className="ic" style={{ background: tint, color: ink }}><Icon name={icon} size={23} stroke={2} /></div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </button>
  )
}

export function Hub({ projects, recentProjects: searchedProjects = projects, tasks, onNavigate, sessions, currentUserId, now }) {
  const recentProjects = [...searchedProjects]
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .slice(0, 10)
  // Agrupa uma vez; os 10 cards abaixo pegam as suas por id em vez de cada um
  // varrer a lista inteira duas vezes.
  const porProjeto = React.useMemo(() => tasksByProject(tasks), [tasks])
  const inProgress = tasks.filter(t => t.status === 'progress').length
  const done = tasks.filter(t => t.status === 'done').length
  const todayMs = (sessions || []).filter(s => s.userId === currentUserId && sameDay(s.start, now))
    .reduce((sum, s) => sum + ((s.end || now) - s.start), 0)
  const cards = [
    // Ícones no bege da marca (MARCA+) sobre bege claro, iguais nos quatro.
    { icon: 'folder', title: 'Projetos', desc: 'Crie e gerencie seus projetos e atividades.', tint: 'var(--brand-soft)', ink: 'var(--accent-strong)', view: 'projects' },
    { icon: 'kanban', title: 'Kanban', desc: 'Acompanhe o fluxo das tarefas por status.', tint: 'var(--brand-soft)', ink: 'var(--accent-strong)', view: 'kanban' },
    { icon: 'gantt', title: 'Gantt', desc: 'Visualize a linha do tempo dos projetos.', tint: 'var(--brand-soft)', ink: 'var(--accent-strong)', view: 'gantt' },
    { icon: 'list', title: 'Lista', desc: 'Visualize todas as atividades em formato de lista.', tint: 'var(--brand-soft)', ink: 'var(--accent-strong)', view: 'list' },
  ]
  return (
    <div className="page">
      <p className="eyebrow">Bem-vindo de volta</p>
      <h1 style={{ font: 'var(--text-h1)', margin: '0 0 22px', letterSpacing: 'var(--tracking-tight)' }}>Sua semana no Promav</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard num={projects.length} label="Projetos ativos" />
        <StatCard num={inProgress} label="Tarefas em andamento" />
        <StatCard num={done} label="Tarefas concluídas" />
        <StatCard num={fmtDur(todayMs)} label="Tempo registrado hoje" />
      </div>

      <div className="hubcards" style={{ marginBottom: 30 }}>
        {cards.map(c => (
          <HubCard key={c.title} {...c} onClick={() => onNavigate({ view: c.view, mine: c.mine })} />
        ))}
      </div>

      <div className="sec-head">
        <div><h2 style={{ font: 'var(--text-h3)' }}>Projetos recentes</h2></div>
        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate({ view: 'projects' })}>
          Ver todos<Icon name="arrowRight" size={15} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
        {recentProjects.map(p => {
          const doProjeto = porProjeto.get(p.id) || SEM_ATIVIDADES
          const pct = projectProgress(doProjeto)
          const count = doProjeto.length
          return (
            <button key={p.id} className="card" style={{ padding: 18, textAlign: 'left' }} onClick={() => onNavigate({ view: 'projects', projectId: p.id })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
                <span style={{ width: 30, height: 30, borderRadius: 'var(--r-sm)', background: PROJECT_COLORS[p.color], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div title={p.name} style={{ fontWeight: 600, fontSize: 15, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{count} atividades</div>
                </div>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14, color: 'var(--fg-2)' }}>{pct}%</span>
              </div>
              <ProgressBar value={pct} color={PROJECT_COLORS[p.color]} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
