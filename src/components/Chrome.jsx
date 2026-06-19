import React from 'react'
import { Icon } from './Icon.jsx'
import { Avatar } from './primitives.jsx'
import { TimeClock } from './TimeTracker.jsx'
import { PROJECT_COLORS } from '../data/store.js'
// App chrome: left sidebar + top bar with search and user selector.

export function Sidebar({ route, onNavigate, projects, tasks }) {
  const navCount = (id) => {
    if (id === 'kanban') return tasks.filter(t => t.status === 'progress').length
    if (id === 'projects') return projects.length
    return null
  }
  const nav = [
    { id: 'hub', label: 'Visão geral', icon: 'hub' },
    { id: 'projects', label: 'Projetos', icon: 'folder' },
    { id: 'kanban', label: 'Kanban', icon: 'kanban' },
    { id: 'gantt', label: 'Gantt', icon: 'gantt' },
    { id: 'reports', label: 'Relatórios', icon: 'trendingUp' },
    { id: 'team', label: 'Equipe', icon: 'users' },
  ]
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <img src="/assets/promav-mark-light.svg" alt="" />
        <span className="word">promav</span>
      </div>
      {nav.map(n => {
        const c = navCount(n.id)
        return (
          <button key={n.id} className={'sb-item' + (route.view === n.id ? ' active' : '')} onClick={() => onNavigate({ view: n.id })}>
            <Icon name={n.icon} size={19} />{n.label}
            {c != null && <span className="badge">{c}</span>}
          </button>
        )
      })}
      <div className="sb-section">Projetos</div>
      {projects.map(p => (
        <button key={p.id} className="sb-proj" onClick={() => onNavigate({ view: 'projects', projectId: p.id })}>
          <span className="dot" style={{ background: PROJECT_COLORS[p.color] }} />{p.name}
        </button>
      ))}
    </aside>
  )
}

// Menu do usuário logado: dados da conta + trocar senha + sair.
export function UserMenu({ user, onChangePassword, onLogout }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  if (!user) return null
  return (
    <div className="userselect" ref={ref}>
      <button className="userselect-btn" onClick={() => setOpen(o => !o)}>
        <Avatar user={user} size={26} />{user.name.split(' ')[0]}
        <Icon name="chevronDown" size={15} style={{ color: 'var(--fg-3)' }} />
      </button>
      {open && (
        <div className="menu">
          <div className="menu-account">
            <Avatar user={user} size={34} />
            <div style={{ minWidth: 0 }}>
              <div className="menu-account-name">{user.name}</div>
              <div className="menu-account-email">{user.email}</div>
            </div>
          </div>
          <button className="menu-item" onClick={() => { setOpen(false); onChangePassword() }}>
            <Icon name="lock" size={17} />Trocar senha
          </button>
          <button className="menu-item" onClick={() => { setOpen(false); onLogout() }}>
            <Icon name="logout" size={17} />Sair
          </button>
        </div>
      )}
    </div>
  )
}

export function TopBar({ title, currentUser, canNewProject = true, onChangePassword, onLogout, onNewProject, tasks, projects, sessions, now, onStartTimer, onStopTimer }) {
  return (
    <header className="topbar">
      <h1 className="tb-title">{title}</h1>
      <div className="tb-spacer" />
      <div className="search">
        <Icon name="search" size={17} />
        <input placeholder="Buscar projetos e tarefas" />
      </div>
      <TimeClock currentUser={currentUser} tasks={tasks} projects={projects} sessions={sessions} now={now} onStart={onStartTimer} onStop={onStopTimer} />
      {canNewProject && (
        <button className="btn btn-primary" onClick={onNewProject}>
          <Icon name="plus" size={17} stroke={2.2} />Novo projeto
        </button>
      )}
      <UserMenu user={currentUser} onChangePassword={onChangePassword} onLogout={onLogout} />
    </header>
  )
}
