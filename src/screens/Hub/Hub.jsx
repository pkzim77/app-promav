import './Hub.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { ProgressBar } from '../../components/primitives/primitives.jsx'
import { sameDay, fmtDur } from '../../components/TimeTracker/TimeTracker.jsx'
import { PROJECT_COLORS, projectProgress } from '../../data/store.js'
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

export function Hub({ projects, tasks, onNavigate, sessions, currentUserId, now }) {
  const inProgress = tasks.filter(t => t.status === 'progress').length
  const done = tasks.filter(t => t.status === 'done').length
  const todayMs = (sessions || []).filter(s => s.userId === currentUserId && sameDay(s.start, now))
    .reduce((sum, s) => sum + ((s.end || now) - s.start), 0)
  const cards = [
    { icon: 'folder', title: 'Projetos', desc: 'Crie e gerencie seus projetos e atividades.', tint: 'var(--brand-soft)', ink: 'var(--brand)', view: 'projects' },
    { icon: 'kanban', title: 'Kanban', desc: 'Acompanhe o fluxo das tarefas por status.', tint: 'var(--status-progress-soft)', ink: 'var(--status-progress)', view: 'kanban' },
    { icon: 'gantt', title: 'Gantt', desc: 'Visualize a linha do tempo dos projetos.', tint: 'var(--proj-amber-soft, #FCEFD7)', ink: 'var(--warning)', view: 'gantt' },
    { icon: 'inbox', title: 'Minhas tarefas', desc: 'Veja o que está sob sua responsabilidade.', tint: 'var(--success-soft)', ink: 'var(--success)', view: 'kanban', mine: true },
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
        {projects.map(p => {
          const pct = projectProgress(tasks, p.id)
          const count = tasks.filter(t => t.projectId === p.id).length
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
