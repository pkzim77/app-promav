import './Chrome.css'
import React from 'react'
import { Icon } from '../Icon.jsx'
import { Logo } from '../Logo/Logo.jsx'
import { Avatar, useFecharFora } from '../primitives/primitives.jsx'
import { TimeClock } from '../TimeTracker/TimeTracker.jsx'
import { PROJECT_COLORS, NOTIF_KINDS, NOTIF_KIND_MAP } from '../../data/store.js'
// App chrome: left sidebar + top bar with search and user selector.

// Menu de "três pontinhos" de uma pasta: novo projeto, nova subpasta, mover
// para cima/baixo, renomear e excluir. Aparece com o mouse na pasta e, no
// toque, fica sempre visível (não há hover para revelá-lo).
function FolderMenu({ folder, onNewProject, onNewSubfolder, onRename, onDelete, onMoveUp, onMoveDown }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  useFecharFora(ref, () => setOpen(false), open)
  return (
    <div className={'sb-folder-menu' + (open ? ' open' : '')} ref={ref}>
      <button className="sb-folder-menu-btn" title="Opções da pasta" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
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
          {onMoveUp && (
            <button className="menu-item" onClick={() => { setOpen(false); onMoveUp() }}>
              <Icon name="chevronUp" size={16} />Mover para cima
            </button>
          )}
          {onMoveDown && (
            <button className="menu-item" onClick={() => { setOpen(false); onMoveDown() }}>
              <Icon name="chevronDown" size={16} />Mover para baixo
            </button>
          )}
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

// Menu de "três pontinhos" de um projeto: mover para cima/baixo, renomear,
// editar e excluir. Mover existe porque arrastar não funciona no toque.
function ProjectMenu({ project, onRename, onEdit, onDelete, onMoveUp, onMoveDown }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  useFecharFora(ref, () => setOpen(false), open)
  return (
    <div className={'sb-folder-menu' + (open ? ' open' : '')} ref={ref}>
      <button className="sb-folder-menu-btn" title="Opções do projeto" aria-expanded={open} aria-haspopup="true"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}>
        <Icon name="more" size={17} />
      </button>
      {open && (
        <div className="menu">
          {onMoveUp && (
            <button className="menu-item" onClick={(e) => { e.stopPropagation(); setOpen(false); onMoveUp() }}>
              <Icon name="chevronUp" size={16} />Mover para cima
            </button>
          )}
          {onMoveDown && (
            <button className="menu-item" onClick={(e) => { e.stopPropagation(); setOpen(false); onMoveDown() }}>
              <Icon name="chevronDown" size={16} />Mover para baixo
            </button>
          )}
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

export function Sidebar({ route, onNavigate, projects, folders = [], isAdmin = false, collapsed: navCollapsed = false, mobileOpen = false, onToggleCollapse, onCloseMobile, onNewFolder, onRenameFolder, onDeleteFolder, onNewProjectInFolder, onMoveFolder, onMoveProject, onRenameProject, onEditProject, onDeleteProject }) {
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
    // key e mode saem do evento ANTES do set: o React zera currentTarget ao
    // fim do listener. Devolver o mesmo objeto quando nada mudou poupa a
    // sidebar de re-renderizar nas dezenas de dragover por segundo.
    const key = 'f:' + f.id, mode = folderMode(e, e.currentTarget)
    setHint(h => (h && h.key === key && h.mode === mode) ? h : { key, mode })
  }
  const overProj = (p) => (e) => {
    if (!isAdmin || drag?.type !== 'project' || drag.id === p.id) return
    e.preventDefault(); e.stopPropagation()
    const key = 'p:' + p.id, mode = projMode(e, e.currentTarget)
    setHint(h => (h && h.key === key && h.mode === mode) ? h : { key, mode })
  }
  const overRoot = (e) => { if (!isAdmin || !drag) return; e.preventDefault(); setHint(h => (h && h.key === 'root' && h.mode === 'into') ? h : { key: 'root', mode: 'into' }) }

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

  // "Mover para cima/baixo" dentro do grupo que está na tela. É a única forma
  // de reordenar sem arrastar, e arrastar não existe no toque: nem o Safari do
  // iPadOS nem o Chrome do Android disparam eventos de drag a partir do dedo.
  // `lista` é exatamente o grupo renderizado, então o que se vê é o que move.
  // Devolve null quando o item já está na ponta, e o menu omite a opção.
  const movimentos = (lista, id, mover, destino) => {
    const i = lista.findIndex(x => x.id === id)
    return {
      onMoveUp: i > 0 ? () => mover(id, destino, lista[i - 1].id) : null,
      // O alvo é quem vem DEPOIS do próximo: é isso que põe o item entre os
      // dois. Sem ninguém depois, o null manda para o fim da lista.
      onMoveDown: i >= 0 && i < lista.length - 1 ? () => mover(id, destino, lista[i + 2]?.id || null) : null,
    }
  }

  // Navegar sempre fecha o menu no celular (drawer).
  const go = (r) => { onNavigate(r); onCloseMobile && onCloseMobile() }

  const nav = [
    { id: 'hub', label: 'Visão geral', icon: 'hub' },
    ...(isAdmin ? [{ id: 'people', label: 'Profissionais', icon: 'users' }] : []),
    // O admin tem um item só: os três relatórios viram abas dentro dele. Quem
    // não é admin segue com os itens soltos, porque "Meu relatório" é tela de
    // escrever o próprio, não de consultar os outros — não é o mesmo grupo.
    // (Quem escreve vê o próprio; quem recebe vê o de todo mundo. São telas
    // diferentes de verdade, não a mesma com permissão diferente.)
    ...(isAdmin
      ? [{ id: 'relatorios', label: 'Relatórios', icon: 'trendingUp' }]
      : [
          { id: 'reports', label: 'Relatórios dos projetos', icon: 'trendingUp' },
          { id: 'team', label: 'Relatórios da equipe', icon: 'users' },
          { id: 'myreport', label: 'Meu relatório', icon: 'file' },
        ]),
  ]

  // Um botão de projeto, reutilizado dentro e fora das pastas. O clique abre a
  // tela do projeto (Panorama), não a lista de tarefas filtrada por ele — a
  // lista continua a um clique, nas visões do próprio projeto.
  const projItem = (p, irmaos = [], pastaId = null) => (
    <div key={p.id}
      className={'sb-proj-row' + (drag?.id === p.id ? ' dragging' : '') + hintClass('p:' + p.id)}
      draggable={isAdmin}
      onDragStart={(e) => { setDrag({ type: 'project', id: p.id }); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={clearDrag}
      onDragOver={overProj(p)}
      onDrop={dropProj(p)}>
      <button className={'sb-proj' + (route.projectId === p.id ? ' active' : '')} title={p.name}
        onClick={() => go({ view: 'projects', projectId: p.id })}>
        <Icon name="list" size={16} style={{ color: PROJECT_COLORS[p.color], flexShrink: 0 }} />
        <span className="sb-proj-name" title={p.name}>{p.name}</span>
      </button>
      {isAdmin && <ProjectMenu project={p} onRename={onRenameProject} onEdit={onEditProject} onDelete={onDeleteProject}
        {...movimentos(irmaos, p.id, onMoveProject, pastaId)} />}
    </div>
  )

  // Projetos sem pasta (ou cuja pasta não existe mais) aparecem soltos no fim.
  const folderIds = new Set(folders.map(f => f.id))
  const loose = projects.filter(p => !p.folderId || !folderIds.has(p.folderId))

  // Subpastas de cada pasta (pai). Pastas raiz têm parentId nulo (ou pai inexistente).
  const childrenOf = (parentId) => folders.filter(f =>
    parentId == null ? (!f.parentId || !folderIds.has(f.parentId)) : f.parentId === parentId)

  // Guardado em variável porque a lista é passada a cada pasta raiz: é o grupo
  // dentro do qual "mover para cima/baixo" procura o vizinho.
  const pastasRaiz = childrenOf(null)

  // Renderiza uma pasta com seus projetos e suas subpastas (aninhamento ilimitado).
  const renderFolder = (f, depth = 0, irmaos = [], paiId = null) => {
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
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} />
            <Icon name="folder" size={16} />
            <span className="sb-folder-name" title={f.name}>{f.name}</span>
          </button>
          {isAdmin && (
            <FolderMenu folder={f} onNewProject={onNewProjectInFolder} onNewSubfolder={onNewFolder}
              onRename={onRenameFolder} onDelete={onDeleteFolder}
              {...movimentos(irmaos, f.id, onMoveFolder, paiId)} />
          )}
        </div>
        {open && (
          <div className="sb-folder-body">
            {subfolders.map(sf => renderFolder(sf, depth + 1, subfolders, f.id))}
            {inside.length ? inside.map(p => projItem(p, inside, f.id))
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
        <button key={n.id} className={'sb-item' + (route.view === n.id ? ' active' : '')} title={n.label}
          aria-current={route.view === n.id ? 'page' : undefined} onClick={() => go({ view: n.id })}>
          <Icon name={n.icon} size={19} /><span className="sb-label">{n.label}</span>
        </button>
      ))}

      <div className="sb-section">
        <span>Projetos</span>
        {isAdmin && (
          <button className="sb-section-btn" title="Nova pasta" onClick={onNewFolder}>
            <Icon name="plus" size={15} stroke={2.4} />
          </button>
        )}
      </div>

      {pastasRaiz.map(f => renderFolder(f, 0, pastasRaiz, null))}

      {loose.map(p => projItem(p, loose, null))}

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
export function UserMenu({ user, onChangePassword, onMySector, onLogout }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  useFecharFora(ref, () => setOpen(false), open)
  if (!user) return null
  return (
    <div className="userselect" ref={ref}>
      <button className="userselect-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
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
          {onMySector && (
            <button className="menu-item" onClick={() => { setOpen(false); onMySector() }}>
              <Icon name="users" size={17} />Meu setor
            </button>
          )}
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

export function NewsPanel({ open, items = [], readIds = new Set(), onClose, onMarkRead, onMarkAllRead, onOpenNotification, onDismiss, onDismissAll, avisos = { som: true, navegador: false }, onToggleSom, onToggleNavegador }) {
  const [filter, setFilter] = React.useState('all')

  // Foco entra no X ao abrir e volta ao sino ao fechar; Esc fecha — mas não
  // quando há um Modal por cima (confirm de excluir notificação): o Modal ouve
  // keydown no window e fecharia junto.
  // Sem `aria-modal` no painel: o Tab não fica preso aqui (ao contrário do Modal
  // de primitives) e nada marca o fundo como inerte, então declarar modalidade
  // mentiria para o leitor de tela quando o foco sair para a barra de topo.
  React.useEffect(() => {
    if (!open) return
    document.querySelector('.news-close')?.focus()
    const tecla = (e) => { if (e.key !== 'Escape' || document.querySelector('.scrim')) return; onClose?.() }
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('keydown', tecla); document.querySelector('.tb-bell')?.focus() }
  }, [open])

  if (!open) return null

  // Os filtros seguem a ordem de NOTIF_KINDS (não a ordem de chegada dos
  // itens), e só aparecem os tipos que existem na lista.
  const presentes = new Set(items.map(i => i.kind))
  const kinds = NOTIF_KINDS.filter(k => presentes.has(k.id))
  // O tipo escolhido pode zerar (lido + limpo, mudança decidida) com o painel
  // fechado ou aberto; nesse caso o filtro efetivo volta a 'Todas', senão a
  // lista fica vazia sem nenhum chip marcado — e sem barra se sobrar 1 tipo.
  const filtroAtivo = filter !== 'all' && presentes.has(filter) ? filter : 'all'
  const filtered = filtroAtivo === 'all' ? items : items.filter(i => i.kind === filtroAtivo)
  const filtroLabel = NOTIF_KIND_MAP[filtroAtivo]?.label || filtroAtivo

  return (
    <div className="news-overlay" onClick={onClose}>
      <aside className="news-panel" role="dialog" aria-label="Novidades" onClick={(e) => e.stopPropagation()}>
        <div className="news-header">
          <div className="news-title"><Icon name="bell" size={17} />Novidades</div>
          <button
            className={'news-toggle' + (avisos.som ? ' on' : '')}
            onClick={onToggleSom}
            aria-pressed={avisos.som}
            title={avisos.som ? 'Som ligado — clique para silenciar' : 'Som desligado — clique para ligar'}
            aria-label={avisos.som ? 'Desligar som dos avisos' : 'Ligar som dos avisos'}>
            <Icon name={avisos.som ? 'volume' : 'volumeOff'} size={16} />
          </button>
          <button
            className={'news-toggle' + (avisos.navegador ? ' on' : '')}
            onClick={onToggleNavegador}
            aria-pressed={avisos.navegador}
            title={avisos.navegador ? 'Avisos do navegador ligados — clique para desligar' : 'Receber avisos do navegador quando esta aba estiver em segundo plano'}
            aria-label={avisos.navegador ? 'Desligar avisos do navegador' : 'Ligar avisos do navegador'}>
            <Icon name={avisos.navegador ? 'bell' : 'bellOff'} size={16} />
          </button>
          <button className="news-close" onClick={onClose} aria-label="Fechar novidades">
            <Icon name="x" size={16} />
          </button>
        </div>
        {/* Faixa própria: no painel de 360px os dois botões não cabem na
            mesma linha do título sem cortar o texto. */}
        {items.length > 0 && (
          <div className="news-header-acoes">
            <button className="btn btn-secondary btn-sm" onClick={onMarkAllRead}>Marcar tudo como lido</button>
            <button className="btn btn-ghost btn-sm news-limpar-tudo" onClick={onDismissAll}>
              <Icon name="trash" size={15} />Limpar tudo
            </button>
          </div>
        )}
        {kinds.length > 1 && (
          <div className="news-filters">
            <button className={`news-filter-btn ${filtroAtivo === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
              Todas
            </button>
            {kinds.map(k => {
              const on = filtroAtivo === k.id
              return (
                <button
                  key={k.id}
                  className={`news-filter-btn ${on ? 'active' : ''}`}
                  onClick={() => setFilter(k.id)}
                  // A cor do tipo pinta o chip inteiro quando ligado e só a
                  // bolinha quando desligado.
                  style={on
                    ? { background: k.color, borderColor: k.color, color: '#fff' }
                    : { borderColor: k.color + '66', color: k.color }}
                >
                  <span className="news-filter-dot" style={{ background: on ? '#fff' : k.color }} />
                  {k.label}
                </button>
              )
            })}
          </div>
        )}
        <div className="news-body">
          {filtered.length === 0 ? (
            <div className="news-empty">{filtroAtivo === 'all' ? 'Nenhuma novidade por enquanto.' : `Nenhuma novidade de "${filtroLabel}".`}</div>
          ) : (
            filtered.map(item => {
              const unread = !readIds.has(item.id)
              const cor = item.color || 'var(--fg-3)'
              // O card inteiro leva ao lugar da notificação; o botão "Marcar
              // como lida" continua sendo a ação que não navega.
              const abrir = () => { onOpenNotification?.(item); onClose?.() }
              return (
                <div
                  key={item.id}
                  className={'news-item' + (unread ? ' unread' : '') + (item.target ? ' clickable' : '')}
                  style={{ borderLeft: `3px solid ${cor}` }}
                  onClick={item.target ? abrir : undefined}>
                  <div className="news-item-top">
                    <span className="news-tag" style={{ color: cor, background: cor + '1a' }}>{item.tag}</span>
                    <span className="news-time">{item.time}</span>
                    <button
                      className="news-lixeira"
                      aria-label={`Excluir notificação: ${item.title}`}
                      title="Excluir esta notificação"
                      onClick={(e) => { e.stopPropagation(); onDismiss?.(item) }}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  <h4>
                    {/* stopPropagation: sem ele o onClick do card chamaria abrir() de novo. */}
                    <button type="button" className="news-item-title" disabled={!item.target}
                      onClick={(e) => { e.stopPropagation(); abrir() }}>{item.title}</button>
                  </h4>
                  <p>{item.text}</p>
                  {unread && (
                    <button className="news-read" onClick={(e) => { e.stopPropagation(); onMarkRead?.(item.id) }}>
                      Marcar como lida
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </aside>
    </div>
  )
}

export function TopBar({ title, currentUser, canNewProject = true, onToggleMobileNav, onChangePassword, onMySector, onLogout, onNewProject, tasks, projects, sessions, now, onStartTimer, onStopTimer, onOpenTask, searchQuery, onSearchChange, notifications = [], unreadCount = 0, readNewsIds = new Set(), onMarkRead, onMarkAllRead, onOpenNotification, onDismiss, onDismissAll, avisos, onToggleSom, onToggleNavegador }) {
  const [newsOpen, setNewsOpen] = React.useState(false)

  return (
    <>
      <header className="topbar">
        <button className="tb-hamburger" title="Menu" onClick={onToggleMobileNav}>
          <Icon name="menu" size={22} />
        </button>
        <h1 className="tb-title">{title}</h1>
        <div className="tb-spacer" />
        {/* <label> e não <div>: em tela estreita a busca fica reduzida ao ícone e
            só abre ao receber foco, e é o label que faz o toque em qualquer ponto
            da caixa chegar ao input, que ali tem poucos pixels de largura. */}
        <label className="search">
          <Icon name="search" size={17} />
          <input value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} aria-label="Buscar projetos" placeholder="Buscar projetos" />
        </label>
        <TimeClock currentUser={currentUser} tasks={tasks} projects={projects} sessions={sessions} now={now}
          onStart={onStartTimer} onStop={onStopTimer} onOpenTask={onOpenTask} />
        {/* O rótulo do botão sai em tela estreita e sobra o "+". O aria-label
            fica no botão porque `display: none` tira o texto da árvore de
            acessibilidade: sem ele o botão ficaria sem nome nenhum. */}
        {canNewProject && (
          <button className="btn btn-primary" onClick={onNewProject} aria-label="Novo projeto" title="Novo projeto">
            <Icon name="plus" size={17} stroke={2.2} /><span className="btn-rotulo">Novo projeto</span>
          </button>
        )}
        <div className="topbar-actions">
          <button className="tb-bell" onClick={() => setNewsOpen(o => !o)} aria-expanded={newsOpen} aria-haspopup="dialog" aria-label="Abrir novidades">
            <Icon name="bell" size={18} />
            {unreadCount > 0 && <span className="tb-bell-badge">{unreadCount}</span>}
          </button>
          <UserMenu user={currentUser} onChangePassword={onChangePassword} onMySector={onMySector} onLogout={onLogout} />
        </div>
      </header>
      <NewsPanel open={newsOpen} items={notifications} readIds={readNewsIds} onClose={() => setNewsOpen(false)} onMarkRead={onMarkRead} onMarkAllRead={onMarkAllRead}
        onOpenNotification={onOpenNotification} onDismiss={onDismiss} onDismissAll={onDismissAll}
        avisos={avisos} onToggleSom={onToggleSom} onToggleNavegador={onToggleNavegador} />
    </>
  )
}
