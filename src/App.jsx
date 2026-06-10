import React from 'react'
import { Sidebar, TopBar } from './components/Chrome.jsx'
import { Toast } from './components/primitives.jsx'
import { TaskModal, ProjectModal, ConfirmDialog, ChangePasswordModal } from './components/Modals.jsx'
import { Hub } from './screens/Hub.jsx'
import { ProjectList, ProjectDetail } from './screens/Projects.jsx'
import { Kanban } from './screens/Kanban.jsx'
import { Gantt } from './screens/Gantt.jsx'
import { Reports } from './screens/Reports.jsx'
import { TeamReport } from './screens/TeamReport.jsx'
import { Login } from './screens/Login.jsx'
import { api } from './data/api.js'
// Promav app — root: dados vêm do backend (Express + Neon) via src/data/api.js.

const TITLES = { hub: 'Visão geral', projects: 'Projetos', kanban: 'Kanban', gantt: 'Gantt', reports: 'Relatórios', team: 'Equipe' }

export default function App() {
  const [authUser, setAuthUser] = React.useState(null)   // usuário logado (ou null)
  const [booting, setBooting] = React.useState(true)     // checagem inicial do token
  const [users, setUsers] = React.useState([])
  const [projects, setProjects] = React.useState([])
  const [tasks, setTasks] = React.useState([])
  const [route, setRoute] = React.useState({ view: 'hub' })
  const [filterProject, setFilterProject] = React.useState(null)
  const [mine, setMine] = React.useState(false)
  const [modal, setModal] = React.useState(null)
  const [toast, setToast] = React.useState(null)
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
      setUsers(data.users); setProjects(data.projects); setTasks(data.tasks); setSessions(data.sessions)
      setDataReady(true)
    } catch (err) { setLoadError(err.message) }
  }, [])

  // Limpa a sessão (logout ou token expirado).
  const handleLogout = React.useCallback(() => {
    api.logout()
    setAuthUser(null); setDataReady(false)
    setUsers([]); setProjects([]); setTasks([]); setSessions([])
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
    if (r.view === 'kanban') setMine(!!r.mine)
    if (r.mine) setMine(true)
  }

  // ----- projects -----
  const openNewProject = () => setModal({ type: 'project' })
  const openEditProject = (project) => setModal({ type: 'project', project })
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
    } catch (e) { flash('Erro ao salvar projeto.') }
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

  let screen
  if (route.view === 'hub') {
    screen = <Hub projects={projects} tasks={tasks} onNavigate={navigate} sessions={sessions} currentUserId={currentUserId} now={now} />
  } else if (route.view === 'projects' && currentProject) {
    screen = <ProjectDetail project={currentProject} tasks={tasks} users={users}
      sessions={sessions} currentUserId={currentUserId} now={now} onStartTimer={startTimer} onStopTimer={stopTimer}
      onBack={() => setRoute({ view: 'projects' })} onEdit={openEditProject}
      onNewTask={openNewTask} onEditTask={openEditTask} onDeleteTask={askDeleteTask} />
  } else if (route.view === 'projects') {
    screen = <ProjectList projects={projects} tasks={tasks} onOpen={(id) => setRoute({ view: 'projects', projectId: id })}
      onEdit={openEditProject} onDelete={askDeleteProject} onNew={openNewProject} />
  } else if (route.view === 'kanban') {
    screen = <Kanban tasks={tasks} projects={projects} users={users} filterProject={filterProject} mine={mine}
      currentUserId={currentUserId} onFilterProject={setFilterProject} onToggleMine={() => setMine(m => !m)}
      onMoveTask={moveTask} onNewTask={openNewTask} onEditTask={openEditTask}
      sessions={sessions} now={now} onStartTimer={startTimer} onStopTimer={stopTimer} />
  } else if (route.view === 'gantt') {
    screen = <Gantt tasks={tasks} projects={projects} filterProject={filterProject} onFilterProject={setFilterProject} />
  } else if (route.view === 'reports') {
    screen = <Reports projects={projects} tasks={tasks} users={users} />
  } else if (route.view === 'team') {
    screen = <TeamReport users={users} tasks={tasks} projects={projects} sessions={sessions} now={now} />
  }

  return (
    <div className="app">
      <Sidebar route={route} onNavigate={navigate} projects={projects} tasks={tasks} />
      <div className="main">
        <TopBar title={currentProject ? currentProject.name : TITLES[route.view]} currentUser={authUser}
          onChangePassword={() => setModal({ type: 'password' })} onLogout={handleLogout} onNewProject={openNewProject}
          tasks={tasks} projects={projects} sessions={sessions} now={now} onStartTimer={startTimer} onStopTimer={stopTimer} />
        <div className="content">{screen}</div>
      </div>

      {modal?.type === 'task' && (
        <TaskModal task={modal.task} projects={projects} users={users}
          defaultProjectId={modal.defaultProjectId} defaultStatus={modal.defaultStatus}
          onSave={saveTask} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'project' && (
        <ProjectModal project={modal.project} onSave={saveProject} onClose={() => setModal(null)} />
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
