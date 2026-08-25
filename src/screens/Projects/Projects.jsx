import './Projects.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { AvatarStack, StatusTag, PriorityTag, ProgressBar } from '../../components/primitives/primitives.jsx'
import { TaskTimerButton } from '../../components/TimeTracker/TimeTracker.jsx'
import { PROJECT_COLORS, STATUSES, projectProgress, taskProgress, checklistStats, taskMembers, fmtShort, fmtMed, fmtFull, dayDiff, parseDate, todayISO, formatBytes, effectiveProjectRole, canEditProject, ROLE_LABEL, RESOURCE_ORIGIN_MAP, PROJECT_STATUS_MAP, formatBRL, calcularProgresso } from '../../data/store.js'
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
    <tr className='task-row-clickable' onClick={() => onEdit(task)}>
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

// Materiais do projeto: documentos/links + imagens. Vive na Ficha técnica.
// (As anotações ficam no Panorama — são o texto que se mostra ao cliente.)
function ProjectAbout({ resources, canDelete, onCopyResource, onDeleteResource, onAddResource }) {
  const list = resources || []
  const docs = list.filter(r => r.type === 'doc')
  const links = list.filter(r => r.type === 'link')
  const images = list.filter(r => r.type === 'image')
  return (
    <div style={{ marginBottom: 22 }}>
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

// Percentual em pt-BR: vírgula decimal e sem o ",0" quando é inteiro.
const pctBR = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

// Fatia de pizza como path SVG. `from`/`to` vão de 0 a 1, começando às 12h.
function pieSlice(cx, cy, r, from, to) {
  if (to - from >= 1) {
    // Círculo inteiro: dois arcos, porque um arco de 360° é degenerado em SVG.
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
  }
  const a0 = from * 2 * Math.PI - Math.PI / 2
  const a1 = to * 2 * Math.PI - Math.PI / 2
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
  const large = to - from > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
}

// Pizza das atividades por situação.
//  • o tamanho da fatia = fatia do projeto que aquele grupo representa (regra de 3);
//  • o número dentro da fatia = essa mesma porcentagem;
//  • ao passar o mouse, a fatia se destaca para fora.
// O texto é tinta escura (contraste ≥ 4.5:1 sobre as três cores de status).
function StatusPie({ slices, size = 180, hovered, onHover }) {
  const total = slices.reduce((s, x) => s + x.share, 0)
  const cx = size / 2, cy = size / 2
  const r = size / 2 - 10 // folga para a fatia elevada não ser cortada

  let acc = 0
  const parts = slices.filter(s => s.share > 0).map(s => {
    const from = acc / total
    acc += s.share
    const to = acc / total
    const a = ((from + to) / 2) * 2 * Math.PI - Math.PI / 2
    return {
      ...s, from, to,
      dx: Math.cos(a) * 7, dy: Math.sin(a) * 7,                 // deslocamento no hover
      lx: cx + Math.cos(a) * r * 0.62, ly: cy + Math.sin(a) * r * 0.62, // posição do número
    }
  })

  return (
    <svg className="cover-pie" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      role="img" onMouseLeave={() => onHover(null)}
      aria-label={total > 0
        ? `Progresso do projeto: ${slices.filter(s => s.share > 0).map(s => `${s.label} ${pctBR(s.share)}`).join(', ')}`
        : 'Nenhuma atividade cadastrada'}>
      {!(total > 0) && <circle cx={cx} cy={cy} r={r} fill="var(--bg-muted)" />}
      {parts.map(s => {
        const on = hovered === s.id
        return (
          <g key={s.id} className={'pie-slice' + (on ? ' on' : '')}
            style={{ transform: on ? `translate(${s.dx}px, ${s.dy}px)` : 'none' }}
            onMouseEnter={() => onHover(s.id)}>
            <path d={pieSlice(cx, cy, r, s.from, s.to)} fill={s.color}
              stroke="var(--surface)" strokeWidth="2" />
            {s.share >= 8 && (
              <text className="pie-label" x={s.lx} y={s.ly} fill={s.ink}
                textAnchor="middle" dominantBaseline="central">
                {pctBR(s.share)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// Soma meses a uma data limitando ao último dia do mês de destino: sem isso,
// 31/01 + 1 mês viraria 03/03 (o Date estoura fevereiro) e a conta se perde.
function addMeses(d, n) {
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), ultimoDia))
}

// Diferença de calendário entre duas datas, em anos/meses/dias reais — não em
// médias de 30 dias, que erram meses cheios e soam falsas num cronograma.
// Conta os meses inteiros que cabem no intervalo e mede o resto em dias.
function diffCalendario(deISO, ateISO) {
  const a = parseDate(deISO), b = parseDate(ateISO)
  if (b <= a) return { anos: 0, meses: 0, dias: 0 }
  let meses = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (addMeses(a, meses) > b) meses-- // passou do destino: recua um mês
  const base = addMeses(a, meses)
  const dias = Math.round((b - base) / 86400000)
  return { anos: Math.floor(meses / 12), meses: meses % 12, dias }
}

// "3 meses e 6 dias", "1 ano e 2 meses", "15 dias". Usa no máximo duas unidades:
// com anos na frente, os dias viram ruído.
function prazoPorExtenso(deISO, ateISO) {
  const { anos, meses, dias } = diffCalendario(deISO, ateISO)
  const un = (n, sing, plur) => `${n} ${n === 1 ? sing : plur}`
  const partes = []
  if (anos > 0) {
    partes.push(un(anos, 'ano', 'anos'))
    if (meses > 0) partes.push(un(meses, 'mês', 'meses'))
  } else if (meses > 0) {
    partes.push(un(meses, 'mês', 'meses'))
    if (dias > 0) partes.push(un(dias, 'dia', 'dias'))
  } else if (dias > 0) {
    partes.push(un(dias, 'dia', 'dias'))
  }
  if (!partes.length) return null // mesma data
  // "Falta 1 dia" / "Faltam 3 meses e 6 dias" — evita concordar "restante(s)".
  const singular = partes.length === 1 && /^1 /.test(partes[0])
  return { texto: partes.join(' e '), singular }
}

// Cronograma: quanto do prazo já passou contra quanto do projeto foi executado.
// É a leitura que importa numa reunião — 60% executado com 80% do prazo
// consumido é atraso, mesmo o número de progresso parecendo bom sozinho.
function Cronograma({ start, end, executado }) {
  if (!start || !end) return null
  const hoje = todayISO()
  const totalDias = dayDiff(start, end)
  if (totalDias <= 0) return null

  const decorridos = Math.min(Math.max(dayDiff(start, hoje), 0), totalDias)
  const prazoPct = Math.round((decorridos / totalDias) * 100)
  const restam = totalDias - decorridos
  const folga = Math.round(executado - prazoPct) // positivo = adiantado

  // Antes do início e depois do fim o comparativo não faz sentido.
  const naoComecou = parseDate(hoje) < parseDate(start)
  const terminou = parseDate(hoje) > parseDate(end)

  const situacao =
    naoComecou ? { label: 'Ainda não iniciado', cor: 'var(--fg-3)', fundo: 'var(--bg-muted)' }
    : folga >= 0 ? { label: 'Dentro do prazo', cor: 'var(--success)', fundo: 'var(--success-soft)' }
    : folga >= -10 ? { label: 'Atenção ao prazo', cor: '#A8680A', fundo: '#FDF2E2' }
    : { label: 'Atrasado', cor: 'var(--danger)', fundo: 'var(--danger-soft, #FDECEC)' }

  return (
    <div className="card crono">
      <div className="crono-head">
        <span className="cover-eyebrow" style={{ margin: 0 }}>Cronograma</span>
        <span className="crono-tag" style={{ color: situacao.cor, background: situacao.fundo }}>
          {situacao.label}
        </span>
      </div>

      {/* Só o prazo. O selo acima continua comparando com o percentual
          executado — a execução em si já é o número grande do topo. */}
      <div className="crono-bars">
        <div className="crono-row">
          <span className="crono-lab">Prazo decorrido</span>
          <div className="crono-track">
            <span className="crono-fill prazo" style={{ width: `${prazoPct}%` }} />
          </div>
          <span className="crono-val">{prazoPct}%</span>
        </div>
      </div>

      <div className="crono-foot">
        <span><Icon name="calendar" size={14} />{fmtFull(start)}</span>
        {/* Prazo por extenso; o número exato de dias fica no title, para quem
            precisar da precisão sem poluir a leitura. */}
        <span className="crono-foot-mid" title={`${restam} ${restam === 1 ? 'dia' : 'dias'}`}>
          {(() => {
            if (naoComecou) {
              const p = prazoPorExtenso(hoje, start)
              return p ? `Começa em ${p.texto}` : 'Começa hoje'
            }
            if (terminou) {
              const p = prazoPorExtenso(end, hoje)
              return p ? `Prazo encerrado há ${p.texto}` : 'Prazo encerrado hoje'
            }
            const p = prazoPorExtenso(hoje, end)
            if (!p) return 'Último dia do prazo'
            return `${p.singular ? 'Falta' : 'Faltam'} ${p.texto}`
          })()}
        </span>
        <span>{fmtFull(end)}<Icon name="flag" size={14} /></span>
      </div>
    </div>
  )
}

// Ficha técnica — aba de trabalho da equipe: o detalhamento que sustenta o
// Panorama (identificação da obra, convênio, medições) e todos os materiais.
// A seção de identificação ainda não tem campos definidos; quando existirem,
// entram no mesmo padrão do bloco `tech-grid` abaixo.
function ProjectTechSheet({ project, canEdit, onCopyResource, onDeleteResource, onAddResource }) {
  return (
    <div className="proj-tech">
      <div className="card tech-section">
        <div className="tech-section-head">
          <span className="fact-ic"><Icon name="file" size={18} /></span>
          <div>
            <h3>Identificação da obra</h3>
            <p>Dados contratuais e técnicos que não aparecem no Panorama.</p>
          </div>
        </div>
        <div className="tech-empty">
          <Icon name="sparkles" size={18} />
          <div>
            <strong>Campos ainda não definidos</strong>
            <p>Aqui entram os dados técnicos do convênio — número, processo, objeto,
              área de intervenção, contrapartida, vigência e responsabilidade técnica.
              Assim que a lista for fechada, eles passam a ser preenchidos no cadastro do projeto.</p>
          </div>
        </div>
      </div>

      <ProjectAbout resources={project.resources} canDelete={canEdit}
        onCopyResource={onCopyResource} onDeleteResource={onDeleteResource} onAddResource={onAddResource} />
    </div>
  )
}

// Panorama — primeira aba, pensada para ser projetada numa reunião:
// progresso do projeto em destaque + a ficha do cadastro em blocos legíveis.
function ProjectCover({ project, tasks, users }) {
  const list = tasks.filter(t => t.projectId === project.id)
  const origem = RESOURCE_ORIGIN_MAP[project.origemRecurso]
  const st = PROJECT_STATUS_MAP[project.status] || PROJECT_STATUS_MAP.planejamento
  const responsibles = (project.responsibleIds || []).map(id => users.find(u => u.id === id)).filter(Boolean)
  const dash = (v) => (v && String(v).trim() ? v : '—')
  const [hovered, setHovered] = React.useState(null)

  // src/data/progresso.js: toda atividade pesa igual (100/N) e a fatia vem do
  // status — checklist 100% marcado promove para Concluído. O percentual grande
  // é o `executado`, que conta só a parte do checklist já marcada nas demais.
  // Recalcula sozinho a cada marcação, porque `tasks` vem do estado do App.
  const prog = calcularProgresso(list)
  const pct = Math.round(prog.executado)
  // `ink` é a cor do número dentro da fatia. Nenhuma tinta única passa em
  // contraste sobre as três cores da marca, então cada fatia leva a que a atende:
  // cinza 6,66:1 no branco · dourado 6,57:1 no preto · verde 5,03:1 no branco.
  const breakdown = [
    { id: 'aFazer', label: 'A fazer', color: 'var(--chart-todo)', ink: '#fff', share: prog.aFazer,
      hint: 'das atividades ainda não iniciadas' },
    { id: 'emAndamento', label: 'Em andamento', color: 'var(--chart-doing)', ink: '#000', share: prog.emAndamento,
      hint: 'das atividades em execução — a barra grande conta só o que já foi marcado nelas' },
    { id: 'concluido', label: 'Concluído', color: 'var(--chart-done)', ink: '#fff', share: prog.concluido,
      hint: 'das atividades finalizadas — status Concluído ou checklist inteiro marcado' },
  ]
  const detail = breakdown.find(s => s.id === hovered) || null
  const dias = project.start && project.end ? dayDiff(project.start, project.end) : null

  return (
    <div className="proj-cover">
      {/* ---- Faixa de destaque: progresso + valor + status ---- */}
      <div className="card cover-hero">
        <StatusPie slices={breakdown} hovered={hovered} onHover={setHovered} />

        <div className="cover-hero-main">
          <span className="cover-eyebrow">Progresso do projeto</span>
          <span className="cover-pct">{pct}<i>%</i></span>
          <span className="cover-pct-sub">executado</span>
          {/* A legenda nomeia as fatias e abre a conta: quanto do projeto cada
              situação ocupa, quanto dela já foi executado e o que isso soma. */}
          <div className="cover-breakdown">
            {breakdown.map(s => (
              <div key={s.id}
                className={'cover-bd-item' + (hovered === s.id ? ' on' : '') + (s.share ? '' : ' off')}
                onMouseEnter={() => setHovered(s.share ? s.id : null)}
                onMouseLeave={() => setHovered(null)}>
                <span className="cover-bd-dot" style={{ background: s.color }} />
                <span className="cover-bd-lab">{s.label}</span>
                <span className="cover-bd-share">{pctBR(s.share)}</span>
              </div>
            ))}
          </div>
          {/* Altura reservada: o texto troca no hover sem empurrar o layout. */}
          <div className="cover-bd-detail">
            {detail
              ? <><strong>{pctBR(detail.share)}</strong> {detail.hint}.</>
              : prog.total > 0
                ? <span className="muted">Passe o mouse sobre uma fatia para ver o que ela representa.</span>
                : <span className="muted">Nenhuma atividade cadastrada ainda.</span>}
          </div>
        </div>

        <div className="cover-hero-side">
          <div className="cover-money">
            <span className="cover-eyebrow">Valor estimado</span>
            <strong>{formatBRL(project.valorEstimado)}</strong>
          </div>
          <div className="cover-money alt">
            <span className="cover-eyebrow">Valor orçado</span>
            <strong>{formatBRL(project.valorOrcado)}</strong>
            {origem && <span className="cover-money-sub">{origem.label}</span>}
          </div>
          <span className="proj-status-badge lg" style={{ color: st.color, background: st.color + '1f' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.color }} />{st.label}
          </span>
        </div>
      </div>

      <Cronograma start={project.start} end={project.end} executado={prog.executado} />

      {/* ---- Ficha do cadastro ---- */}
      <div className="cover-facts">
        <div className="card fact">
          <span className="fact-ic"><Icon name="landmark" size={18} /></span>
          <div>
            <label>Prefeitura</label>
            <div className="fact-value">{dash(project.prefeitura)}</div>
            {project.secretaria && <div className="fact-sub">Secretaria de {project.secretaria}</div>}
          </div>
        </div>
        <div className="card fact">
          <span className="fact-ic"><Icon name="banknote" size={18} /></span>
          <div>
            <label>Origem do recurso</label>
            <div className="fact-value">{origem ? origem.label : '—'}</div>
          </div>
        </div>
        <div className="card fact">
          <span className="fact-ic"><Icon name="users" size={18} /></span>
          <div style={{ minWidth: 0 }}>
            <label>Profissionais responsáveis</label>
            {responsibles.length === 0 ? (
              <div className="fact-sub" style={{ marginTop: 2 }}>Nenhum definido. Edite o projeto para incluir.</div>
            ) : (
              <div className="ds-people">
                {responsibles.map(u => (
                  <span className="ds-person" key={u.id} title={u.name}>
                    <span className="av" style={{ width: 24, height: 24, background: u.color, fontSize: 9 }}>{u.initials}</span>
                    {u.name.split(' ')[0]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- Responsáveis ---- */}
      {/* ---- Observações ---- */}
      {project.notes && (
        <div className="card cover-block">
          <h3>Observações</h3>
          <NotesText text={project.notes} />
        </div>
      )}
    </div>
  )
}

export function ProjectDetail({ project, tasks, users, sessions, currentUserId, now, canEdit = true, role, onStartTimer, onStopTimer, onBack, onEdit, onNewTask, onEditTask, onDeleteTask, onCopyResource, onDeleteResource, onAddResource }) {
  // O Panorama abre primeiro: é o que se mostra numa reunião com o cliente.
  const [tab, setTab] = React.useState('panorama') // 'panorama' | 'tecnica' | 'atividades'
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
        {canEdit && <button className="btn btn-secondary" onClick={() => onEdit(project)}><Icon name="pencil" size={16} />Editar</button>}
        {canEdit && <button className="btn btn-primary" onClick={() => onNewTask(project.id)}><Icon name="plus" size={17} stroke={2.2} />Nova atividade</button>}
      </div>

      {/* Abas: Panorama (cliente) → Ficha técnica (equipe) → Atividades. */}
      <div className="proj-tabs">
        <button className={'proj-tab' + (tab === 'panorama' ? ' on' : '')} onClick={() => setTab('panorama')}>
          <Icon name="landmark" size={15} />Panorama
        </button>
        <button className={'proj-tab' + (tab === 'tecnica' ? ' on' : '')} onClick={() => setTab('tecnica')}>
          <Icon name="file" size={15} />Ficha técnica
        </button>
        <button className={'proj-tab' + (tab === 'atividades' ? ' on' : '')} onClick={() => setTab('atividades')}>
          <Icon name="list" size={15} />Atividades
        </button>
      </div>

      {tab === 'panorama' ? (
        <ProjectCover project={project} tasks={tasks} users={users} />
      ) : tab === 'tecnica' ? (
        <ProjectTechSheet project={project} canEdit={canEdit}
          onCopyResource={onCopyResource} onDeleteResource={onDeleteResource} onAddResource={onAddResource} />
      ) : (
      <>
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
      </>
      )}
    </div>
  )
}
