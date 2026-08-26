import React from 'react'
import { Sidebar, TopBar } from './components/Chrome/Chrome.jsx'
import { Toast } from './components/primitives/primitives.jsx'
import { TaskModal, ProjectModal, ChangeModal, MySectorModal, ConfirmDialog, ChangePasswordModal, DocumentModal, LinkModal, ImageModal } from './components/Modals/Modals.jsx'
import { Hub } from './screens/Hub/Hub.jsx'
import { ProjectList, ProjectDetail } from './screens/Projects/Projects.jsx'
import { Kanban } from './screens/Kanban/Kanban.jsx'
import { TaskListView } from './screens/List/List.jsx'
import { Gantt } from './screens/Gantt/Gantt.jsx'
import { Reports } from './screens/Reports/Reports.jsx'
import { TeamReport } from './screens/TeamReport/TeamReport.jsx'
import { Login } from './screens/Login/Login.jsx'
import { api } from './data/api.js'
import { effectiveProjectRole, canEditProject } from './data/store.js'
// Promav app — root: dados vêm do backend (Express + Neon) via src/data/api.js.

const TITLES = { hub: 'Visão geral', projects: 'Projetos', list: 'Lista', kanban: 'Kanban', gantt: 'Gantt', reports: 'Relatórios', team: 'Equipe' }

// "Meu setor" (a pessoa escolhendo o próprio setor no menu da conta) está
// pausado: entra numa próxima leva, junto do resto da gestão de setores.
// Nada foi removido — MySectorModal, saveMySector e a rota PUT /api/me/sector
// seguem prontos; ligar de novo é só voltar esta chave para true.
// Enquanto isso, quem define o setor de cada pessoa é o administrador, no
// painel "Setores" da tela de Equipe — que é o que a aba de Mudanças precisa
// para endereçar uma mudança a um setor inteiro.
const MY_SECTOR_ENABLED = false

export default function App() {
  const [authUser, setAuthUser] = React.useState(null)   // usuário logado (ou null)
  const [booting, setBooting] = React.useState(true)     // checagem inicial do token
  const [users, setUsers] = React.useState([])
  const [projects, setProjects] = React.useState([])
  const [folders, setFolders] = React.useState([])
  const [tasks, setTasks] = React.useState([])
  const [changes, setChanges] = React.useState([])
  const [route, setRoute] = React.useState({ view: 'hub' })
  const [filterProject, setFilterProject] = React.useState(null)
  const [mine, setMine] = React.useState(false)
  const [modal, setModal] = React.useState(null)
  const [toast, setToast] = React.useState(null)
  const [navCollapsed, setNavCollapsed] = React.useState(false)  // rail só de ícones (desktop)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false) // drawer (celular)
  const [sessions, setSessions] = React.useState([])
  const [now, setNow] = React.useState(Date.now())
  const [dataReady, setDataReady] = React.useState(false)
  const [loadError, setLoadError] = React.useState(null)

  const currentUserId = authUser?.id || null

  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const flash = (msg) => { setToast(msg); clearTimeout(flash._t); flash._t = setTimeout(() => setToast(null), 2400) }

  // Busca todos os dados do backend (após autenticar).
  const loadData = React.useCallback(async () => {
    setLoadError(null)
    try {
      const data = await api.bootstrap()
      setUsers(data.users); setProjects(data.projects); setTasks(data.tasks); setSessions(data.sessions); setFolders(data.folders || [])
      setChanges(data.changes || [])
      setDataReady(true)
    } catch (err) { setLoadError(err.message) }
  }, [])

  // Limpa a sessão (logout ou token expirado).
  const handleLogout = React.useCallback(() => {
    api.logout()
    setAuthUser(null); setDataReady(false)
    setUsers([]); setProjects([]); setTasks([]); setSessions([]); setFolders([]); setChanges([])
    setRoute({ view: 'hub' }); setModal(null)
  }, [])

  // Se a API responder 401 em qualquer chamada, derruba a sessão.
  React.useEffect(() => { api.setUnauthorizedHandler(() => handleLogout()) }, [handleLogout])

  // Na carga: se houver token salvo, restaura a sessão.
  React.useEffect(() => {
    if (!api.hasToken()) { setBooting(false); return }
    api.me()
      .then(async (me) => { setAuthUser(me); await loadData() })
      .catch(() => api.logout())
      .finally(() => setBooting(false))
  }, [loadData])

  // Chamado pela tela de Login. Rejeita em caso de credenciais inválidas.
  const handleLogin = async (email, password) => {
    const user = await api.login(email, password)
    setAuthUser(user)
    loadData()
  }

  const changePassword = async (currentPassword, newPassword) => {
    await api.changePassword(currentPassword, newPassword)
    setModal(null); flash('Senha atualizada.')
  }

  const startTimer = async (taskId) => {
    try {
      setSessions(await api.startTimer(currentUserId, taskId))
      const t = tasks.find(x => x.id === taskId)
      flash(`Cronômetro iniciado${t ? ': ' + t.title : ''}.`)
    } catch (e) { flash('Erro ao iniciar cronômetro.') }
  }
  const stopTimer = async () => {
    try { setSessions(await api.stopTimer(currentUserId)); flash('Cronômetro parado.') }
    catch (e) { flash('Erro ao parar cronômetro.') }
  }

  const navigate = (r) => {
    setRoute({ view: r.view, projectId: r.projectId })
    // Ao abrir a Lista a partir de um projeto, já filtra por ele.
    if (r.view === 'list') setFilterProject(r.projectId || null)
    if (r.view === 'kanban') setMine(!!r.mine)
    if (r.mine) setMine(true)
  }

  // A própria pessoa liga a conta ao setor em que trabalha.
  const saveMySector = async (sector) => {
    try {
      await api.setMySector(sector)
      setAuthUser(u => u ? { ...u, sector } : u)
      setUsers(us => us.map(u => u.id === currentUserId ? { ...u, sector } : u))
      setModal(null); flash('Setor atualizado.')
    } catch (e) { flash(e.message || 'Erro ao salvar o setor.') }
  }

  // Setor da pessoa — define quem é cobrado quando a mudança vai para um setor.
  const setUserSector = async (user, sector) => {
    try {
      await api.setUserSector(user.id, sector)
      setUsers(us => us.map(u => u.id === user.id ? { ...u, sector } : u))
      flash('Setor atualizado.')
    } catch (e) { flash(e.message || 'Erro ao definir o setor.') }
  }

  // ----- mudanças do projeto (orientações) -----
  const openNewChange = (projectId) => setModal({ type: 'change', projectId })
  const openEditChange = (change) => setModal({ type: 'change', change, projectId: change.projectId })

  // Publicar recarrega as atividades também: a mudança cria um cartão no quadro.
  const saveChange = async (data) => {
    try {
      const saved = data.id
        ? await api.updateChange(data.id, data)
        : await api.publishChange(data.projectId, data)
      setChanges(cs => data.id ? cs.map(c => c.id === saved.id ? saved : c) : [saved, ...cs])
      if (!data.id) await loadData() // traz a atividade recém-criada
      setModal(null)
      flash(data.id ? 'Mudança atualizada — a equipe precisa confirmar de novo.' : 'Mudança publicada e equipe avisada.')
    } catch (e) { flash(e.message || 'Erro ao salvar a mudança.') }
  }

  // Aceitar cria a atividade; por isso recarrega tudo depois de aceitar.
  const decideChange = async (change, accept) => {
    let reason = ''
    if (!accept) {
      reason = window.prompt('Por que esta sugestão está sendo recusada?') || ''
      if (!reason.trim()) return
    }
    try {
      const saved = await api.decideChange(change.id, accept, reason.trim())
      setChanges(cs => cs.map(c => c.id === saved.id ? saved : c))
      if (accept) await loadData()
      flash(accept ? 'Sugestão aceita — atividade criada no quadro.' : 'Sugestão recusada.')
    } catch (e) { flash(e.message || 'Erro ao decidir a sugestão.') }
  }

  const ackChange = async (change) => {
    try {
      const saved = await api.ackChange(change.id)
      setChanges(cs => cs.map(c => c.id === saved.id ? saved : c))
      flash('Ciência confirmada.')
    } catch (e) { flash(e.message || 'Erro ao confirmar.') }
  }

  // ----- projects -----
  const openNewProject = (folderId) => setModal({ type: 'project', defaultFolderId: typeof folderId === 'string' ? folderId : null })
  const openEditProject = (project) => setModal({ type: 'project', project })
  const renameProject = async (project) => {
    const name = window.prompt('Novo nome do projeto:', project.name)
    if (name == null || !name.trim() || name.trim() === project.name) return
    try {
      const saved = await api.updateProject(project.id, { ...project, name: name.trim() })
      setProjects(ps => ps.map(p => p.id === saved.id ? saved : p)); flash('Projeto renomeado.')
    } catch (e) { flash(e.message || 'Erro ao renomear projeto.') }
  }
  const saveProject = async (data) => {
    try {
      if (data.id) {
        const saved = await api.updateProject(data.id, data)
        setProjects(ps => ps.map(p => p.id === saved.id ? saved : p)); flash('Projeto atualizado.')
      } else {
        const saved = await api.createProject(data)
        setProjects(ps => [...ps, saved]); flash('Projeto criado.')
      }
      setModal(null)
    } catch (e) { flash(e.message || 'Erro ao salvar projeto.') }
  }
  const askDeleteProject = (project) => setModal({
    type: 'confirm', title: 'Excluir projeto?',
    message: `As atividades de "${project.name}" também serão removidas. Essa ação não pode ser desfeita.`,
    onConfirm: async () => {
      try {
        await api.deleteProject(project.id)
        setProjects(ps => ps.filter(p => p.id !== project.id))
        setTasks(ts => ts.filter(t => t.projectId !== project.id))
        setModal(null); setRoute({ view: 'projects' }); flash('Projeto excluído.')
      } catch (e) { flash('Erro ao excluir projeto.') }
    },
  })

  // Abre o modal para adicionar um documento/link ao projeto atual.
  const openAddResource = (resType) => setModal({ type: 'resource', resType })
  // Persiste o novo recurso no projeto atual. Documentos/imagens são enviados
  // como arquivo (vão para o banco); links são apenas a URL (como antes).
  const saveResource = async (payload) => {
    const project = currentProject
    if (!project) return
    try {
      const saved = payload.upload
        ? await api.uploadFile(project.id, payload.file, payload.kind, payload.label)
        : await api.addResource(project.id, payload)
      setProjects(ps => ps.map(p => p.id === saved.id ? saved : p))
      setModal(null); flash('Material adicionado.')
    } catch (e) { flash(e.message || 'Erro ao adicionar material.') }
  }

  // Copia o link de um recurso (documento/link) para a área de transferência.
  const copyResourceLink = async (resource) => {
    const url = resource.fileId ? api.fileUrl(resource.fileId) : resource.url
    try { await navigator.clipboard.writeText(url); flash('Link copiado.') }
    catch (e) { flash('Não foi possível copiar o link.') }
  }
  // Remove um documento/link do projeto (endpoint dedicado; exige Edição total).
  const askDeleteResource = (project, resource) => setModal({
    type: 'confirm', title: 'Excluir item?',
    message: `"${resource.label || resource.filename || resource.url}" será removido deste projeto.`,
    onConfirm: async () => {
      try {
        const saved = await api.deleteResource(project.id, resource.id)
        setProjects(ps => ps.map(p => p.id === saved.id ? saved : p))
        setModal(null); flash('Item removido.')
      } catch (e) { flash(e.message || 'Erro ao remover item.') }
    },
  })

  // ----- folders (pastas que agrupam projetos na sidebar) -----
  const createFolder = async (parentId) => {
    const parent = typeof parentId === 'string' ? parentId : null
    const name = window.prompt(parent ? 'Nome da nova subpasta:' : 'Nome da nova pasta:')
    if (name == null || !name.trim()) return
    try {
      const saved = await api.createFolder(name.trim(), parent)
      setFolders(fs => [...fs, saved]); flash(parent ? 'Subpasta criada.' : 'Pasta criada.')
    } catch (e) { flash(e.message || 'Erro ao criar pasta.') }
  }
  const renameFolder = async (folder) => {
    const name = window.prompt('Novo nome da pasta:', folder.name)
    if (name == null || !name.trim() || name.trim() === folder.name) return
    try {
      const saved = await api.renameFolder(folder.id, name.trim())
      setFolders(fs => fs.map(f => f.id === saved.id ? saved : f)); flash('Pasta renomeada.')
    } catch (e) { flash(e.message || 'Erro ao renomear pasta.') }
  }
  const askDeleteFolder = (folder) => setModal({
    type: 'confirm', title: 'Excluir pasta?',
    message: `A pasta "${folder.name}" e suas subpastas serão removidas. Os projetos dentro delas NÃO serão apagados — apenas ficarão sem pasta.`,
    onConfirm: async () => {
      try {
        await api.deleteFolder(folder.id)
        // Reúne a pasta + todas as descendentes (espelha o ON DELETE CASCADE do banco).
        setFolders(fs => {
          const removed = new Set([folder.id])
          let grew = true
          while (grew) {
            grew = false
            for (const f of fs) {
              if (f.parentId && removed.has(f.parentId) && !removed.has(f.id)) { removed.add(f.id); grew = true }
            }
          }
          // os projetos das pastas apagadas ficam "soltos" (espelha o ON DELETE SET NULL)
          setProjects(ps => ps.map(p => removed.has(p.folderId) ? { ...p, folderId: null } : p))
          return fs.filter(f => !removed.has(f.id))
        })
        setModal(null); flash('Pasta excluída.')
      } catch (e) { flash(e.message || 'Erro ao excluir pasta.') }
    },
  })

  // Mover/reordenar por drag-and-drop. `beforeId` = id do irmão antes do qual
  // inserir (null = solta no fim do grupo). Atualiza a tela na hora e persiste.
  const moveFolder = async (draggedId, newParentId, beforeId) => {
    const parent = newParentId || null
    if (draggedId === beforeId) return
    const order = folders.filter(f => (f.parentId || null) === parent && f.id !== draggedId)
      .sort((a, b) => a.position - b.position).map(f => f.id)
    const at = beforeId ? order.indexOf(beforeId) : -1
    order.splice(at < 0 ? order.length : at, 0, draggedId)
    setFolders(prev => prev.map(f => {
      const pos = order.indexOf(f.id)
      return pos < 0 ? f : { ...f, parentId: parent, position: pos }
    }))
    try { await api.reorderFolders(parent, order) }
    catch (e) { flash(e.message || 'Erro ao mover pasta.'); loadData() }
  }
  const moveProject = async (draggedId, newFolderId, beforeId) => {
    const folder = newFolderId || null
    if (draggedId === beforeId) return
    const order = projects.filter(p => (p.folderId || null) === folder && p.id !== draggedId)
      .sort((a, b) => (a.position || 0) - (b.position || 0)).map(p => p.id)
    const at = beforeId ? order.indexOf(beforeId) : -1
    order.splice(at < 0 ? order.length : at, 0, draggedId)
    setProjects(prev => prev.map(p => {
      const pos = order.indexOf(p.id)
      return pos < 0 ? p : { ...p, folderId: folder, position: pos }
    }))
    try { await api.reorderProjects(folder, order) }
    catch (e) { flash(e.message || 'Erro ao mover projeto.'); loadData() }
  }

  // ----- tasks -----
  const openNewTask = (projectId, status) => setModal({ type: 'task', defaultProjectId: projectId, defaultStatus: status })
  const openEditTask = (task) => setModal({ type: 'task', task })
  const saveTask = async (data) => {
    try {
      if (data.id) {
        const saved = await api.updateTask(data.id, data)
        setTasks(ts => ts.map(t => t.id === saved.id ? saved : t)); flash('Atividade atualizada.')
      } else {
        const saved = await api.createTask(data)
        setTasks(ts => [...ts, saved]); flash('Atividade criada.')
      }
      setModal(null)
    } catch (e) { flash('Erro ao salvar atividade.') }
  }
  const askDeleteTask = (task) => setModal({
    type: 'confirm', title: 'Excluir atividade?',
    message: `"${task.title}" será removida permanentemente.`,
    onConfirm: async () => {
      try {
        await api.deleteTask(task.id)
        setTasks(ts => ts.filter(t => t.id !== task.id)); setModal(null); flash('Atividade excluída.')
      } catch (e) { flash('Erro ao excluir atividade.') }
    },
  })
  const moveTask = async (id, status) => {
    const prev = tasks
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status } : t)) // otimista
    const labels = { todo: 'A fazer', progress: 'Em andamento', done: 'Concluído' }
    try {
      const saved = await api.moveTask(id, status)
      setTasks(ts => ts.map(t => t.id === saved.id ? saved : t))
      flash(`Atividade movida para ${labels[status]}.`)
    } catch (e) { setTasks(prev); flash('Erro ao mover atividade.') }
  }
  // Entrar/sair de uma atividade (só a própria participação). Disponível para 'Só exibição'.
  const toggleMyMembership = async (task, join) => {
    setTasks(ts => ts.map(t => t.id === task.id
      ? { ...t, memberIds: join ? [...new Set([...(t.memberIds || []), currentUserId])] : (t.memberIds || []).filter(x => x !== currentUserId) }
      : t))
    try {
      const saved = await api.toggleMembership(task.id, join)
      setTasks(ts => ts.map(t => t.id === saved.id ? saved : t))
      flash(join ? 'Você entrou na atividade.' : 'Você saiu da atividade.')
    } catch (e) { setTasks(ts => ts.map(t => t.id === task.id ? task : t)); flash(e.message || 'Erro ao atualizar participação.') }
  }
  // Marca/desmarca um item de checklist (otimista). Disponível também para 'Só exibição'.
  const toggleChecklistItem = async (task, itemId) => {
    const next = (task.checklist || []).map(i => i.id === itemId ? { ...i, done: !i.done } : i)
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, checklist: next } : t))
    try {
      const saved = await api.toggleChecklist(task.id, next)
      setTasks(ts => ts.map(t => t.id === saved.id ? saved : t))
    } catch (e) { setTasks(ts => ts.map(t => t.id === task.id ? task : t)); flash(e.message || 'Erro ao atualizar checklist.') }
  }

  // Checando token salvo.
  if (booting) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ color: 'var(--fg-3)' }}>Carregando…</div>
      </div>
    )
  }

  // Não autenticado → tela de login.
  if (!authUser) return <Login onLogin={handleLogin} />

  // Autenticado, mas os dados ainda não chegaram (ou falharam).
  if (!dataReady || loadError) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--fg-3)', maxWidth: 420, padding: 24 }}>
          {loadError ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-1)', marginBottom: 8 }}>Não foi possível carregar os dados</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{loadError}</div>
              <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={loadData}>Tentar de novo</button>
            </>
          ) : 'Carregando…'}
        </div>
      </div>
    )
  }

  const currentProject = route.projectId ? projects.find(p => p.id === route.projectId) : null
  const isAdmin = !!authUser?.isAdmin
  // Papel efetivo do usuário no projeto aberto (admin/full/view).
  const currentRole = currentProject ? effectiveProjectRole(currentProject, authUser) : 'view'
  const canEditCurrent = canEditProject(currentRole)

  let screen
  if (route.view === 'hub') {
    screen = <Hub projects={projects} tasks={tasks} onNavigate={navigate} sessions={sessions} currentUserId={currentUserId} now={now} />
  } else if (route.view === 'projects' && currentProject) {
    screen = <ProjectDetail project={currentProject} tasks={tasks} users={users} changes={changes}
      sessions={sessions} currentUserId={currentUserId} now={now} onStartTimer={startTimer} onStopTimer={stopTimer}
      canEdit={canEditCurrent} role={currentRole}
      onBack={() => setRoute({ view: 'projects' })} onEdit={openEditProject}
      onNewTask={openNewTask} onEditTask={openEditTask} onDeleteTask={askDeleteTask}
      onToggleChecklist={toggleChecklistItem}
      onCopyResource={copyResourceLink} onDeleteResource={(resource) => askDeleteResource(currentProject, resource)}
      onAddResource={openAddResource}
      onNewChange={openNewChange} onEditChange={openEditChange} onAckChange={ackChange} onDecideChange={decideChange} />
  } else if (route.view === 'projects') {
    screen = <ProjectList projects={projects} tasks={tasks} folders={folders} authUser={authUser} canCreate={isAdmin}
      onOpen={(id) => setRoute({ view: 'projects', projectId: id })}
      onEdit={openEditProject} onDelete={askDeleteProject} onNew={openNewProject} />
  } else if (route.view === 'list') {
    screen = <TaskListView tasks={tasks} projects={projects} users={users} authUser={authUser} filterProject={filterProject} mine={mine}
      currentUserId={currentUserId} onFilterProject={setFilterProject} onToggleMine={() => setMine(m => !m)}
      onMoveTask={moveTask} onNewTask={openNewTask} onEditTask={openEditTask} />
  } else if (route.view === 'kanban') {
    screen = <Kanban tasks={tasks} projects={projects} users={users} authUser={authUser} filterProject={filterProject} mine={mine}
      currentUserId={currentUserId} onFilterProject={setFilterProject} onToggleMine={() => setMine(m => !m)}
      onMoveTask={moveTask} onNewTask={openNewTask} onEditTask={openEditTask}
      sessions={sessions} now={now} onStartTimer={startTimer} onStopTimer={stopTimer} />
  } else if (route.view === 'gantt') {
    screen = <Gantt tasks={tasks} projects={projects} filterProject={filterProject} onFilterProject={setFilterProject} />
  } else if (route.view === 'reports') {
    screen = <Reports projects={projects} tasks={tasks} users={users} />
  } else if (route.view === 'team') {
    screen = <TeamReport users={users} tasks={tasks} projects={projects} sessions={sessions} now={now} isAdmin={isAdmin} onSetSector={setUserSector} />
  }

  return (
    <div className={'app' + (mobileNavOpen ? ' nav-open' : '')}>
      <Sidebar route={route} onNavigate={navigate} projects={projects} tasks={tasks}
        folders={folders} isAdmin={isAdmin}
        collapsed={navCollapsed} mobileOpen={mobileNavOpen}
        onToggleCollapse={() => setNavCollapsed(c => !c)}
        onCloseMobile={() => setMobileNavOpen(false)}
        onNewFolder={createFolder} onRenameFolder={renameFolder} onDeleteFolder={askDeleteFolder}
        onNewProjectInFolder={openNewProject}
        onMoveFolder={moveFolder} onMoveProject={moveProject}
        onRenameProject={renameProject} onEditProject={openEditProject} onDeleteProject={askDeleteProject} />
      <div className="nav-backdrop" onClick={() => setMobileNavOpen(false)} />
      <div className="main">
        <TopBar title={currentProject ? currentProject.name : TITLES[route.view]} currentUser={authUser}
          canNewProject={isAdmin} onToggleMobileNav={() => setMobileNavOpen(o => !o)}
          onChangePassword={() => setModal({ type: 'password' })}
          onMySector={MY_SECTOR_ENABLED ? () => setModal({ type: 'mysector' }) : undefined}
          onLogout={handleLogout} onNewProject={openNewProject}
          tasks={tasks} projects={projects} sessions={sessions} now={now} onStartTimer={startTimer} onStopTimer={stopTimer} />
        <div className="content">{screen}</div>
      </div>

      {modal?.type === 'task' && (
        <TaskModal task={modal.task} projects={projects} users={users} currentUserId={currentUserId}
          defaultProjectId={modal.defaultProjectId} defaultStatus={modal.defaultStatus}
          canEdit={modal.task ? canEditProject(effectiveProjectRole(projects.find(p => p.id === modal.task.projectId), authUser)) : isAdmin}
          onToggleChecklist={toggleChecklistItem} onToggleMembership={toggleMyMembership}
          onSave={saveTask} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'mysector' && (
        <MySectorModal current={authUser?.sector} onSubmit={saveMySector} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'change' && (
        <ChangeModal change={modal.change} projectId={modal.projectId} users={users} currentUserId={currentUserId}
          members={projects.find(p => p.id === modal.projectId)?.members || []}
          onSave={saveChange} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'project' && (
        <ProjectModal project={modal.project} users={users} folders={folders} defaultFolderId={modal.defaultFolderId} isAdmin={isAdmin} onSave={saveProject} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'resource' && modal.resType === 'doc' && (
        <DocumentModal onSave={saveResource} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'resource' && modal.resType === 'link' && (
        <LinkModal onSave={saveResource} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'resource' && modal.resType === 'image' && (
        <ImageModal onSave={saveResource} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'confirm' && (
        <ConfirmDialog title={modal.title} message={modal.message} onConfirm={modal.onConfirm} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'password' && (
        <ChangePasswordModal onSubmit={changePassword} onClose={() => setModal(null)} />
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}
