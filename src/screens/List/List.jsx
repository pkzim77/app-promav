import './List.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { Avatar, StatusTag, PriorityTag, ChecklistMini } from '../../components/primitives/primitives.jsx'
import { STATUSES, PROJECT_COLORS, fmtShort, effectiveProjectRole, canEditProject } from '../../data/store.js'
// Lista — atividades em formato de tabela, agrupadas por status (estilo ClickUp).

export function TaskListView({ tasks, projects, users, authUser, filterProject, mine, currentUserId, onFilterProject, onToggleMine, onMoveTask, onNewTask, onEditTask }) {
  // Grupos de status recolhidos.
  const [collapsed, setCollapsed] = React.useState(() => new Set())
  const toggle = (id) => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Subtarefas recolhidas (por atividade-mãe). Vazio = todas expandidas.
  const [subCollapsed, setSubCollapsed] = React.useState(() => new Set())
  const toggleSub = (id) => setSubCollapsed(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Arrastar uma atividade para outro grupo muda o status (igual ao Kanban).
  const [draggingId, setDraggingId] = React.useState(null)
  const [overGroup, setOverGroup] = React.useState(null)
  const onDrop = (status) => (e) => {
    e.preventDefault()
    if (draggingId) onMoveTask(draggingId, status)
    setDraggingId(null); setOverGroup(null)
  }

  const projOf = (id) => projects.find(p => p.id === id)
  const userOf = (id) => users.find(u => u.id === id)
  const canCreate = filterProject
    ? canEditProject(effectiveProjectRole(projOf(filterProject), authUser))
    : projects.some(p => canEditProject(effectiveProjectRole(p, authUser)))
  const createProjectId = filterProject || projects.find(p => canEditProject(effectiveProjectRole(p, authUser)))?.id || null

  const stOf = (id) => STATUSES.find(s => s.id === id)

  let visible = tasks
  if (filterProject) visible = visible.filter(t => t.projectId === filterProject)
  if (mine) visible = visible.filter(t => t.assigneeId === currentUserId)

  // Subtarefas visíveis por mãe; e quem é "de topo" na lista (sem mãe visível).
  const visibleIds = new Set(visible.map(t => t.id))
  const childrenOf = (id) => visible.filter(t => t.parentId === id)
  const isTopLevel = (t) => !t.parentId || !visibleIds.has(t.parentId)

  // Uma linha da tabela — serve para a mãe e para a subtarefa (isChild).
  const renderRow = (t, isChild = false) => {
    const u = userOf(t.assigneeId)
    const p = projOf(t.projectId)
    const st = stOf(t.status)
    const kids = isChild ? [] : childrenOf(t.id)   // um nível só
    const expanded = !subCollapsed.has(t.id)
    return (
      <React.Fragment key={t.id}>
        <div className={'lv-row lv-item' + (isChild ? ' lv-sub' : '') + (draggingId === t.id ? ' dragging' : '')}
          draggable={!isChild}
          onDragStart={isChild ? undefined : (e) => { setDraggingId(t.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={isChild ? undefined : () => { setDraggingId(null); setOverGroup(null) }}
          onClick={() => onEditTask(t)}>
          <div className="lv-c-name" style={isChild ? { paddingLeft: 30 } : undefined}>
            {kids.length > 0
              ? <button className="lv-twist" onClick={(e) => { e.stopPropagation(); toggleSub(t.id) }} aria-label={expanded ? 'Recolher' : 'Expandir'}>
                  <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
                </button>
              : <span className="lv-twist-spacer" />}
            <span className="lv-status-dot" style={{ background: st?.color }} />
            <span className="lv-title" title={t.title}>{t.title}</span>
            <ChecklistMini task={t} />
            {kids.length > 0 && <span className="lv-subcount" title="subtarefas">{kids.length}</span>}
            {!isChild && canCreate && (
              <button className="lv-addsub" title="Adicionar subtarefa"
                onClick={(e) => { e.stopPropagation(); onNewTask(t.projectId, undefined, t.id) }}>
                <Icon name="plus" size={13} stroke={2.4} />
              </button>
            )}
          </div>
          <div>{p && <span className="proj-pill" style={{ fontSize: 12 }}><span className="dot" style={{ background: PROJECT_COLORS[p.color] }} />{p.name}</span>}</div>
          <div>{u ? <span className="lv-assignee"><Avatar user={u} size={22} />{u.name.split(' ')[0]}</span> : <span className="lv-empty">—</span>}</div>
          <div>{t.end ? <span className="lv-date"><Icon name="calendar" size={13} />{fmtShort(t.end)}</span> : <span className="lv-empty">—</span>}</div>
          <div><PriorityTag priority={t.priority} /></div>
          <div><StatusTag status={t.status} /></div>
        </div>
        {expanded && kids.map(k => renderRow(k, true))}
      </React.Fragment>
    )
  }

  return (
    <div className="page">
      <div className="sec-head">
        <div><h2>Lista</h2><div className="sub">Todas as atividades em formato de lista, agrupadas por status.</div></div>
        {canCreate && <button className="btn btn-primary" onClick={() => onNewTask(createProjectId)}><Icon name="plus" size={17} stroke={2.2} />Nova atividade</button>}
      </div>
      <div className="filterbar">
        <select className="filter-select" value={filterProject || ''} aria-label="Filtrar por projeto"
          onChange={(e) => onFilterProject(e.target.value || null)}>
          <option value="">Todos os projetos</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
        <button className={'chip' + (mine ? ' active' : '')} onClick={onToggleMine}>
          <Icon name="inbox" size={15} />Minhas tarefas
        </button>
      </div>

      <div className="listview">
        <div className="lv-scroll">
          {/* Cabeçalho das colunas */}
          <div className="lv-row lv-head">
            <div className="lv-c-name">Nome</div>
            <div>Projeto</div>
            <div>Responsável</div>
            <div>Vencimento</div>
            <div>Prioridade</div>
            <div>Status</div>
          </div>

          {STATUSES.map(col => {
            const rows = visible.filter(t => t.status === col.id && isTopLevel(t))
            const open = !collapsed.has(col.id)
            return (
              <div key={col.id} className={'lv-group' + (overGroup === col.id ? ' dragover' : '')}
                onDragOver={(e) => { if (draggingId) { e.preventDefault(); setOverGroup(col.id) } }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setOverGroup(null) }}
                onDrop={onDrop(col.id)}>
                <button className="lv-group-head" onClick={() => toggle(col.id)}>
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} />
                  <span className="lv-group-pill" style={{ background: col.soft, color: col.text }}>
                    <span className="dot" style={{ background: col.color }} />{col.label}
                  </span>
                  <span className="lv-group-count">{rows.length}</span>
                </button>

                {open && (rows.length
                  ? rows.map(t => renderRow(t))
                  : <div className="lv-row lv-empty-row">Nenhuma atividade</div>
                )}

                {open && canCreate && (
                  <button className="lv-add" onClick={() => onNewTask(createProjectId, col.id)}>
                    <Icon name="plus" size={15} stroke={2.2} />Adicionar atividade
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
