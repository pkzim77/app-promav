import './Projects.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { AvatarStack, StatusTag, PriorityTag, ProgressBar } from '../../components/primitives/primitives.jsx'
import { TaskTimerButton } from '../../components/TimeTracker/TimeTracker.jsx'
import { PROJECT_COLORS, projectProgress, taskProgress, checklistStats, taskMembers, fmtShort, fmtMed, formatBytes, effectiveProjectRole, canEditProject, ROLE_LABEL } from '../../data/store.js'
import { api } from '../../data/api.js'
// Projetos — grid of project cards, and a project detail view with task table.

function ProjectGridCard({ project, tasks, authUser, onOpen, onEdit, onDelete }) {
  const pct = projectProgress(tasks, project.id)
  const count = tasks.filter(t => t.projectId === project.id).length
  const color = PROJECT_COLORS[project.color]
  const role = effectiveProjectRole(project, authUser)
  const canEdit = canEditProject(role)
  const canDelete = role === 'admin'
  return (
    // O card inteiro abre o projeto; os botões de ação param a propagação.
    <div className="card proj-card" role="button" tabIndex={0} title={project.name}
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

// Card de uma pasta na tela de Projetos: entra na pasta ao clicar.
function FolderGridCard({ folder, subCount, projCount, onEnter }) {
  const parts = []
  if (subCount) parts.push(`${subCount} ${subCount > 1 ? 'pastas' : 'pasta'}`)
  parts.push(`${projCount} ${projCount === 1 ? 'projeto' : 'projetos'}`)
  return (
    <button className="card proj-folder-card" onClick={() => onEnter(folder.id)} title={folder.name}>
      <span className="proj-folder-ic"><Icon name="folder" size={28} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="proj-folder-name">{folder.name}</div>
        <div className="proj-folder-meta">{parts.join(' · ')}</div>
      </div>
      <Icon name="chevronRight" size={20} style={{ color: 'var(--fg-4)', flexShrink: 0 }} />
    </button>
  )
}

export function ProjectList({ projects, tasks, folders = [], authUser, canCreate = true, onOpen, onEdit, onDelete, onNew }) {
  const [openId, setOpenId] = React.useState(null) // pasta aberta (null = raiz)

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
        <button className="proj-crumb" onClick={() => setOpenId(null)} disabled={!currentId}>
          <Icon name="folder" size={15} />Projetos
        </button>
        {path.map(f => (
          <React.Fragment key={f.id}>
            <Icon name="chevronRight" size={14} style={{ color: 'var(--fg-4)' }} />
            <button className="proj-crumb" onClick={() => setOpenId(f.id)} disabled={f.id === currentId}>{f.name}</button>
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
                <FolderGridCard key={f.id} folder={f}
                  subCount={childFolders(f.id).length} projCount={projectsIn(f.id).length}
                  onEnter={setOpenId} />
              ))}
            </div>
          )}
          {projs.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 18 }}>
              {projs.map(p => <ProjectGridCard key={p.id} project={p} tasks={tasks} authUser={authUser} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="card empty">
      <div className="ic"><Icon name={icon} size={26} stroke={1.9} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

function TaskRow({ task, members, sessions, currentUserId, now, canEdit, onStartTimer, onStopTimer, onEdit, onDelete }) {
  const resp = members[0]
  return (
    <tr>
      <td style={{ width: '28%' }}><button className="task-title task-title-btn" onClick={() => onEdit(task)}>{task.title}</button></td>
      <td><StatusTag status={task.status} /></td>
      <td><PriorityTag priority={task.priority} /></td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AvatarStack users={members} size={24} max={4} />
          <span style={{ fontSize: 13 }}>{resp ? resp.name.split(' ')[0] : '—'}{members.length > 1 ? ` +${members.length - 1}` : ''}</span>
        </div>
      </td>
      <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--fg-3)' }}>{fmtShort(task.start)}–{fmtShort(task.end)}</span></td>
      <td style={{ width: 120 }}>
        {task.checklist && task.checklist.length
          ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="progress" style={{ width: 56 }}><div style={{ width: taskProgress(task) + '%', background: taskProgress(task) === 100 ? 'var(--success)' : 'var(--brand)' }} /></div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)' }}>{checklistStats(task).done}/{checklistStats(task).total}</span>
            </div>
          : <span style={{ fontSize: 12.5, color: 'var(--fg-4)' }}>—</span>}
      </td>
      <td style={{ width: 96 }}>
        <TaskTimerButton task={task} sessions={sessions} currentUserId={currentUserId} now={now} onStart={onStartTimer} onStop={onStopTimer} />
      </td>
      <td style={{ width: 70 }}>
        <div className="row-actions">
          <button className="btn-icon" onClick={() => onEdit(task)} aria-label={canEdit ? 'Editar' : 'Ver'}><Icon name={canEdit ? 'pencil' : 'externalLink'} size={15} /></button>
          {canEdit && <button className="btn-icon" onClick={() => onDelete(task)} aria-label="Excluir"><Icon name="trash" size={15} /></button>}
        </div>
      </td>
    </tr>
  )
}

// Texto livre → parágrafos com quebras de linha e URLs clicáveis.
function NotesText({ text }) {
  const splitRe = /(https?:\/\/[^\s]+)/g
  const isUrl = (s) => /^https?:\/\//.test(s)
  return (
    <div className="proj-notes">
      {text.split('\n').map((line, i) => (
        <p key={i}>
          {line.split(splitRe).map((part, j) =>
            isUrl(part)
              ? <a key={j} href={part} target="_blank" rel="noreferrer">{part}</a>
              : part
          )}
        </p>
      ))}
    </div>
  )
}

// Mostra a "origem" (domínio) de uma URL — útil como subtítulo do link.
function urlHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// URL para abrir/baixar um recurso: arquivo do banco (via fileId) ou link externo.
function resourceUrl(r) {
  return r.fileId ? api.fileUrl(r.fileId) : r.url
}
// Título e subtítulo a exibir para um documento/imagem (arquivo enviado ou link).
function resourceTitle(r) {
  return r.label || r.filename || urlHost(r.url || '')
}
function resourceSub(r) {
  return r.fileId ? formatBytes(r.size) : urlHost(r.url || '')
}

// Menu de 3 pontinhos no canto de cada documento/link: copiar link ou excluir.
function ResourceMenu({ resource, onCopy, onDelete, canDelete = true }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  // Os itens ficam dentro de um <a>, então impedimos navegação ao interagir com o menu.
  const stop = (e) => { e.preventDefault(); e.stopPropagation() }
  return (
    <div className="res-menu-wrap" ref={ref} onClick={stop}>
      <button className={'res-menu-btn' + (open ? ' on' : '')} onClick={(e) => { stop(e); setOpen(o => !o) }} title="Opções" aria-label="Opções">
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={(e) => { stop(e); setOpen(false); onCopy(resource) }}>
            <Icon name="copy" size={16} />Copiar link
          </button>
          {canDelete && (
            <button className="menu-item danger" onClick={(e) => { stop(e); setOpen(false); onDelete(resource) }}>
              <Icon name="trash" size={16} />Excluir
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Botão "+" no cabeçalho da coluna para adicionar um novo documento/link.
function ColAddButton({ label, onClick }) {
  return (
    <button className="res-col-add" onClick={onClick} title={label} aria-label={label}>
      <Icon name="plus" size={16} stroke={2.4} />
    </button>
  )
}

// Coluna de documentos: cada doc é uma linha com ícone + nome.
function DocsColumn({ docs, onCopy, onDelete, onAdd, canDelete }) {
  return (
    <div className="res-col card">
      <div className="res-col-head">
        <Icon name="file" size={16} /><h3>Documentos</h3>
        <span className="res-col-count">{docs.length}</span>
        <ColAddButton label="Adicionar documento" onClick={() => onAdd('doc')} />
      </div>
      {docs.length === 0 ? (
        <p className="res-col-empty">Nenhum documento ainda.</p>
      ) : (
        <div className="doc-list">
          {docs.map(r => (
            <a key={r.id} className="doc-row" href={resourceUrl(r)} target="_blank" rel="noreferrer">
              <span className="doc-ic"><Icon name="file" size={17} /></span>
              <span className="doc-info">
                <span className="doc-name">{resourceTitle(r)}</span>
                <span className="doc-sub">{resourceSub(r)}</span>
              </span>
              <Icon name="externalLink" size={14} className="doc-open" />
              <ResourceMenu resource={r} onCopy={onCopy} onDelete={onDelete} canDelete={canDelete} />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// Coluna de links/bookmarks: cada link é um cartão clicável.
function LinksColumn({ links, onCopy, onDelete, onAdd, canDelete }) {
  return (
    <div className="res-col card">
      <div className="res-col-head">
        <Icon name="link" size={16} /><h3>Links</h3>
        <span className="res-col-count">{links.length}</span>
        <ColAddButton label="Adicionar link" onClick={() => onAdd('link')} />
      </div>
      {links.length === 0 ? (
        <p className="res-col-empty">Nenhum link ainda.</p>
      ) : (
        <div className="bookmark-list">
          {links.map(r => (
            <a key={r.id} className="bookmark" href={r.url} target="_blank" rel="noreferrer">
              <span className="bookmark-ic"><Icon name="link" size={16} /></span>
              <span className="bookmark-info">
                <span className="bookmark-title">{r.label || urlHost(r.url)}</span>
                <span className="bookmark-url">{r.url}</span>
              </span>
              <ResourceMenu resource={r} onCopy={onCopy} onDelete={onDelete} canDelete={canDelete} />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// Painel do projeto: anotações + documentos/links + imagens.
function ProjectAbout({ notes, resources, canDelete, onCopyResource, onDeleteResource, onAddResource }) {
  const list = resources || []
  const docs = list.filter(r => r.type === 'doc')
  const links = list.filter(r => r.type === 'link')
  const images = list.filter(r => r.type === 'image')
  return (
    <div style={{ marginBottom: 22 }}>
      {notes && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h3 style={{ font: 'var(--text-h4)', margin: '0 0 14px', color: 'var(--fg-1)' }}>Sobre o projeto</h3>
          <NotesText text={notes} />
        </div>
      )}

      <div className="res-grid">
        <DocsColumn docs={docs} onCopy={onCopyResource} onDelete={onDeleteResource} onAdd={onAddResource} canDelete={canDelete} />
        <LinksColumn links={links} onCopy={onCopyResource} onDelete={onDeleteResource} onAdd={onAddResource} canDelete={canDelete} />
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <h3 style={{ font: 'var(--text-h4)', margin: 0, color: 'var(--fg-1)' }}>Imagens</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="res-col-count">{images.length}</span>
            <ColAddButton label="Adicionar imagem" onClick={() => onAddResource('image')} />
          </div>
        </div>
        {images.length === 0 ? (
          <p className="res-col-empty">Nenhuma imagem ainda.</p>
        ) : (
          <div className="res-gallery">
            {images.map(r => (
              <a key={r.id} className="res-thumb" href={resourceUrl(r)} target="_blank" rel="noreferrer" title={r.label || r.filename || ''}>
                <img src={resourceUrl(r)} alt={r.label || r.filename || ''} loading="lazy" />
                {r.label && <span className="res-thumb-cap">{r.label}</span>}
                {canDelete && (
                  <button type="button" className="res-thumb-del"
                    title="Excluir imagem" aria-label="Excluir imagem"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteResource(r) }}>
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ProjectDetail({ project, tasks, users, sessions, currentUserId, now, canEdit = true, role, onStartTimer, onStopTimer, onBack, onEdit, onNewTask, onEditTask, onDeleteTask, onCopyResource, onDeleteResource, onAddResource }) {
  const list = tasks.filter(t => t.projectId === project.id)
  const pct = projectProgress(tasks, project.id)
  const color = PROJECT_COLORS[project.color]
  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 16, marginLeft: -8 }}>
        <Icon name="chevronLeft" size={16} />Projetos
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
        <span style={{ width: 46, height: 46, borderRadius: 'var(--r-lg)', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ font: 'var(--text-h1)', margin: 0, letterSpacing: 'var(--tracking-tight)', overflowWrap: 'anywhere' }}>{project.name}</h1>
          <p style={{ fontSize: 14, color: 'var(--fg-3)', margin: '5px 0 0' }}>{project.desc}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-3)', marginTop: 10 }}>
            <Icon name="calendar" size={15} />{fmtMed(project.start)} — {fmtMed(project.end)}
          </div>
        </div>
        {role && role !== 'admin' && (
          <span className="role-badge" title="Seu acesso neste projeto">{ROLE_LABEL[role]}</span>
        )}
        {canEdit && <button className="btn btn-secondary" onClick={() => onEdit(project)}><Icon name="pencil" size={16} />Editar</button>}
        {canEdit && <button className="btn btn-primary" onClick={() => onNewTask(project.id)}><Icon name="plus" size={17} stroke={2.2} />Nova atividade</button>}
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 22, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>Progresso do projeto</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: 'var(--fg-1)' }}>{pct}%</span>
          </div>
          <ProgressBar value={pct} color={color} />
        </div>
        <div style={{ display: 'flex', gap: 24, paddingLeft: 20, borderLeft: '1px solid var(--border)' }}>
          {['todo','progress','done'].map(s => (
            <div key={s} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)' }}>{list.filter(t => t.status === s).length}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>{{ todo: 'A fazer', progress: 'Em and.', done: 'Concluído' }[s]}</div>
            </div>
          ))}
        </div>
      </div>

      <ProjectAbout notes={project.notes} resources={project.resources} canDelete={canEdit} onCopyResource={onCopyResource} onDeleteResource={onDeleteResource} onAddResource={onAddResource} />

      {list.length === 0 ? (
        <EmptyState icon="list" title="Nenhuma atividade por aqui ainda"
          text="Crie a primeira atividade para começar a acompanhar o progresso deste projeto."
          action={canEdit ? <button className="btn btn-primary" onClick={() => onNewTask(project.id)}><Icon name="plus" size={17} stroke={2.2} />Adicionar atividade</button> : null} />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tasktable">
            <thead><tr><th>Atividade</th><th>Status</th><th>Prioridade</th><th>Responsável</th><th>Datas</th><th>Checklist</th><th>Tempo</th><th></th></tr></thead>
            <tbody>
              {list.map(t => <TaskRow key={t.id} task={t} members={taskMembers(t).map(id => users.find(u => u.id === id))} sessions={sessions} currentUserId={currentUserId} now={now} canEdit={canEdit} onStartTimer={onStartTimer} onStopTimer={onStopTimer} onEdit={onEditTask} onDelete={onDeleteTask} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
