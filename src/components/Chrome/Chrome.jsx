import './Chrome.css'
import React from 'react'
import { Icon } from '../Icon.jsx'
import { Logo } from '../Logo/Logo.jsx'
import { Avatar } from '../primitives/primitives.jsx'
import { TimeClock } from '../TimeTracker/TimeTracker.jsx'
import { PROJECT_COLORS } from '../../data/store.js'
// App chrome: left sidebar + top bar with search and user selector.

// Menu de "três pontinhos" de uma pasta: aparece ao passar o mouse na pasta
// e abre as opções (novo projeto, renomear, excluir).
function FolderMenu({ folder, onNewProject, onNewSubfolder, onRename, onDelete }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className={'sb-folder-menu' + (open ? ' open' : '')} ref={ref}>
      <button className="sb-folder-menu-btn" title="Opções da pasta" onClick={() => setOpen(o => !o)}>
        <Icon name="more" size={17} />
      </button>
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={() => { setOpen(false); onNewProject(folder.id) }}>
            <Icon name="plus" size={16} />Novo projeto
          </button>
          <button className="menu-item" onClick={() => { setOpen(false); onNewSubfolder(folder.id) }}>
            <Icon name="folder" size={16} />Nova subpasta
          </button>
          <button className="menu-item" onClick={() => { setOpen(false); onRename(folder) }}>
            <Icon name="pencil" size={16} />Renomear pasta
          </button>
          <button className="menu-item danger" onClick={() => { setOpen(false); onDelete(folder) }}>
            <Icon name="trash" size={16} />Excluir pasta
          </button>
        </div>
      )}
    </div>
  )
}

// Menu de "três pontinhos" de um projeto: renomear, editar e excluir.
function ProjectMenu({ project, onRename, onEdit, onDelete }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className={'sb-folder-menu' + (open ? ' open' : '')} ref={ref}>
      <button className="sb-folder-menu-btn" title="Opções do projeto"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}>
        <Icon name="more" size={17} />
      </button>
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={(e) => { e.stopPropagation(); setOpen(false); onRename(project) }}>
            <Icon name="pencil" size={16} />Renomear projeto
          </button>
          <button className="menu-item" onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(project) }}>
            <Icon name="layers" size={16} />Editar projeto
          </button>
          <button className="menu-item danger" onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(project) }}>
            <Icon name="trash" size={16} />Excluir projeto
          </button>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ route, onNavigate, projects, tasks, folders = [], isAdmin = false, collapsed: navCollapsed = false, mobileOpen = false, onToggleCollapse, onCloseMobile, onNewFolder, onRenameFolder, onDeleteFolder, onNewProjectInFolder, onMoveFolder, onMoveProject, onRenameProject, onEditProject, onDeleteProject }) {
  // Guardamos quais pastas estão ABERTAS. Começa vazio → todas fechadas.
  const [expanded, setExpanded] = React.useState(() => new Set())
  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // ----- drag-and-drop (só admin): reordenar/mover pastas e projetos -----
  // drag = o que está sendo arrastado; hint = indicador visual de onde vai cair.
  const [drag, setDrag] = React.useState(null)   // { type:'folder'|'project', id }
  const [hint, setHint] = React.useState(null)   // { key, mode:'before'|'after'|'into' }
  const clearDrag = () => { setDrag(null); setHint(null) }

  const folderSibs = (parentId) => folders.filter(f => (f.parentId || null) === (parentId || null)).sort((a, b) => a.position - b.position)
  const projSibs = (folderId) => projects.filter(p => (p.folderId || null) === (folderId || null)).sort((a, b) => (a.position || 0) - (b.position || 0))
  const nextFolderId = (f) => { const s = folderSibs(f.parentId).filter(x => x.id !== drag?.id); const i = s.findIndex(x => x.id === f.id); return s[i + 1]?.id || null }
  const nextProjId = (p) => { const s = projSibs(p.folderId).filter(x => x.id !== drag?.id); const i = s.findIndex(x => x.id === p.id); return s[i + 1]?.id || null }

  // Modo do drop numa pasta: projeto sempre entra (into); pasta pode entrar
  // (meio) ou virar irmã antes/depois (topo/base da linha).
  const folderMode = (e, el) => {
    if (drag?.type === 'project') return 'into'
    const r = el.getBoundingClientRect(), y = e.clientY - r.top
    if (y < r.height * 0.3) return 'before'
    if (y > r.height * 0.7) return 'after'
    return 'into'
  }
  const projMode = (e, el) => { const r = el.getBoundingClientRect(); return (e.clientY - r.top) < r.height / 2 ? 'before' : 'after' }

  const overFolder = (f) => (e) => {
    if (!isAdmin || !drag) return
    if (drag.type === 'folder' && drag.id === f.id) return
    e.preventDefault(); e.stopPropagation()
    setHint({ key: 'f:' + f.id, mode: folderMode(e, e.currentTarget) })
  }
  const overProj = (p) => (e) => {
    if (!isAdmin || drag?.type !== 'project' || drag.id === p.id) return
    e.preventDefault(); e.stopPropagation()
    setHint({ key: 'p:' + p.id, mode: projMode(e, e.currentTarget) })
  }
  const overRoot = (e) => { if (!isAdmin || !drag) return; e.preventDefault(); setHint({ key: 'root', mode: 'into' }) }

  const dropFolder = (f) => (e) => {
    if (!isAdmin || !drag) return
    e.preventDefault(); e.stopPropagation()
    const mode = folderMode(e, e.currentTarget)
    if (drag.type === 'folder') {
      if (drag.id !== f.id) {
        if (mode === 'into') onMoveFolder(drag.id, f.id, null)
        else if (mode === 'before') onMoveFolder(drag.id, f.parentId || null, f.id)
        else onMoveFolder(drag.id, f.parentId || null, nextFolderId(f))
      }
    } else if (drag.type === 'project') {
      onMoveProject(drag.id, f.id, null)
    }
    clearDrag()
  }
  const dropProj = (p) => (e) => {
    if (!isAdmin || drag?.type !== 'project') return
    e.preventDefault(); e.stopPropagation()
    if (drag.id !== p.id) {
      const mode = projMode(e, e.currentTarget)
      if (mode === 'before') onMoveProject(drag.id, p.folderId || null, p.id)
      else onMoveProject(drag.id, p.folderId || null, nextProjId(p))
    }
    clearDrag()
  }
  const dropRoot = (e) => {
    if (!isAdmin || !drag) return
    e.preventDefault()
    if (drag.type === 'folder') onMoveFolder(drag.id, null, null)
    else onMoveProject(drag.id, null, null)
    clearDrag()
  }
  const hintClass = (key) => hint?.key === key ? ' drop-' + hint.mode : ''

  // Navegar sempre fecha o menu no celular (drawer).
  const go = (r) => { onNavigate(r); onCloseMobile && onCloseMobile() }

  const nav = [
    { id: 'hub', label: 'Visão geral', icon: 'hub' },
    { id: 'projects', label: 'Projetos', icon: 'folder' },
    { id: 'list', label: 'Lista', icon: 'list' },
    { id: 'kanban', label: 'Kanban', icon: 'kanban' },
    { id: 'gantt', label: 'Gantt', icon: 'gantt' },
    { id: 'reports', label: 'Relatórios Dos Projetos', icon: 'trendingUp' },
    { id: 'team', label: 'Relatórios Da Equipe', icon: 'users' },
  ]

  // Um botão de projeto (a "lista de tarefas"), reutilizado dentro e fora das pastas.
  const projItem = (p) => (
    <div key={p.id}
      className={'sb-proj-row' + (drag?.id === p.id ? ' dragging' : '') + hintClass('p:' + p.id)}
      draggable={isAdmin}
      onDragStart={(e) => { setDrag({ type: 'project', id: p.id }); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={clearDrag}
      onDragOver={overProj(p)}
      onDrop={dropProj(p)}>
      <button className={'sb-proj' + (route.projectId === p.id ? ' active' : '')} title={p.name}
        onClick={() => go({ view: 'list', projectId: p.id })}>
        <Icon name="list" size={16} style={{ color: PROJECT_COLORS[p.color], flexShrink: 0 }} />
        <span className="sb-proj-name" title={p.name}>{p.name}</span>
      </button>
      {isAdmin && <ProjectMenu project={p} onRename={onRenameProject} onEdit={onEditProject} onDelete={onDeleteProject} />}
    </div>
  )

  // Projetos sem pasta (ou cuja pasta não existe mais) aparecem soltos no fim.
  const folderIds = new Set(folders.map(f => f.id))
  const loose = projects.filter(p => !p.folderId || !folderIds.has(p.folderId))

  // Subpastas de cada pasta (pai). Pastas raiz têm parentId nulo (ou pai inexistente).
  const childrenOf = (parentId) => folders.filter(f =>
    parentId == null ? (!f.parentId || !folderIds.has(f.parentId)) : f.parentId === parentId)

  // Renderiza uma pasta com seus projetos e suas subpastas (aninhamento ilimitado).
  const renderFolder = (f, depth = 0) => {
    const inside = projects.filter(p => p.folderId === f.id)
    const subfolders = childrenOf(f.id)
    const open = expanded.has(f.id)
    return (
      <div key={f.id} className="sb-folder" style={depth ? { marginLeft: 14 } : undefined}>
        <div className={'sb-folder-row' + (open ? ' open' : '') + (drag?.id === f.id ? ' dragging' : '') + hintClass('f:' + f.id)}
          draggable={isAdmin}
          onDragStart={(e) => { e.stopPropagation(); setDrag({ type: 'folder', id: f.id }); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={clearDrag}
          onDragOver={overFolder(f)}
          onDrop={dropFolder(f)}>
          <button className="sb-folder-head" title={f.name} onClick={() => toggle(f.id)}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} className="sb-folder-chevron" />
            <Icon name="folder" size={16} />
            <span className="sb-folder-name" title={f.name}>{f.name}</span>
          </button>
          {isAdmin && (
            <FolderMenu folder={f} onNewProject={onNewProjectInFolder} onNewSubfolder={onNewFolder}
              onRename={onRenameFolder} onDelete={onDeleteFolder} />
          )}
        </div>
        {open && (
          <div className="sb-folder-body">
            {subfolders.map(sf => renderFolder(sf, depth + 1))}
            {inside.length ? inside.map(projItem)
              : (!subfolders.length && <div className="sb-folder-empty">Sem projetos ainda</div>)}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className={'sidebar' + (navCollapsed ? ' nav-collapsed' : '') + (mobileOpen ? ' mobile-open' : '')}>
      <div className="sb-brand">
        <Logo size={19} />
        <button className="sb-collapse-btn" title={navCollapsed ? 'Expandir menu' : 'Recolher menu'}
          onClick={onToggleCollapse}>
          <Icon name="panelLeft" size={18} />
        </button>
      </div>
      {nav.map(n => (
        <button key={n.id} className={'sb-item' + (route.view === n.id ? ' active' : '')} title={n.label} onClick={() => go({ view: n.id })}>
          <Icon name={n.icon} size={19} /><span className="sb-label">{n.label}</span>
        </button>
      ))}

      <div className="sb-section">
        <span className="sb-section-text">Projetos</span>
        {isAdmin && (
          <button className="sb-section-btn" title="Nova pasta" onClick={onNewFolder}>
            <Icon name="plus" size={15} stroke={2.4} />
          </button>
        )}
      </div>

      {childrenOf(null).map(f => renderFolder(f))}

      {loose.map(projItem)}

      {isAdmin && (
        <div className={'sb-root-drop' + (drag ? ' active' : '') + hintClass('root')}
          onDragOver={overRoot} onDrop={dropRoot}>
          {drag && <span>Soltar aqui para tirar da pasta</span>}
        </div>
      )}
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

export function TopBar({ title, currentUser, canNewProject = true, onToggleMobileNav, onChangePassword, onLogout, onNewProject, tasks, projects, sessions, now, onStartTimer, onStopTimer }) {
  return (
    <header className="topbar">
      <button className="tb-hamburger" title="Menu" onClick={onToggleMobileNav}>
        <Icon name="menu" size={22} />
      </button>
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
