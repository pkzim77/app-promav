import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { ProgressBar } from '../../../components/primitives/primitives.jsx'
import { PROJECT_COLORS, SEM_ATIVIDADES, projectProgress, tasksByProject, fmtShort, effectiveProjectRole, canEditProject } from '../../../data/store.js'
import { EmptyState } from '../shared/EmptyState.jsx'

function ProjectGridCard({ project, tasks, authUser, onOpen, onEdit, onDelete, draggable, dragging, dropHint, onDragStart, onDragEnd, onDragOver, onDrop }) {
  // `tasks` são só as DESTE projeto — o pai agrupa uma vez (tasksByProject).
  const pct = projectProgress(tasks)
  const count = tasks.length
  const color = PROJECT_COLORS[project.color]
  const role = effectiveProjectRole(project, authUser)
  const canEdit = canEditProject(role)
  const canDelete = role === 'admin'
  return (
    // O card inteiro abre o projeto; os botões de ação param a propagação.
    <div className={'card proj-card' + (dragging ? ' dragging' : '') + (dropHint ? ` drop-${dropHint}` : '')} role="button" tabIndex={0} title={project.name}
      draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop}
      onClick={() => onOpen(project.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(project.id) } }}
      style={{ padding: 22, display: 'flex', flexDirection: 'column', minHeight: 200 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: 'var(--r-md)', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: 'var(--text-h4)', color: 'var(--fg-1)', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', overflowWrap: 'anywhere' }}>{project.name}</div>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: '3px 0 0', lineHeight: 1.45, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden', overflowWrap: 'anywhere' }}>{project.desc}</p>
        </div>
        {(canEdit || canDelete) && (
          <div style={{ display: 'flex', gap: 2 }}>
            {canEdit && <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onEdit(project) }} aria-label="Editar"><Icon name="pencil" size={16} /></button>}
            {canDelete && <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onDelete(project) }} aria-label="Excluir"><Icon name="trash" size={16} /></button>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg-3)', marginBottom: 14 }}>
        <Icon name="calendar" size={14} />{fmtShort(project.start)} — {fmtShort(project.end)}
      </div>
      <div style={{ marginTop: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{count} atividades</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--fg-2)' }}>{pct}%</span>
        </div>
        <ProgressBar value={pct} color={color} />
      </div>
    </div>
  )
}

function FolderGridMenu({ folder, onNewProject, onNewSubfolder, onDelete }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  React.useEffect(() => {
    const handleOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])
  return (
    <div className="proj-folder-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="proj-folder-menu-btn" title="Opções da pasta" aria-label="Opções da pasta"
        onClick={() => setOpen(value => !value)}>
        <Icon name="more" size={19} />
      </button>
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={() => { setOpen(false); onNewProject(folder.id) }}>
            <Icon name="plus" size={16} />Novo projeto
          </button>
          <button className="menu-item" onClick={() => { setOpen(false); onNewSubfolder(folder.id) }}>
            <Icon name="folder" size={16} />Criar subpasta
          </button>
          <button className="menu-item danger" onClick={() => { setOpen(false); onDelete(folder) }}>
            <Icon name="trash" size={16} />Excluir pasta
          </button>
        </div>
      )}
    </div>
  )
}

// Card de uma pasta na tela de Projetos: entra na pasta ao clicar.
function FolderGridCard({ folder, subCount, projCount, onEnter, onNewProject, onNewSubfolder, onDelete, draggable, dragging, dropHint, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const parts = []
  if (subCount) parts.push(`${subCount} ${subCount > 1 ? 'pastas' : 'pasta'}`)
  parts.push(`${projCount} ${projCount === 1 ? 'projeto' : 'projetos'}`)
  return (
    <div className={'card proj-folder-card' + (dragging ? ' dragging' : '') + (dropHint ? ` drop-${dropHint}` : '')}
      role="button" tabIndex={0}
      data-drag-type="folder" draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop}
      onClick={() => onEnter(folder.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEnter(folder.id) } }} title={folder.name}>
      <span className="proj-folder-ic"><Icon name="folder" size={28} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="proj-folder-name">{folder.name}</div>
        <div className="proj-folder-meta">{parts.join(' · ')}</div>
      </div>
      <FolderGridMenu folder={folder} onNewProject={onNewProject} onNewSubfolder={onNewSubfolder} onDelete={onDelete} />
    </div>
  )
}

export function ProjectList({ projects, tasks, folders = [], authUser, canCreate = true, onOpen, onEdit, onDelete, onNew, onMoveProject, onMoveFolder, onNewSubfolder, onDeleteFolder }) {
  const [openId, setOpenId] = React.useState(null) // pasta aberta (null = raiz)
  const [drag, setDrag] = React.useState(null)
  const dragRef = React.useRef(null)
  const [dropHint, setDropHint] = React.useState(null)

  // Uma passada sobre as atividades em vez de dois filters por card.
  const porProjeto = React.useMemo(() => tasksByProject(tasks), [tasks])

  const folderIds = React.useMemo(() => new Set(folders.map(f => f.id)), [folders])
  // Pasta atual é válida? (pode ter sido excluída) — senão, volta à raiz.
  const currentId = openId && folderIds.has(openId) ? openId : null

  const byPos = (a, b) => (a.position || 0) - (b.position || 0)
  // Subpastas de uma pasta (raiz = parentId nulo ou pai inexistente).
  const childFolders = (pid) => folders.filter(f =>
    pid == null ? (!f.parentId || !folderIds.has(f.parentId)) : f.parentId === pid).sort(byPos)
  // Projetos dentro de uma pasta (raiz = sem pasta ou pasta inexistente).
  const projectsIn = (fid) => projects.filter(p =>
    fid == null ? (!p.folderId || !folderIds.has(p.folderId)) : p.folderId === fid).sort(byPos)

  // Trilha (breadcrumb) da raiz até a pasta atual.
  const path = []
  { let cur = folders.find(f => f.id === currentId), seen = new Set()
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); path.unshift(cur); cur = cur.parentId && folderIds.has(cur.parentId) ? folders.find(f => f.id === cur.parentId) : null } }

  const subfolders = childFolders(currentId)
  const projs = projectsIn(currentId)
  const isEmpty = !subfolders.length && !projs.length
  const canMove = !!authUser?.isAdmin && typeof onMoveProject === 'function'
  const clearDrag = () => { dragRef.current = null; setDrag(null); setDropHint(null) }
  const startDrag = (id) => (e) => {
    if (!canMove) return
    const type = e.currentTarget.dataset.dragType || 'project'
    const item = { id, type }
    dragRef.current = item
    setDrag(item)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${type}:${id}`)
  }
  const overProject = (p) => (e) => {
    if (!canMove || !drag || drag.type !== 'project' || drag.id === p.id) return
    e.preventDefault(); e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setDropHint({ key: 'p:' + p.id, mode: e.clientY - rect.top < rect.height / 2 ? 'before' : 'after' })
  }
  const dropProject = (p) => (e) => {
    if (!canMove || !drag || drag.type !== 'project' || drag.id === p.id) return
    e.preventDefault(); e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const beforeId = e.clientY - rect.top < rect.height / 2 ? p.id : (projs[projs.findIndex(x => x.id === p.id) + 1]?.id || null)
    onMoveProject(drag.id, currentId, beforeId)
    clearDrag()
  }
  const overFolder = (f) => (e) => {
    if (!canMove || (!drag && !e.dataTransfer.types.includes('text/plain'))) return
    if (drag?.id === f.id) return
    e.preventDefault(); e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const mode = drag?.type === 'folder'
      ? (e.clientY - rect.top < rect.height * 0.3 ? 'before' : e.clientY - rect.top > rect.height * 0.7 ? 'after' : 'into')
      : 'into'
    setDropHint({ key: 'f:' + f.id, mode })
  }
  const dropFolder = (f) => (e) => {
    if (!canMove) return
    const raw = drag?.id ? drag : e.dataTransfer.getData('text/plain').split(':')
    const draggedType = drag?.type || raw[0]
    const draggedId = drag?.id || raw[1]
    if (!draggedId) return
    if (draggedId === f.id) return
    e.preventDefault(); e.stopPropagation()
    if (draggedType === 'folder') onMoveFolder(draggedId, f.id, null)
    else onMoveProject(draggedId, f.id, null)
    clearDrag()
  }
  const dropFolderTarget = (f) => (e) => {
    if (!canMove || !drag || drag.id === f.id) return
    e.preventDefault(); e.stopPropagation()
    if (drag.type === 'project') {
      onMoveProject(drag.id, f.id, null)
      clearDrag()
      return
    }
    if (drag.type !== 'folder') return
    const rect = e.currentTarget.getBoundingClientRect()
    const siblings = childFolders(f.parentId).filter(x => x.id !== drag.id)
    const index = siblings.findIndex(x => x.id === f.id)
    const relativeY = e.clientY - rect.top
    if (relativeY >= rect.height * 0.3 && relativeY <= rect.height * 0.7) {
      onMoveFolder(drag.id, f.id, null)
    } else {
      const beforeId = relativeY < rect.height * 0.3 ? f.id : (siblings[index + 1]?.id || null)
      onMoveFolder(drag.id, f.parentId || null, beforeId)
    }
    clearDrag()
  }
  const overRoot = (e) => {
    if (!canMove || !drag || !currentId) return
    e.preventDefault(); e.stopPropagation(); setDropHint({ key: 'root', mode: 'into' })
  }
  const dropRoot = (e) => {
    if (!canMove || !drag || !currentId) return
    e.preventDefault(); e.stopPropagation()
    if (drag.type === 'folder') onMoveFolder(drag.id, null, null)
    else onMoveProject(drag.id, null, null)
    clearDrag()
  }
  const hintClass = (key) => dropHint?.key === key ? ' drop-' + dropHint.mode : ''

  return (
    <div className="page">
      <div className="sec-head">
        <div>
          <h2>Projetos</h2>
        </div>
        {canCreate && <button className="btn btn-primary" onClick={() => onNew(currentId)}><Icon name="plus" size={17} stroke={2.2} />Novo projeto</button>}
      </div>

      {/* Trilha de navegação: Projetos / Pasta / Subpasta */}
      <nav className="proj-crumbs">
        <button className={'proj-crumb' + hintClass('root')} onClick={() => setOpenId(null)} disabled={!currentId}
          onDragOver={overRoot} onDrop={dropRoot}>
          <Icon name="folder" size={15} />Projetos
        </button>
        {path.map(f => (
          <React.Fragment key={f.id}>
            <Icon name="chevronRight" size={14} style={{ color: 'var(--fg-4)' }} />
            <button className={'proj-crumb' + (dropHint?.key === 'f:' + f.id ? ' drop-into' : '')}
              onClick={() => setOpenId(f.id)} disabled={f.id === currentId}
              onDragEnter={overFolder(f)} onDragOver={overFolder(f)} onDrop={dropFolder(f)}>
              {f.name}
            </button>
          </React.Fragment>
        ))}
      </nav>

      {isEmpty ? (
        <EmptyState icon="folder"
          title={currentId ? 'Pasta vazia' : canCreate ? 'Nenhum projeto ainda' : 'Você ainda não está em nenhum projeto'}
          text={currentId ? 'Esta pasta ainda não tem subpastas nem projetos.'
            : canCreate ? 'Crie seu primeiro projeto para começar a organizar atividades, prazos e responsáveis.'
            : 'Você só enxerga os projetos em que foi incluído. Peça a um administrador para adicionar você.'}
          action={canCreate ? <button className="btn btn-primary" onClick={() => onNew(currentId)}><Icon name="plus" size={17} stroke={2.2} />Novo projeto</button> : null} />
      ) : (
        <>
          {subfolders.length > 0 && (
            <div className="proj-explorer-grid" style={{ marginBottom: projs.length ? 24 : 0 }}>
              {subfolders.map(f => (
                <FolderGridCard key={f.id} folder={f} onNewProject={onNew} onNewSubfolder={onNewSubfolder} onDelete={onDeleteFolder}
                  draggable={canMove} dragging={drag?.type === 'folder' && drag.id === f.id}
                  dropHint={dropHint?.key === 'f:' + f.id ? dropHint.mode : null}
                  onDragStart={startDrag(f.id)} onDragEnd={clearDrag} onDragOver={overFolder(f)} onDrop={dropFolderTarget(f)}
                  subCount={childFolders(f.id).length} projCount={projectsIn(f.id).length}
                  onEnter={setOpenId} />
              ))}
            </div>
          )}
          {projs.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 18 }}>
              {projs.map(p => <ProjectGridCard key={p.id} project={p} tasks={porProjeto.get(p.id) || SEM_ATIVIDADES} authUser={authUser} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete}
                draggable={canMove} dragging={drag?.id === p.id} dropHint={dropHint?.key === 'p:' + p.id ? dropHint.mode : null}
                onDragStart={startDrag(p.id)} onDragEnd={clearDrag} onDragOver={overProject(p)} onDrop={dropProject(p)} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
