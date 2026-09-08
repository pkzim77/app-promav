import React from 'react'
import { Sidebar, TopBar } from './components/Chrome/Chrome.jsx'
import { Toast } from './components/primitives/primitives.jsx'
import { TaskModal, ProjectModal, ChangeModal, MySectorModal, ConfirmDialog, ChangePasswordModal, DocumentModal, LinkModal, ImageModal, PeopleModal } from './components/Modals/Modals.jsx'
import { Hub } from './screens/Hub/Hub.jsx'
import { ProjectList, ProjectDetail } from './screens/Projects/Projects.jsx'
import { Kanban } from './screens/Kanban/Kanban.jsx'
import { TaskListView } from './screens/List/List.jsx'
import { Gantt } from './screens/Gantt/Gantt.jsx'
import { Reports } from './screens/Reports/Reports.jsx'
import { TeamReport } from './screens/TeamReport/TeamReport.jsx'
import { Login } from './screens/Login/Login.jsx'
import { api } from './data/api.js'
import { effectiveProjectRole, canEditProject, NOTIF_KIND_MAP } from './data/store.js'
import { tocarAviso, destravarSom, avisarNoNavegador, pedirPermissao, permissaoNotificacao, suportaNotificacao } from './data/avisos.js'
// Promav app — root: dados vêm do backend (Express + Neon) via src/data/api.js.

// Profissionais carrega sob demanda: o AG Grid que ela usa responde por ~1,2 MB
// do bundle, e a tela é só de administrador. Sem isto, todo mundo baixa a
// biblioteca no primeiro acesso mesmo sem nunca abrir a tela.
// O módulo tem export nomeado, daí o mapeamento para default que o lazy exige.
const People = React.lazy(() => import('./screens/People/People.jsx').then(m => ({ default: m.People })))

const TITLES ={ hub: 'Visão geral', projects: 'Projetos', list: 'Lista', kanban: 'Kanban', gantt: 'Gantt', people: 'Profissionais', reports: 'Relatórios', team: 'Equipe' }

// "Meu setor" (a pessoa escolhendo o próprio setor no menu da conta) está
// pausado: entra numa próxima leva, junto do resto da gestão de setores.
// Nada foi removido — MySectorModal, saveMySector e a rota POST /api/auth/sector
// seguem prontos; ligar de novo é só voltar esta chave para true.
// Enquanto isso, quem define o setor de cada pessoa é o administrador, no
// painel "Setores" da tela de Equipe — que é o que a aba de Mudanças precisa
// para endereçar uma mudança a um setor inteiro.
const MY_SECTOR_ENABLED = false

// Quanto tempo uma atividade que a própria pessoa criou para si precisa ficar
// parada (sem edição e sem ser aberta) antes de virar notificação para ela.
const REPOUSO_MS = 3 * 24 * 60 * 60 * 1000 // 3 dias

// De quanto em quanto tempo conferir o carimbo do banco (/api/pulse).
const PULSE_MS = 30000 // 30s

export default function App() {
  const [authUser, setAuthUser] = React.useState(null)   // usuário logado (ou null)
  const [booting, setBooting] = React.useState(true)     // checagem inicial do token
  const [users, setUsers] = React.useState([])
  const [projects, setProjects] = React.useState([])
  const [folders, setFolders] = React.useState([])
  const [tasks, setTasks] = React.useState([])
  const [changes, setChanges] = React.useState([])
  const [route, setRoute] = React.useState({ view: 'hub' })
  const [projectSearch, setProjectSearch] = React.useState('')
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

  // ----- polling: mantém o app em dia sem recarregar a página -----
  // Consulta o /api/pulse (~100 bytes) e só refaz o /bootstrap (54 KB) quando
  // o carimbo do banco muda. É o que faz a ciência confirmada por outra pessoa
  // aparecer sozinha, sem F5.
  const pulseRef = React.useRef(null)
  const modalRef = React.useRef(null)
  modalRef.current = modal

  React.useEffect(() => {
    if (!authUser || !dataReady) return
    let vivo = true

    const conferir = async () => {
      // Aba em segundo plano não consulta: o navegador estrangula o timer de
      // qualquer jeito e não há nada para mostrar. Voltar para a aba dispara
      // uma conferida imediata (o listener de visibilitychange abaixo).
      if (!vivo || document.hidden) return
      try {
        const { v } = await api.pulse()
        if (!vivo || v === pulseRef.current) return
        // Primeira leitura só semeia: o bootstrap do login já trouxe tudo.
        if (pulseRef.current === null) { pulseRef.current = v; return }
        // Com um modal aberto, adia. Recarregar por baixo de um formulário
        // aberto atropela o que a pessoa está editando. O ref não avança, então
        // a próxima volta tenta de novo — assim que ela fechar, atualiza.
        if (modalRef.current) return
        pulseRef.current = v
        await loadData()
      } catch { /* rede instável ou API fora: tenta na próxima volta */ }
    }

    conferir()
    const t = setInterval(conferir, PULSE_MS)
    document.addEventListener('visibilitychange', conferir)
    return () => {
      vivo = false
      pulseRef.current = null // nova sessão volta a semear
      clearInterval(t)
      document.removeEventListener('visibilitychange', conferir)
    }
  }, [authUser, dataReady, loadData])

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
    if (r.view === 'people' && !isAdmin) {
      setRoute({ view: 'hub' })
      return
    }
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
  const openNewPerson = () => setModal({ type: 'person' })
  const openEditPerson = (user) => setModal({ type: 'person', user })
  const openProjectFromPerson = (projectId) => { setModal(null); setRoute({ view: 'projects', projectId }) }
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
  const saveUser = async (data) => {
    try {
      const payload = {
        name: data.name.trim(),
        email: data.email.trim(),
        sector: data.sector || null,
        jobTitle: data.jobTitle?.trim() || null,
        initials: data.initials || '',
        color: data.color || 'var(--proj-blue)',
        isAdmin: !!data.isAdmin,
        isActive: data.isActive !== false,
        initialPassword: data.initialPassword || undefined,
      }
      const saved = data.id ? await api.updateUser(data.id, payload) : await api.createUser(payload)
      setUsers(us => data.id ? us.map(u => u.id === saved.id ? saved : u) : [saved, ...us])
      setModal(null)
      flash(data.id ? 'Profissional atualizado.' : 'Profissional criado.')
    } catch (e) { flash(e.message || 'Erro ao salvar profissional.') }
  }
  const askDeletePerson = (user) => setModal({
    type: 'confirm', title: 'Excluir profissional?',
    message: `"${user.name}" será removido permanentemente. Vínculos com projetos e atividades são desfeitos, e o histórico de cronômetro dessa pessoa é apagado. Essa ação não pode ser desfeita.`,
    onConfirm: async () => {
      try {
        await api.deleteUser(user.id)
        setUsers(us => us.filter(u => u.id !== user.id))
        setModal(null); flash('Profissional excluído.')
      } catch (e) { flash(e.message || 'Erro ao excluir profissional.') }
    },
  })
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
  // Abrir a atividade conta como acesso: é o que adia a notificação daquilo
  // que a própria pessoa criou para si. Falha aqui não pode travar o modal —
  // o registro de leitura é secundário em relação a ver a atividade.
  const openEditTask = (task) => {
    setModal({ type: 'task', task })
    api.viewTask(task.id)
      .then(saved => setTasks(ts => ts.map(t => t.id === saved.id ? saved : t)))
      .catch(() => { /* registro de leitura é best-effort */ })
  }
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

  const [readNewsIds, setReadNewsIds] = React.useState([])
  // Notificações limpas pela pessoa. Some da lista para sempre — ao contrário
  // de "lida", que só tira o destaque. É por usuário e fica só neste navegador.
  const [dismissedNewsIds, setDismissedNewsIds] = React.useState([])
  // Preferências de aviso. Som já entra ligado (é discreto e não pede
  // permissão); a notificação do sistema começa desligada porque depende de a
  // pessoa autorizar no navegador.
  const [avisos, setAvisos] = React.useState({ som: true, navegador: false })
  const newsKey = authUser ? `promav-news-${authUser.id}` : null
  const dismissedKey = authUser ? `promav-news-limpas-${authUser.id}` : null
  const avisosKey = authUser ? `promav-avisos-${authUser.id}` : null

  React.useEffect(() => {
    if (!avisosKey) return
    try {
      const salvo = JSON.parse(localStorage.getItem(avisosKey) || 'null')
      if (salvo) setAvisos({
        som: salvo.som !== false,
        // Vale só se o navegador ainda estiver autorizado: a pessoa pode ter
        // revogado a permissão nas configurações depois de ligar aqui.
        navegador: !!salvo.navegador && permissaoNotificacao() === 'granted',
      })
    } catch { /* preferência é acessória */ }
  }, [avisosKey])

  React.useEffect(() => {
    if (!avisosKey) return
    try { localStorage.setItem(avisosKey, JSON.stringify(avisos)) } catch { /* ignore */ }
  }, [avisosKey, avisos])

  React.useEffect(() => {
    if (!newsKey) { setReadNewsIds([]); return }
    try {
      const saved = JSON.parse(localStorage.getItem(newsKey) || '[]')
      setReadNewsIds(Array.isArray(saved) ? saved : [])
    } catch {
      setReadNewsIds([])
    }
  }, [newsKey])

  React.useEffect(() => {
    if (!newsKey) return
    try { localStorage.setItem(newsKey, JSON.stringify(readNewsIds)) } catch { /* ignore */ }
  }, [newsKey, readNewsIds])

  React.useEffect(() => {
    if (!dismissedKey) { setDismissedNewsIds([]); return }
    try {
      const saved = JSON.parse(localStorage.getItem(dismissedKey) || '[]')
      setDismissedNewsIds(Array.isArray(saved) ? saved : [])
    } catch {
      setDismissedNewsIds([])
    }
  }, [dismissedKey])

  React.useEffect(() => {
    if (!dismissedKey) return
    try { localStorage.setItem(dismissedKey, JSON.stringify(dismissedNewsIds)) } catch { /* ignore */ }
  }, [dismissedKey, dismissedNewsIds])

  // Relógio grosso: o 'now' bate a cada segundo (cronômetro), o que recalcularia
  // as notificações 60x por minuto à toa. Aqui basta a virada do minuto.
  const minutoAtual = Math.floor(now / 60000)

  const notifications = React.useMemo(() => {
    if (!authUser) return []
    const agora = minutoAtual * 60000
    const linkedProjectIds = new Set(
      (projects || []).filter((project) => {
        if (authUser.isAdmin) return true
        const members = project.members || []
        const memberIds = members.map(m => m.userId)
        return memberIds.includes(authUser.id) || (project.responsibleIds || []).includes(authUser.id)
      }).map((project) => project.id)
    )

    const items = []
    const processedTaskIds = new Set()
    const projectsWithRelevantActivity = new Set() // Rastreia projetos com mudanças/atividades importantes

    const diaCurto = (ts) => ts
      ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      : 'Hoje'
    // Quem registrou a mudança não é avisado dela — ele já sabe. O autor só é
    // notificado quando OUTRA pessoa confirma ciência (notificações 'ciencia').
    const souAutor = (c) => c.publishedBy === authUser.id || c.emitterUserId === authUser.id
    // Atividade que a pessoa criou para si mesma não vira notificação enquanto
    // ela estiver mexendo nela — ela já sabe que existe. Só depois de 3 dias
    // parada (sem edição e sem ser aberta) é que passa a cobrar.
    const emRepousoCurto = (task) => {
      const souDono = task.createdBy && task.createdBy === authUser.id && task.assigneeId === authUser.id
      if (!souDono) return false
      const meuAcesso = (task.views || []).find(v => v.userId === authUser.id)?.seenAt || 0
      const ultimoToque = Math.max(task.updatedAt || 0, task.createdAt || 0, meuAcesso)
      return agora - ultimoToque < REPOUSO_MS
    }

    // Monta o item já com a cor e o destino do clique.
    const push = (kind, item) => {
      const tipo = NOTIF_KIND_MAP[kind]
      items.push({ ...item, kind, tag: tipo.label, color: tipo.color })
    }

    for (const project of projects) {
      if (!linkedProjectIds.has(project.id)) continue

      const projectChanges = (changes || []).filter(c => c.projectId === project.id)
      const myChanges = projectChanges.filter(c => !souAutor(c)
        && ((c.targetUserIds || []).includes(authUser.id) || (c.targetSectors || []).includes(authUser.sector)))

      // Processa mudanças: consolida mudança + atividade em uma notificação.
      // O tipo da notificação é o tipo da mudança (requisição ou sugestão),
      // que é o que separa os filtros do painel.
      for (const change of myChanges) {
        const kind = change.kind === 'sugestao' ? 'sugestao' : 'requisicao'
        const linkedTask = change.taskId ? (tasks || []).find(t => t.id === change.taskId) : null
        const iAmAssignedToTask = linkedTask && (linkedTask.assigneeId === authUser.id || (linkedTask.memberIds || []).includes(authUser.id))
        const alvo = { view: 'projects', projectId: project.id, tab: 'mudancas', focusId: `change-${change.id}` }
        projectsWithRelevantActivity.add(project.id)

        if (linkedTask && iAmAssignedToTask) {
          // Notificação combinada: mudança que criou uma atividade para mim
          processedTaskIds.add(linkedTask.id)
          push(kind, {
            id: `change-task-${change.id}`,
            title: linkedTask.title,
            text: `${change.title} • ${project.name} • gerou uma atividade para você`,
            time: diaCurto(change.publishedAt),
            priority: 1,
            target: alvo,
          })
        } else {
          // Notificação simples de mudança
          push(kind, {
            id: `change-${change.id}`,
            title: change.title,
            text: `Você foi indicado em ${project.name}.`,
            time: diaCurto(change.publishedAt),
            priority: 2,
            target: alvo,
          })
        }
      }

      // Ciência confirmada nas mudanças que EU registrei — é o retorno que o
      // autor recebe no lugar da notificação da própria mudança.
      for (const change of projectChanges) {
        if (!souAutor(change)) continue
        for (const ack of change.acks || []) {
          if (!ack.confirmedAt || ack.userId === authUser.id) continue
          const quem = (users || []).find(u => u.id === ack.userId)
          projectsWithRelevantActivity.add(project.id)
          push('ciencia', {
            id: `ack-${change.id}-${ack.userId}`,
            title: `${quem?.name || 'Alguém'} confirmou que viu`,
            text: `${change.title} • ${project.name}`,
            time: diaCurto(ack.confirmedAt),
            priority: 3,
            target: { view: 'projects', projectId: project.id, tab: 'mudancas', focusId: `change-${change.id}` },
          })
        }
      }

      // Processa atividades não vinculadas a mudanças que já foram notificadas
      const myTasks = (tasks || []).filter(t =>
        t.projectId === project.id &&
        (t.assigneeId === authUser.id || (t.memberIds || []).includes(authUser.id)) &&
        !processedTaskIds.has(t.id) &&
        !emRepousoCurto(t)
      )
      if (myTasks.length > 0) {
        projectsWithRelevantActivity.add(project.id)
      }
      for (const task of myTasks) {
        push('atividade', {
          id: `task-${task.id}`,
          title: task.title,
          text: `${project.name} • ${task.status === 'done' ? 'concluída' : task.status === 'progress' ? 'em andamento' : 'a fazer'}`,
          time: 'Hoje',
          priority: 4,
          target: { view: 'projects', projectId: project.id, tab: 'atividades', focusId: `task-${task.id}` },
        })
      }

      // Processa atualizações importantes do projeto SOMENTE se não há mudanças/atividades desse projeto
      if (!projectsWithRelevantActivity.has(project.id) && (project.status || project.start || project.end || project.valorEstimado || project.valorOrcado)) {
        push('projeto', {
          id: `project-${project.id}`,
          title: `Atualização importante em ${project.name}`,
          text: `${project.status ? `Status: ${project.status}` : 'Dados do projeto foram atualizados'}${project.start || project.end ? ` • ${project.start || '—'} até ${project.end || '—'}` : ''}`,
          time: 'Hoje',
          priority: 5,
          target: { view: 'projects', projectId: project.id, tab: 'panorama' },
        })
      }
    }

    // Ordena por prioridade (maior = mais importante = primeiro)
    return items
      .sort((a, b) => (a.priority || 999) - (b.priority || 999))
      .map(({ priority, ...item }) => item) // Remove o campo de prioridade antes de retornar
      .slice(0, 20)
  }, [authUser, projects, tasks, changes, users, minutoAtual])

  // O que a pessoa realmente vê: tudo que ela não limpou.
  const visibleNotifications = notifications.filter(item => !dismissedNewsIds.includes(item.id))

  // ----- avisos de novidade (som + notificação do sistema) -----
  // As notificações são estado derivado, recalculado do zero a cada carga: não
  // existe "chegou agora". A diferença entre o conjunto de ids de antes e o de
  // agora é o que dá essa noção.
  const avisosRef = React.useRef(avisos); avisosRef.current = avisos
  const notifRef = React.useRef([]); notifRef.current = visibleNotifications
  const abrirRef = React.useRef(null)
  const vistasRef = React.useRef(null)
  const idsKey = visibleNotifications.map(i => i.id).join('|')

  // Troca de sessão zera a memória: sem isto, entrar na conta faria as ~20
  // notificações existentes tocarem todas de uma vez, como se fossem novas.
  React.useEffect(() => { vistasRef.current = null }, [authUser?.id])

  React.useEffect(() => {
    const itens = notifRef.current
    const anterior = vistasRef.current
    vistasRef.current = new Set(itens.map(i => i.id))
    if (anterior === null) return // primeira passada só semeia
    const novas = itens.filter(i => !anterior.has(i.id))
    if (!novas.length) return
    const pref = avisosRef.current
    if (pref.som) tocarAviso()
    // Só avisa o sistema com a aba escondida: com o app na frente, a pessoa
    // já vê o sino piscando e o pop-up vira ruído.
    if (pref.navegador && document.hidden) avisarNoNavegador(novas, (item) => abrirRef.current?.(item))
  }, [idsKey])
  const unreadNotifications = visibleNotifications.filter(item => !readNewsIds.includes(item.id))

  // Limpar é irreversível (não há "desfazer"), por isso as duas ações passam
  // pelo mesmo ConfirmDialog do resto do app.
  const askDismissNotification = (item) => setModal({
    type: 'confirm', title: 'Excluir esta notificação?',
    message: `"${item.title}" sai da sua lista de novidades. A atividade ou mudança em si não é apagada.`,
    onConfirm: () => {
      setDismissedNewsIds(prev => prev.includes(item.id) ? prev : [...prev, item.id])
      setModal(null); flash('Notificação excluída.')
    },
  })
  const askDismissAllNotifications = () => {
    const total = visibleNotifications.length
    if (!total) return
    setModal({
      type: 'confirm', title: 'Limpar todas as notificações?',
      message: `${total} ${total === 1 ? 'notificação sai' : 'notificações saem'} da sua lista. As atividades e mudanças em si não são apagadas.`,
      onConfirm: () => {
        setDismissedNewsIds(prev => Array.from(new Set([...prev, ...visibleNotifications.map(i => i.id)])))
        setModal(null); flash('Notificações limpas.')
      },
    })
  }
  // Clique na notificação: leva ao lugar onde ela aconteceu (projeto + aba) e
  // marca como lida. O 'focusNonce' força o destaque a rodar de novo quando a
  // mesma notificação é clicada duas vezes seguidas.
  const openNotification = (item) => {
    if (!item?.target) return
    const { view, projectId, tab, focusId } = item.target
    setRoute({ view, projectId, tab, focusId, focusNonce: Date.now() })
    setReadNewsIds(prev => prev.includes(item.id) ? prev : [...prev, item.id])
  }
  // Clicar na notificação do sistema abre o mesmo destino do clique no sino.
  abrirRef.current = openNotification
  const markNewsAsRead = (id) => setReadNewsIds(prev => prev.includes(id) ? prev : [...prev, id])

  // Ligar o som aproveita o clique para destravar o AudioContext — os avisos
  // seguintes vêm do polling, sem gesto nenhum por trás, e seriam bloqueados.
  const alternarSom = () => {
    const ligando = !avisos.som
    if (ligando) { destravarSom(); tocarAviso() }
    setAvisos(a => ({ ...a, som: ligando }))
  }

  // A permissão precisa ser pedida de dentro do clique, senão o navegador
  // ignora o pedido.
  const alternarNavegador = async () => {
    if (avisos.navegador) { setAvisos(a => ({ ...a, navegador: false })); return }
    if (!suportaNotificacao()) { flash('Este navegador não suporta notificações do sistema.'); return }
    const permissao = await pedirPermissao()
    if (permissao === 'granted') {
      setAvisos(a => ({ ...a, navegador: true }))
      flash('Avisos do navegador ativados.')
    } else if (permissao === 'denied') {
      flash('Permissão negada. Libere as notificações nas configurações do navegador.')
    }
  }
  const markAllNewsAsRead = () => setReadNewsIds(prev => Array.from(new Set([...prev, ...visibleNotifications.map(item => item.id)])))

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

  const isAdmin = !!authUser?.isAdmin
  const effectiveRoute = route.view === 'people' && !isAdmin ? { view: 'hub' } : route
  const currentProject = effectiveRoute.projectId ? projects.find(p => p.id === effectiveRoute.projectId) : null
  const normalizedSearch = projectSearch.trim().toLocaleLowerCase('pt-BR')
  const searchedProjects = normalizedSearch
    ? projects.filter(p => `${p.name} ${p.desc || ''}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    : projects
  // Papel efetivo do usuário no projeto aberto (admin/full/view).
  const currentRole = currentProject ? effectiveProjectRole(currentProject, authUser) : 'view'
  const canEditCurrent = canEditProject(currentRole)


  let screen
  if (effectiveRoute.view === 'hub') {
    screen = <Hub projects={projects} recentProjects={searchedProjects} tasks={tasks} onNavigate={navigate} sessions={sessions} currentUserId={currentUserId} now={now} />
  } else if (effectiveRoute.view === 'projects' && currentProject) {
    screen = <ProjectDetail project={currentProject} tasks={tasks} users={users} changes={changes}
      sessions={sessions} currentUserId={currentUserId} now={now} onStartTimer={startTimer} onStopTimer={stopTimer}
      canEdit={canEditCurrent} role={currentRole}
      initialTab={route.tab} focusId={route.focusId} focusNonce={route.focusNonce}
      onBack={() => setRoute({ view: 'projects' })} onEdit={openEditProject}
      onNewTask={openNewTask} onEditTask={openEditTask} onDeleteTask={askDeleteTask}
      onToggleChecklist={toggleChecklistItem}
      onCopyResource={copyResourceLink} onDeleteResource={(resource) => askDeleteResource(currentProject, resource)}
      onAddResource={openAddResource}
      onNewChange={openNewChange} onEditChange={openEditChange} onAckChange={ackChange} onDecideChange={decideChange} />
  } else if (effectiveRoute.view === 'projects') {
    screen = <ProjectList projects={searchedProjects} tasks={tasks} folders={folders} authUser={authUser} canCreate={isAdmin}
      onOpen={(id) => setRoute({ view: 'projects', projectId: id })}
      onEdit={openEditProject} onDelete={askDeleteProject} onNew={openNewProject} onMoveProject={moveProject} onMoveFolder={moveFolder} onNewSubfolder={createFolder} onDeleteFolder={askDeleteFolder} />
  } else if (effectiveRoute.view === 'list') {
    screen = <TaskListView tasks={tasks} projects={projects} users={users} authUser={authUser} filterProject={filterProject} mine={mine}
      currentUserId={currentUserId} onFilterProject={setFilterProject} onToggleMine={() => setMine(m => !m)}
      onMoveTask={moveTask} onNewTask={openNewTask} onEditTask={openEditTask} />
  } else if (effectiveRoute.view === 'kanban') {
    screen = <Kanban tasks={tasks} projects={projects} users={users} authUser={authUser} filterProject={filterProject} mine={mine}
      currentUserId={currentUserId} onFilterProject={setFilterProject} onToggleMine={() => setMine(m => !m)}
      onMoveTask={moveTask} onNewTask={openNewTask} onEditTask={openEditTask}
      sessions={sessions} now={now} onStartTimer={startTimer} onStopTimer={stopTimer} />
  } else if (effectiveRoute.view === 'gantt') {
    screen = <Gantt tasks={tasks} projects={projects} filterProject={filterProject} onFilterProject={setFilterProject} />
  } else if (effectiveRoute.view === 'people' && isAdmin) {
    screen = <People users={users} projects={projects} tasks={tasks} currentUserId={currentUserId}
      onNewPerson={openNewPerson} onEditPerson={openEditPerson} onDeletePerson={askDeletePerson} />
  } else if (effectiveRoute.view === 'reports') {
    screen = <Reports projects={projects} tasks={tasks} users={users} />
  } else if (effectiveRoute.view === 'team') {
    screen = <TeamReport users={users} tasks={tasks} projects={projects} sessions={sessions} now={now} isAdmin={isAdmin} onSetSector={setUserSector} />
  }

  return (
    <div className={'app' + (mobileNavOpen ? ' nav-open' : '')}>
      <Sidebar route={effectiveRoute} onNavigate={navigate} projects={searchedProjects} tasks={tasks}
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
        <TopBar title={currentProject ? currentProject.name : TITLES[effectiveRoute.view]} currentUser={authUser}
          canNewProject={isAdmin} onToggleMobileNav={() => setMobileNavOpen(o => !o)}
          onChangePassword={() => setModal({ type: 'password' })}
          onMySector={MY_SECTOR_ENABLED ? () => setModal({ type: 'mysector' }) : undefined}
          onLogout={handleLogout} onNewProject={openNewProject}
          tasks={tasks} projects={projects} sessions={sessions} now={now} onStartTimer={startTimer} onStopTimer={stopTimer}
          searchQuery={projectSearch} onSearchChange={setProjectSearch}
          notifications={visibleNotifications} unreadCount={unreadNotifications.length}
          readNewsIds={new Set(readNewsIds)} onMarkRead={markNewsAsRead} onMarkAllRead={markAllNewsAsRead}
          onOpenNotification={openNotification}
          onDismiss={askDismissNotification} onDismissAll={askDismissAllNotifications}
          avisos={avisos} onToggleSom={alternarSom} onToggleNavegador={alternarNavegador} />
        {/* O Suspense cobre a tela carregada sob demanda (Profissionais). As
            demais são síncronas e passam direto. */}
        <div className="content">
          <React.Suspense fallback={
            <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: 240, color: 'var(--fg-3)' }}>Carregando…</div>
          }>
            {screen}
          </React.Suspense>
        </div>
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
        <ChangeModal change={modal.change} projectId={modal.projectId} users={users}
          members={projects.find(p => p.id === modal.projectId)?.members || []}
          onSave={saveChange} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'project' && (
        <ProjectModal project={modal.project} users={users} folders={folders} defaultFolderId={modal.defaultFolderId} isAdmin={isAdmin} onSave={saveProject} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'person' && (
        <PeopleModal user={modal.user} currentUserId={currentUserId} projects={projects} tasks={tasks} changes={changes}
          onOpenProject={openProjectFromPerson} onSave={saveUser} onClose={() => setModal(null)} />
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
