import React from 'react'
import { Sidebar, TopBar } from './components/Chrome/Chrome.jsx'
import { Toast } from './components/primitives/primitives.jsx'
import { ErrorBoundary, lazyComAviso } from './components/ErrorBoundary.jsx'
import { fmtDur } from './components/TimeTracker/TimeTracker.jsx'
import { TaskModal, ProjectModal, MySectorModal, ConfirmDialog, ChangePasswordModal, DocumentModal, LinkModal, ImageModal,KmzModal, StageItemModal, StageActivitiesModal, ProjectSearchModal } from './components/Modals/Modals.jsx'
import { Hub } from './screens/Hub/Hub.jsx'
import { ProjectList, ProjectDetail } from './screens/Projects/Projects.jsx'
import { Kanban } from './screens/Kanban/Kanban.jsx'
import { TaskListView } from './screens/List/List.jsx'
import { Gantt } from './screens/Gantt/Gantt.jsx'
import { Login } from './screens/Login/Login.jsx'
import { api } from './data/api.js'
import { usePersistido } from './data/usePersistido.js'
import { effectiveProjectRole, canEditProject, estadoDoItem, NOTIF_KIND_MAP, STATUS_MAP, PROJECT_STATUS_MAP, etapasDoProjeto, fmtShort, PADRAO_ETAPA } from './data/store.js'
import { tocarAviso, destravarSom, avisarNoNavegador, pedirPermissao, permissaoNotificacao, suportaNotificacao } from './data/avisos.js'
// Promav app — root: dados vêm do backend (Express + Neon) via src/data/api.js.

// Telas e modais de uso raro ou só-admin (Profissionais, Relatórios, Equipe,
// relatório semanal, cadastro de pessoa, mudanças) carregam sob demanda: o AG
// Grid de Profissionais sozinho responde por ~1,2 MB, e sem isto todo mundo
// baixa no primeiro acesso tudo o que talvez nunca abra.
// Os módulos têm export nomeado, daí o mapeamento para default que o lazy exige.
const People = lazyComAviso(() => import('./screens/People/People.jsx').then(m => ({ default: m.People })))
const Reports = lazyComAviso(() => import('./screens/Reports/Reports.jsx').then(m => ({ default: m.Reports })))
const TeamReport = lazyComAviso(() => import('./screens/TeamReport/TeamReport.jsx').then(m => ({ default: m.TeamReport })))
const MyWeeklyReport = lazyComAviso(() => import('./screens/WeeklyReport/WeeklyReport.jsx').then(m => ({ default: m.MyWeeklyReport })))
const AdminWeeklyReports = lazyComAviso(() => import('./screens/WeeklyReport/WeeklyReport.jsx').then(m => ({ default: m.AdminWeeklyReports })))
const ChangeModal = lazyComAviso(() => import('./components/Modals/ChangeModal.jsx').then(m => ({ default: m.ChangeModal })))
const PersonCard = lazyComAviso(() => import('./components/Modals/PersonCard.jsx').then(m => ({ default: m.PersonCard })))
const PeopleModal = lazyComAviso(() => import('./components/Modals/PeopleModal.jsx').then(m => ({ default: m.PeopleModal })))

const TITLES ={ hub: 'Visão geral', projects: 'Projetos', list: 'Lista', kanban: 'Kanban', gantt: 'Gantt', people: 'Profissionais', reports: 'Relatórios', team: 'Equipe', myreport: 'Meu relatório', weeklyreports: 'Relatórios individuais' }

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

// Estado da atividade como a notificação o enuncia: minúsculas e no feminino
// ("atividade concluída"). O label de STATUS_MAP não serve aqui — é título
// de coluna ("Concluído") e a frase ficaria sem concordância.
const ESTADO_ATIV = { todo: 'a fazer', progress: 'em andamento', review: 'em revisão', diligence: 'em diligência', done: 'concluída' }

// Padrões do que fica guardado no navegador. Ficam fora do componente para a
// identidade não trocar a cada render.
const AVISOS_PADRAO = { som: true, navegador: false }
const SEM_IDS = []
// O aviso do navegador vale só se ele ainda estiver autorizado: a pessoa pode
// ter revogado a permissão nas configurações depois de ligar aqui.
const normAvisos = (salvo) => salvo
  ? { som: salvo.som !== false, navegador: !!salvo.navegador && permissaoNotificacao() === 'granted' }
  : AVISOS_PADRAO
const soLista = (xs) => Array.isArray(xs) ? xs : []

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
  const [searchOpen, setSearchOpen] = React.useState(false)
  // Em que pé está o relatório desta semana: 'nenhum', 'rascunho' ou 'enviado'.
  // Vem do bootstrap, então acompanha sozinho quando a pessoa salva ou envia.
  const [relatorioSemana, setRelatorioSemana] = React.useState('enviado')
  // Pasta aberta na lista de projetos. Fica aqui, e não dentro do ProjectList,
  // porque aquela tela desmonta ao abrir um projeto.
  const [pastaAberta, setPastaAberta] = React.useState(null)
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

  // O relógio só precisa correr de segundo em segundo quando o cronômetro da
  // PRÓPRIA pessoa está rodando — só a sessão dela é exibida em segundos; as
  // dos colegas entram apenas em totais por minuto. Sem essa guarda, o `now`
  // no topo da árvore re-renderizava o app inteiro 86.400 vezes por dia para
  // exibir números parados (e, para um administrador, bastava qualquer colega
  // cronometrando). Parado, um tique a cada 30s basta: serve para a virada do
  // dia no total de hoje e para os totais da equipe acompanharem o minuto.
  const cronometroAtivo = sessions.some(s => !s.end && s.userId === currentUserId)
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), cronometroAtivo ? 1000 : 30000)
    return () => clearInterval(t)
  }, [cronometroAtivo])

  // Sucesso some sozinho; erro fica até a pessoa fechar. São 27 das 60
  // mensagens do app, e 2,4 segundos não bastam para ler uma falha e ainda
  // decidir o que fazer com ela — ainda mais quando chegava com a mesma cara
  // de confirmação. Quem escreve a mensagem não precisa lembrar do tipo: é o
  // falhou() que se usa no catch.
  //
  // O id do temporizador fica num ref. Pendurado na própria função, ele se
  // perdia a cada render (a função é outra), o clearTimeout não achava nada e o
  // timer da mensagem anterior apagava a nova no meio da leitura.
  const toastTimer = React.useRef(null)
  const flash = (msg, tipo = 'ok') => {
    clearTimeout(toastTimer.current)
    setToast({ msg, tipo })
    if (tipo !== 'erro') toastTimer.current = setTimeout(() => setToast(null), 2400)
  }
  const falhou = (msg) => flash(msg, 'erro')

  // Busca todos os dados do backend (após autenticar).
  //
  // `silencioso` é para as recargas de fundo (pulso, handlers que reconciliam
  // o estado): uma falha ali vira toast, não a tela de erro — o app continua
  // de pé com o que já tinha. Só a carga inicial e o login derrubam para
  // "Não foi possível carregar os dados".
  //
  // O contador descarta a resposta de uma carga que outra atropelou: sem isso,
  // um bootstrap lento que chega depois de um mais novo (ou de uma edição
  // otimista) reescreve o estado com dados velhos.
  const falhouRef = React.useRef(() => {}); falhouRef.current = falhou // falhou é recriado a cada render; o useCallback lê sempre a versão atual
  const cargaRef = React.useRef(0)
  const loadData = React.useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setLoadError(null)
    const minha = ++cargaRef.current
    try {
      const data = await api.bootstrap()
      if (minha !== cargaRef.current) return // outra carga começou depois: esta resposta está velha
      setUsers(data.users); setProjects(data.projects); setTasks(data.tasks); setSessions(data.sessions); setFolders(data.folders || [])
      setChanges(data.changes || [])
      setRelatorioSemana(data.relatorioSemana || 'nenhum')
      setDataReady(true)
    } catch (err) {
      if (silencioso) falhouRef.current('Não foi possível atualizar os dados: ' + err.message)
      else setLoadError(err.message)
    }
  }, [])

  // Por que a tela de login voltou. Só a sessão vencida tem motivo: sair é
  // deliberado e não precisa de explicação.
  const [motivoLogin, setMotivoLogin] = React.useState(null)

  // Limpa a sessão (logout ou token expirado). O toast e os filtros também
  // saem: com a conta trocada, um "Projeto excluído." ainda na tela ou um
  // recorte por projeto que o próximo usuário nem enxerga são lixo da sessão
  // anterior.
  const handleLogout = React.useCallback((motivo = null) => {
    api.logout()
    clearTimeout(toastTimer.current); setToast(null)
    setAuthUser(null); setDataReady(false)
    setUsers([]); setProjects([]); setTasks([]); setSessions([]); setFolders([]); setChanges([])
    setModal(null); setMobileNavOpen(false)
    setFilterProject(null); setMine(false); setPastaAberta(null); setProjectSearch(''); setSearchOpen(false)
    // Sessão vencida guarda o lugar: entrando de novo, a pessoa volta para a
    // tela em que estava. Sair recomeça na visão geral.
    if (!motivo) setRoute({ view: 'hub' })
    setMotivoLogin(motivo)
  }, [])

  // Se a API responder 401 em qualquer chamada, derruba a sessão — dizendo por
  // quê, senão o login aparece do nada no meio de um formulário preenchido.
  React.useEffect(() => {
    api.setUnauthorizedHandler(() => handleLogout('Sua sessão expirou. Entre de novo para continuar de onde parou.'))
  }, [handleLogout])

  // Na carga: se houver token salvo, restaura a sessão.
  React.useEffect(() => {
    if (!api.hasToken()) { setBooting(false); return }
    api.me()
      .then(async (me) => { setAuthUser(me); await loadData() })
      .catch(() => { /* 401 já derrubou o token em req(); falha de rede mantém o token para a próxima carga */ })
      .finally(() => setBooting(false))
  }, [loadData])

  // ----- polling: mantém o app em dia sem recarregar a página -----
  // Consulta o /api/pulse (~100 bytes) e só refaz o /bootstrap (dezenas de KB) quando
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
        await loadData({ silencioso: true })
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

  // Aba aberta durante um deploy: o chunk com o hash antigo dá 404 no import
  // dinâmico e a tela sob demanda não abre. O Vite avisa por 'vite:preloadError'
  // (só no build) e recarregar busca o index novo.
  React.useEffect(() => {
    const aoFalharChunk = (e) => {
      // Com um modal aberto não recarrega: o formulário em edição iria embora.
      // O erro sobe para a boundary, que oferece o recarregar num botão.
      if (modalRef.current) return
      const k = 'promav-reload-chunk'
      try {
        const ultimo = Number(sessionStorage.getItem(k)) || 0
        if (Date.now() - ultimo < 60000) return
        sessionStorage.setItem(k, String(Date.now()))
      } catch { return } // sem storage não há como travar o laço: melhor deixar o erro subir
      // O preventDefault vem só depois das guardas: adiantá-lo faria o Vite
      // resolver o import com undefined, e o `.then(m => m.People)` estouraria.
      e.preventDefault()
      location.reload()
    }
    window.addEventListener('vite:preloadError', aoFalharChunk)
    return () => window.removeEventListener('vite:preloadError', aoFalharChunk)
  }, [])

  // Chamado pela tela de Login. Rejeita em caso de credenciais inválidas.
  const handleLogin = async (email, password) => {
    const user = await api.login(email, password)
    setAuthUser(user)
    setMotivoLogin(null)
    loadData()
  }

  const changePassword = async (currentPassword, newPassword) => {
    await api.changePassword(currentPassword, newPassword)
    setModal(null); flash('Senha atualizada.')
  }

  // O start/stop devolvem só as linhas que mexeram — a fechada e a aberta —, e
  // não a lista inteira de sessões: a mesclagem com o que já está na tela é
  // feita aqui.
  const mesclarSessoes = ({ fechadas = [], aberta = null }) => setSessions(prev => {
    const porId = new Map(fechadas.map(s => [s.id, s]))
    const base = prev.map(s => porId.get(s.id) || s)
    return aberta ? [...base, aberta] : base
  })
  const startTimer = async (taskId) => {
    try {
      mesclarSessoes(await api.startTimer(taskId))
      const t = tasks.find(x => x.id === taskId)
      flash(`Cronômetro iniciado${t ? ': ' + t.title : ''}.`)
    } catch (e) { falhou(e.message || 'Erro ao iniciar cronômetro.') }
  }
  const stopTimer = async () => {
    try { mesclarSessoes(await api.stopTimer()); flash('Cronômetro parado.') }
    catch (e) { falhou(e.message || 'Erro ao parar cronômetro.') }
  }

  const navigate = (r) => {
    // A aba e o item a destacar vêm das pendências do Hub: sem repassá-los, o
    // clique abria o projeto no Panorama, longe da etapa que motivou o clique.
    setRoute({ view: r.view, projectId: r.projectId, tab: r.tab, focusId: r.focusId, focusNonce: r.focusId ? Date.now() : undefined })
    // Ao abrir a Lista a partir de um projeto, já filtra por ele.
    if (r.view === 'list') setFilterProject(r.projectId || null)
    if (r.view === 'kanban') setMine(!!r.mine)
  }

  // A própria pessoa liga a conta ao setor em que trabalha.
  const saveMySector = async (sector) => {
    try {
      await api.setMySector(sector)
      setAuthUser(u => u ? { ...u, sector } : u)
      setUsers(us => us.map(u => u.id === currentUserId ? { ...u, sector } : u))
      // Só fecha se o modal na tela ainda for este: a resposta pode chegar
      // depois de a pessoa ter aberto outra coisa.
      setModal(m => m?.type === 'mysector' ? null : m)
      flash('Setor atualizado.')
    } catch (e) { falhou(e.message || 'Erro ao salvar o setor.') }
  }

  // Setor da pessoa — define quem é cobrado quando a mudança vai para um setor.
  const setUserSector = async (user, sector) => {
    try {
      await api.setUserSector(user.id, sector)
      setUsers(us => us.map(u => u.id === user.id ? { ...u, sector } : u))
      flash('Setor atualizado.')
    } catch (e) { falhou(e.message || 'Erro ao definir o setor.') }
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
      if (!data.id) await loadData({ silencioso: true }) // traz a atividade recém-criada
      setModal(m => m?.type === 'change' ? null : m)
      flash(data.id ? 'Mudança atualizada — a equipe precisa confirmar de novo.' : 'Mudança publicada e equipe avisada.')
    } catch (e) { falhou(e.message || 'Erro ao salvar a mudança.') }
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
      if (accept) await loadData({ silencioso: true })
      flash(accept ? 'Sugestão aceita — atividade criada no quadro.' : 'Sugestão recusada.')
    } catch (e) { falhou(e.message || 'Erro ao decidir a sugestão.') }
  }

  const ackChange = async (change) => {
    try {
      const saved = await api.ackChange(change.id)
      setChanges(cs => cs.map(c => c.id === saved.id ? saved : c))
      flash('Ciência confirmada.')
    } catch (e) { falhou(e.message || 'Erro ao confirmar.') }
  }

  // ----- projects -----
  const openNewProject = (folderId) => setModal({ type: 'project', defaultFolderId: typeof folderId === 'string' ? folderId : null })
  // Ver e editar são coisas diferentes: clicar numa pessoa abre a ficha, e
  // editar é um botão dentro dela. Antes o clique caía direto no formulário,
  // e quem só queria um telefone corria o risco de salvar sem querer.
  const openNewPerson = () => setModal({ type: 'personEdit' })
  const openPerson = (user) => setModal({ type: 'person', user })
  const openEditPerson = (user) => setModal({ type: 'personEdit', user })
  const openProjectFromPerson = (projectId) => { setModal(null); setRoute({ view: 'projects', projectId }) }
  // `tab` escolhe a aba com que o modal abre: a Ficha técnica manda para
  // 'tipo' quando a pessoa quer lançar a execução dos trechos do mapa.
  const openEditProject = (project, tab = 'geral') => setModal({ type: 'project', project, tab })
  const renameProject = async (project) => {
    const name = window.prompt('Novo nome do projeto:', project.name)
    if (name == null || !name.trim() || name.trim() === project.name) return
    try {
      const saved = await api.updateProject(project.id, { ...project, name: name.trim() })
      setProjects(ps => ps.map(p => p.id === saved.id ? saved : p)); flash('Projeto renomeado.')
    } catch (e) { falhou(e.message || 'Erro ao renomear projeto.') }
  }
  const saveProject = async (data) => {
    // O .kmz escolhido no modal não vai no corpo JSON do projeto: é um arquivo,
    // e sobe num segundo passo — depois de salvar, porque um projeto novo só
    // ganha id ao ser criado. Se o upload falhar, o resto do cadastro já está
    // gravado e o usuário só precisa reanexar o arquivo.
    const { kmzUpload, ...payload } = data
    try {
      let saved = payload.id ? await api.updateProject(payload.id, payload) : await api.createProject(payload)
      setProjects(ps => payload.id ? ps.map(p => p.id === saved.id ? saved : p) : [...ps, saved])
      const msg = payload.id ? 'Projeto atualizado.' : 'Projeto criado.'
      setModal(null)
      if (kmzUpload?.file) {
        try {
          saved = await api.uploadFile(saved.id, kmzUpload.file, 'kmz', kmzUpload.label || '')
          setProjects(ps => ps.map(p => p.id === saved.id ? saved : p))
          flash(`${msg} .kmz anexado.`)
        } catch (e) { falhou(`${msg} Mas o .kmz não foi enviado: ${e.message || 'erro no envio'}`) }
      } else flash(msg)
    } catch (e) { falhou(e.message || 'Erro ao salvar projeto.') }
  }
  const saveUser = async (data) => {
    try {
      const payload = {
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone?.trim() || null,
        shortName: data.shortName?.trim() || null,
        sector: data.sector || null,
        jobTitle: data.jobTitle?.trim() || null,
        formation: data.formation || null,
        professionalRegister: data.professionalRegister?.trim() || null,
        initials: data.initials || '',
        color: data.color || 'var(--proj-blue)',
        isAdmin: !!data.isAdmin,
        isActive: data.isActive !== false,
        isOutsourced: !!data.isOutsourced,
        initialPassword: data.initialPassword || undefined,
      }
      const saved = data.id ? await api.updateUser(data.id, payload) : await api.createUser(payload)
      setUsers(us => data.id ? us.map(u => u.id === saved.id ? saved : u) : [saved, ...us])
      setModal(null)
      flash(data.id ? 'Profissional atualizado.' : 'Profissional criado.')
    } catch (e) { falhou(e.message || 'Erro ao salvar profissional.') }
  }
  const askDeletePerson = (user) => setModal({
    type: 'confirm', title: 'Excluir profissional?',
    message: `"${user.name}" será removido permanentemente. Vínculos com projetos e atividades são desfeitos, e o histórico de cronômetro dessa pessoa é apagado. Essa ação não pode ser desfeita.`,
    onConfirm: async () => {
      try {
        await api.deleteUser(user.id)
        setUsers(us => us.filter(u => u.id !== user.id))
        setModal(null); flash('Profissional excluído.')
      } catch (e) { falhou(e.message || 'Erro ao excluir profissional.') }
    },
  })
  // Horas que a equipe registrou nas tarefas alvo. Somem junto com o DELETE
  // (a FK de time_sessions é ON DELETE CASCADE), e o confirm precisa dizer
  // isso: "as atividades serão removidas" não conta que um histórico de
  // cronômetro vai embora.
  const avisoHoras = (taskIds) => {
    const ids = new Set(taskIds)
    const ss = sessions.filter(s => ids.has(s.taskId))
    if (!ss.length) return ''
    const total = ss.reduce((acc, s) => acc + ((s.end || now) - s.start), 0)
    const aberto = ss.some(s => !s.end) ? ', incluindo um cronômetro em andamento' : ''
    return ` ${fmtDur(total)} de cronômetro registradas pela equipe também serão apagadas${aberto}.`
  }
  // Após excluir, as sessões das tarefas apagadas saem do estado na hora: Hub
  // e cronômetro não podem seguir mostrando horas de tarefa que não existe
  // até o próximo bootstrap.
  const askDeleteProject = (project) => {
    const idsTarefas = tasks.filter(t => t.projectId === project.id).map(t => t.id)
    setModal({
      type: 'confirm', title: 'Excluir projeto?',
      message: `As atividades de "${project.name}" também serão removidas.${avisoHoras(idsTarefas)} Essa ação não pode ser desfeita.`,
      onConfirm: async () => {
        try {
          await api.deleteProject(project.id)
          setProjects(ps => ps.filter(p => p.id !== project.id))
          setTasks(ts => ts.filter(t => t.projectId !== project.id))
          setSessions(ss => ss.filter(s => !idsTarefas.includes(s.taskId)))
          setModal(null); setRoute({ view: 'projects' }); flash('Projeto excluído.')
        } catch (e) { falhou(e.message || 'Erro ao excluir projeto.') }
      },
    })
  }

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
      setModal(m => m?.type === 'resource' ? null : m)
      flash('Material adicionado.')
    } catch (e) { falhou(e.message || 'Erro ao adicionar material.') }
  }

  // Copia o link de um recurso (documento/link) para a área de transferência.
  const copyResourceLink = async (resource) => {
    const url = resource.fileId ? api.fileUrl(resource.fileId) : resource.url
    try { await navigator.clipboard.writeText(url); flash('Link copiado.') }
    catch (e) { falhou('Não foi possível copiar o link.') }
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
      } catch (e) { falhou(e.message || 'Erro ao remover item.') }
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
    } catch (e) { falhou(e.message || 'Erro ao criar pasta.') }
  }
  const renameFolder = async (folder) => {
    const name = window.prompt('Novo nome da pasta:', folder.name)
    if (name == null || !name.trim() || name.trim() === folder.name) return
    try {
      const saved = await api.renameFolder(folder.id, name.trim())
      setFolders(fs => fs.map(f => f.id === saved.id ? saved : f)); flash('Pasta renomeada.')
    } catch (e) { falhou(e.message || 'Erro ao renomear pasta.') }
  }
  const askDeleteFolder = (folder) => setModal({
    type: 'confirm', title: 'Excluir pasta?',
    message: `A pasta "${folder.name}" e suas subpastas serão removidas. Os projetos dentro delas NÃO serão apagados — apenas ficarão sem pasta.`,
    onConfirm: async () => {
      try {
        await api.deleteFolder(folder.id)
        // Reúne a pasta + todas as descendentes (espelha o ON DELETE CASCADE do
        // banco). Lê `folders` da closure porque o ConfirmDialog segura a tela:
        // o pulso não recarrega com um modal aberto.
        const removed = new Set([folder.id])
        let grew = true
        while (grew) {
          grew = false
          for (const f of folders) {
            if (f.parentId && removed.has(f.parentId) && !removed.has(f.id)) { removed.add(f.id); grew = true }
          }
        }
        setFolders(fs => fs.filter(f => !removed.has(f.id)))
        // os projetos das pastas apagadas ficam "soltos" (espelha o ON DELETE SET NULL)
        setProjects(ps => ps.map(p => removed.has(p.folderId) ? { ...p, folderId: null } : p))
        setModal(null); flash('Pasta excluída.')
      } catch (e) { falhou(e.message || 'Erro ao excluir pasta.') }
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
    catch (e) { falhou(e.message || 'Erro ao mover pasta.'); loadData({ silencioso: true }) }
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
    catch (e) { falhou(e.message || 'Erro ao mover projeto.'); loadData({ silencioso: true }) }
  }

  // ----- tasks -----
  const openNewTask = (projectId, status) => setModal({ type: 'task', defaultProjectId: projectId, defaultStatus: status })
  // Pela aba Etapas, o padrão é criar uma etapa do template; a caixa no topo do
  // modal é que troca para avulsa. Nas outras telas segue avulsa, que é o que
  // elas sempre criaram.
  const openNewStage = (projectId) => setModal({ type: 'task', defaultProjectId: projectId, comoEtapa: true })

  // Pelo cronômetro abre só a lista de atividades. Guarda o id, não a etapa:
  // mudar o estado de uma atividade reescreve a etapa em `tasks`, e uma cópia
  // presa aqui mostraria o estado antigo até fechar e abrir de novo.
  const openStageActivities = (task) => setModal({ type: 'atividades', taskId: task.id })
  // Abrir a atividade conta como acesso: é o que adia a notificação daquilo
  // que a própria pessoa criou para si. Falha aqui não pode travar o modal —
  // o registro de leitura é secundário em relação a ver a atividade.
  const openEditTask = (task) => {
    setModal({ type: 'task', task })
    api.viewTask(task.id)
      .then(saved => setTasks(ts => ts.map(t => t.id === saved.id ? { ...t, views: saved.views } : t)))
      .catch(() => { /* registro de leitura é best-effort */ })
  }
  const saveTask = async (data) => {
    try {
      if (data.id) {
        const saved = await api.updateTask(data.id, data)
        setTasks(ts => ts.map(t => t.id === saved.id ? saved : t))
        flash(PADRAO_ETAPA.test(data.title || '') ? 'Etapa atualizada.' : 'Atividade atualizada.')
      } else {
        const saved = await api.createTask(data)
        setTasks(ts => [...ts, saved]); flash('Atividade criada.')
      }
      setModal(null)
    } catch (e) { falhou(e.message || 'Erro ao salvar atividade.') }
  }
  // Excluir etapa — uma pela lixeira da linha, ou várias pela seleção em massa.
  //
  // A pergunta muda conforme haja atividades dentro. Avisar que "as atividades
  // também serão excluídas" numa etapa vazia assusta à toa; e não avisar numa
  // cheia esconde o que o clique realmente faz.
  const askDeleteStages = (etapas, aoConcluir) => {
    const alvos = etapas.flatMap(e => e.tasks)
    const ids = alvos.map(t => t.id)
    const nAtividades = alvos.reduce((n, t) => n + (t.checklist || []).length, 0)
    const uma = etapas.length === 1
    const alvo = uma ? `a etapa "${etapas[0].n} · ${etapas[0].nome}"` : `estas ${etapas.length} etapas`
    setModal({
      type: 'confirm',
      title: uma ? 'Excluir etapa?' : `Excluir ${etapas.length} etapas?`,
      message: (nAtividades
        ? `Você quer excluir ${alvo} e suas ${nAtividades} atividade${nAtividades === 1 ? '' : 's'}?`
        : `Você quer excluir ${alvo}?`) + avisoHoras(ids),
      onConfirm: async () => {
        try {
          await api.bulkDeleteTasks(ids)
          setTasks(ts => ts.filter(t => !ids.includes(t.id)))
          setSessions(ss => ss.filter(s => !ids.includes(s.taskId)))
          setModal(null)
          aoConcluir?.()
          flash(uma ? 'Etapa excluída.' : `${etapas.length} etapas excluídas.`)
        } catch (e) { falhou(e.message || 'Erro ao excluir a etapa.') }
      },
    })
  }

  // Excluir UMA atividade de dentro da etapa, pela lixeira da linha.
  const askDeleteChecklistItem = (task, item) => setModal({
    type: 'confirm', title: 'Excluir atividade?',
    message: `Você quer excluir "${item.text}" desta etapa?`,
    onConfirm: async () => {
      try {
        const saved = await api.deleteChecklistItem(task.id, item.id)
        setTasks(ts => ts.map(t => t.id === saved.id ? saved : t))
        setModal(null); flash('Atividade excluída.')
      } catch (e) { falhou(e.message || 'Erro ao excluir a atividade.') }
    },
  })

  const askDeleteTask = (task) => setModal({
    type: 'confirm', title: PADRAO_ETAPA.test(task.title || '') ? 'Excluir etapa?' : 'Excluir atividade?',
    message: `"${task.title}" será removida permanentemente.${avisoHoras([task.id])}`,
    onConfirm: async () => {
      try {
        await api.deleteTask(task.id)
        setTasks(ts => ts.filter(t => t.id !== task.id)); setSessions(ss => ss.filter(s => s.taskId !== task.id))
        setModal(null); flash('Atividade excluída.')
      } catch (e) { falhou(e.message || 'Erro ao excluir atividade.') }
    },
  })
  // O rollback devolve só o card movido: restaurar o array inteiro de antes
  // apagaria o que outras ações mudaram enquanto o PATCH estava em voo.
  const moveTask = async (id, status) => {
    const antes = tasks.find(t => t.id === id)
    if (!antes || (antes.status || 'todo') === status) return // soltar na própria coluna não é mudança
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status } : t)) // otimista
    try {
      const saved = await api.moveTask(id, status)
      setTasks(ts => ts.map(t => t.id === saved.id ? saved : t))
      flash(`Atividade movida para ${STATUS_MAP[status]?.label ?? status}.`)
    } catch (e) { setTasks(ts => ts.map(t => t.id === id ? antes : t)); falhou(e.message || 'Erro ao mover atividade.') }
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
    } catch (e) { setTasks(ts => ts.map(t => t.id === task.id ? task : t)); falhou(e.message || 'Erro ao atualizar participação.') }
  }
  // Fluxo otimista comum aos ajustes de item: aplica o patch na cópia local,
  // manda só os campos que mudaram, troca pela etapa que o servidor devolveu
  // (status recalculado) e, se falhar, volta a etapa como estava.
  const patchItem = async (task, itemId, patch, msgErro) => {
    const next = (task.checklist || []).map(i => i.id === itemId ? { ...i, ...patch } : i)
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, checklist: next } : t))
    try {
      const saved = await api.patchChecklistItem(task.id, { id: itemId, ...patch })
      setTasks(ts => ts.map(t => t.id === saved.id ? saved : t))
    } catch (e) { setTasks(ts => ts.map(t => t.id === task.id ? task : t)); falhou(e.message || msgErro) }
  }

  // Marca/desmarca um item de checklist (otimista). Disponível também para 'Só exibição'.
  // Manda `state` e `done` juntos: o servidor dá precedência ao estado, e o
  // espelho explícito evita depender de qual ramo ele escolhe.
  const toggleChecklistItem = (task, itemId, feitoDoModal) => {
    const atual = (task.checklist || []).find(i => i.id === itemId)
    // Quem chama de dentro de um modal manda o valor novo: a `task` que ele tem
    // em mão é a cópia tirada na abertura e não acompanha os cliques anteriores,
    // então recalcular dali reenviaria done:true no segundo clique.
    const feito = feitoDoModal ?? (estadoDoItem(atual) !== 'done')
    return patchItem(task, itemId, { state: feito ? 'done' : 'todo', done: feito }, 'Erro ao atualizar checklist.')
  }

  // Move o item entre pendente / em revisão / em diligência / concluído.
  // Liberado para 'Só exibição' pelo mesmo motivo do marcar: quem faz o
  // serviço registra em que pé ele está. O status da ETAPA volta já
  // recalculado pelo servidor — é ele que espelha o pior estado dos itens.
  const setChecklistState = (task, itemId, state) =>
    patchItem(task, itemId, { state, done: state === 'done' }, 'Erro ao mudar o estado do item.')

  // Corrige o texto de um item no lugar. Antes era apagar e recriar, o que
  // jogava fora o dono do item, a posição dele na lista e o que já estava
  // marcado — um erro de digitação custava os três.
  const editChecklistItem = (task, itemId, text) => {
    const limpo = String(text || '').trim()
    const atual = (task.checklist || []).find(i => i.id === itemId)
    if (!limpo || !atual || limpo === atual.text) return
    return patchItem(task, itemId, { text: limpo }, 'Erro ao editar o item.')
  }

  // "Nova atividade" na aba Etapas: escolhe a etapa e o trabalho entra como
  // item do checklist dela, em vez de nascer como atividade solta em "Outras".
  const openStageItem = (projectId, stageTaskId = null) =>
    setModal({ type: 'stageItem', projectId, stageTaskId })

  // Várias atividades de uma vez, numa ida só ao servidor — a tela deixa
  // escrever uma lista, e um pedido por linha repetiria o custo de rede que o
  // "criar template" já teve.
  const addStageItems = async (taskId, items) => {
    try {
      const saved = await api.addChecklistItems(taskId, items)
      setTasks(ts => ts.map(t => t.id === saved.id ? saved : t))
      setModal(m => m?.type === 'stageItem' ? null : m)
      flash(items.length === 1 ? 'Atividade adicionada à etapa.' : `${items.length} atividades adicionadas à etapa.`)
    } catch (e) { falhou(e.message || 'Erro ao adicionar as atividades.') }
  }

  // Cria de uma vez as etapas do processo que faltam no projeto. É idempotente
  // no servidor — clicar duas vezes não duplica.
  //
  // A rota devolve as etapas já montadas, então elas entram direto no estado.
  // Antes vinha só a contagem e era preciso um loadData() atrás, ou seja, o
  // bootstrap inteiro de novo — a parte mais demorada do clique, e a única que
  // crescia junto com o resto do banco.
  const createStages = async (projectId) => {
    try {
      const r = await api.createStages(projectId)
      if (r.tasks?.length) setTasks(ts => [...ts, ...r.tasks])
      else await loadData({ silencioso: true }) // nada novo: releitura barata que reconcilia o estado
      flash(r.criadas ? `${r.criadas} etapa${r.criadas === 1 ? '' : 's'} criada${r.criadas === 1 ? '' : 's'}.` : 'O projeto já tem todas as etapas.')
    } catch (e) { falhou(e.message || 'Erro ao criar as etapas.') }
  }

  // Liga um item do checklist a alguém da atividade (ou a ninguém, com null).
  // Usa a mesma rota do marcar: o servidor só toca no campo que veio no corpo.
  const assignChecklistItem = (task, itemId, userId) =>
    patchItem(task, itemId, { assigneeId: userId }, 'Erro ao atribuir o item.')

  const newsKey = authUser ? `promav-news-${authUser.id}` : null
  const dismissedKey = authUser ? `promav-news-limpas-${authUser.id}` : null
  const avisosKey = authUser ? `promav-avisos-${authUser.id}` : null

  const [readNewsIds, setReadNewsIds] = usePersistido(newsKey, SEM_IDS, soLista)
  // Notificações limpas pela pessoa. Some da lista para sempre — ao contrário
  // de "lida", que só tira o destaque. É por usuário e fica só neste navegador.
  const [dismissedNewsIds, setDismissedNewsIds] = usePersistido(dismissedKey, SEM_IDS, soLista)
  // Preferências de aviso. Som já entra ligado (é discreto e não pede
  // permissão); a notificação do sistema começa desligada porque depende de a
  // pessoa autorizar no navegador.
  const [avisos, setAvisos] = usePersistido(avisosKey, AVISOS_PADRAO, normAvisos)

  // As duas listas de ids só crescem; aqui saem as de entidade que já não
  // existe. Não dá para podar contra `notifications`: aquela lista oscila (corte
  // em 20, o repouso de 3 dias, o aviso de projeto que some quando há
  // atividade) e uma notificação limpa ressuscitaria.
  React.useEffect(() => {
    if (!newsKey || !dataReady) return // sem bootstrap, nenhuma entidade é conhecida
    const vivo = (id) => {
      if (id.startsWith('task-')) return tasks.some(t => `task-${t.id}` === id)
      if (id.startsWith('project-')) return projects.some(p => `project-${p.id}` === id)
      if (id.startsWith('change-') || id.startsWith('ack-')) return changes.some(c => id === `change-${c.id}` || id === `change-task-${c.id}` || id.startsWith(`ack-${c.id}-`))
      return true
    }
    const poda = (xs) => { const r = xs.filter(vivo); return r.length === xs.length ? xs : r }
    setReadNewsIds(poda); setDismissedNewsIds(poda)
  }, [tasks, changes, projects, newsKey, dataReady])

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
          text: `${project.name} • ${ESTADO_ATIV[task.status] ?? task.status}`,
          time: 'Hoje',
          priority: 4,
          target: { view: 'projects', projectId: project.id, tab: 'etapas', focusId: `task-${task.id}` },
        })
      }

      // Processa atualizações importantes do projeto SOMENTE se não há mudanças/atividades desse projeto
      if (!projectsWithRelevantActivity.has(project.id) && (project.status || project.start || project.end || project.valorEstimado || project.valorOrcado)) {
        push('projeto', {
          id: `project-${project.id}`,
          title: `Atualização importante em ${project.name}`,
          text: `${project.status ? `Status: ${PROJECT_STATUS_MAP[project.status]?.label ?? project.status}` : 'Dados do projeto foram atualizados'}${project.start || project.end ? ` • ${project.start ? fmtShort(project.start) : '—'} até ${project.end ? fmtShort(project.end) : '—'}` : ''}`,
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

  // Conjuntos, e não includes: as duas listas são varridas uma vez por
  // notificação e crescem com o uso da conta.
  const lidas = new Set(readNewsIds)
  const limpas = new Set(dismissedNewsIds)
  // O que a pessoa realmente vê: tudo que ela não limpou.
  const visibleNotifications = notifications.filter(item => !limpas.has(item.id))

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
  const unreadNotifications = visibleNotifications.filter(item => !lidas.has(item.id))

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
      type: 'confirm', title: 'Limpar todas as notificações?', confirmLabel: 'Limpar',
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
    if (!suportaNotificacao()) { falhou('Este navegador não suporta notificações do sistema.'); return }
    const permissao = await pedirPermissao()
    if (permissao === 'granted') {
      setAvisos(a => ({ ...a, navegador: true }))
      flash('Avisos do navegador ativados.')
    } else if (permissao === 'denied') {
      falhou('Permissão negada. Libere as notificações nas configurações do navegador.')
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
  if (!authUser) return <Login onLogin={handleLogin} motivo={motivoLogin} />

  // Autenticado, mas os dados ainda não chegaram (ou falharam).
  if (!dataReady || loadError) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--fg-3)', maxWidth: 420, padding: 24 }}>
          {loadError ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-1)', marginBottom: 8 }}>Não foi possível carregar os dados</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{loadError}</div>
              <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => loadData()}>Tentar de novo</button>
            </>
          ) : 'Carregando…'}
        </div>
      </div>
    )
  }

  const isAdmin = !!authUser?.isAdmin
  // Telas de admin acessadas por quem não é admin caem na visão geral. A rota
  // pode chegar por link antigo ou por quem perdeu o papel desde que entrou.
  const soAdmin = route.view === 'people' || route.view === 'weeklyreports'
  const effectiveRoute = soAdmin && !isAdmin ? { view: 'hub' } : route
  const currentProject = effectiveRoute.projectId ? projects.find(p => p.id === effectiveRoute.projectId) : null
  // Papel efetivo do usuário no projeto aberto (admin/full/view).
  const currentRole = currentProject ? effectiveProjectRole(currentProject, authUser) : 'view'
  const canEditCurrent = canEditProject(currentRole)


  // Kanban, Lista e Gantt aparecem como tela e embutidos na aba do projeto. Uma
  // montagem só para os dois lugares: duas tiravam a garantia de que as ~12
  // props são as mesmas nos dois.
  const propsTarefas = { tasks, projects, users, authUser, mine, currentUserId, onFilterProject: setFilterProject, onToggleMine: () => setMine(m => !m), onMoveTask: moveTask, onNewTask: openNewTask, onEditTask: openEditTask }
  const telaDeTarefas = (view, filtro, embedded = false) => view === 'kanban'
    ? <Kanban embedded={embedded} filterProject={filtro} sessions={sessions} now={now} onStartTimer={startTimer} onStopTimer={stopTimer} {...propsTarefas} />
    : view === 'list'
    ? <TaskListView embedded={embedded} filterProject={filtro} {...propsTarefas} />
    : <Gantt embedded={embedded} tasks={tasks} projects={projects} filterProject={filtro} onFilterProject={setFilterProject} />

  let screen
  if (effectiveRoute.view === 'hub') {
    screen = <Hub projects={projects} tasks={tasks} changes={changes}
      onNavigate={navigate} sessions={sessions} currentUserId={currentUserId} authUser={authUser}
      relatorioSemana={relatorioSemana} now={now} />
  } else if (effectiveRoute.view === 'projects' && currentProject) {
    screen = <ProjectDetail project={currentProject} tasks={tasks} users={users} changes={changes}
      sessions={sessions} currentUserId={currentUserId} now={now} onStartTimer={startTimer} onStopTimer={stopTimer}
      canEdit={canEditCurrent} role={currentRole}
      initialTab={route.tab} focusId={route.focusId} focusNonce={route.focusNonce}
      // Voltar leva à pasta DO PROJETO, não à última que estava aberta nem à
      // raiz: quem chegou aqui pela barra lateral ou pela busca nunca navegou
      // por pasta nenhuma, e ainda assim é ali que ele quer continuar.
      onBack={() => { setPastaAberta(currentProject.folderId || null); setRoute({ view: 'projects' }) }}
      onEdit={openEditProject}
      renderVisao={(v) => telaDeTarefas(v, currentProject.id, true)}
      onEditTask={openEditTask} onDeleteTask={askDeleteTask}
      onAssignChecklist={assignChecklistItem} onMoveTask={moveTask}
      onSetChecklistState={setChecklistState} onEditChecklistItem={editChecklistItem}
      onExcluirChecklistItem={askDeleteChecklistItem} onDeleteStages={askDeleteStages} onNewStage={openNewStage}
      onNewStageItem={openStageItem} onCreateStages={createStages}
      onCopyResource={copyResourceLink} onDeleteResource={(resource) => askDeleteResource(currentProject, resource)}
      onAddResource={openAddResource}
      onNewChange={openNewChange} onEditChange={openEditChange} onAckChange={ackChange} onDecideChange={decideChange} />
  } else if (effectiveRoute.view === 'projects') {
    screen = <ProjectList projects={projects} tasks={tasks} folders={folders} authUser={authUser} canCreate={isAdmin}
      openId={pastaAberta} onOpenFolder={setPastaAberta}
      onOpen={(id) => setRoute({ view: 'projects', projectId: id })}
      onEdit={openEditProject} onDelete={askDeleteProject} onNew={openNewProject} onMoveProject={moveProject} onMoveFolder={moveFolder} onNewSubfolder={createFolder} onDeleteFolder={askDeleteFolder} />
  } else if (effectiveRoute.view === 'list') {
    screen = telaDeTarefas('list', filterProject)
  } else if (effectiveRoute.view === 'kanban') {
    screen = telaDeTarefas('kanban', filterProject)
  } else if (effectiveRoute.view === 'gantt') {
    screen = telaDeTarefas('gantt', filterProject)
  } else if (effectiveRoute.view === 'people' && isAdmin) {
    screen = <People users={users} projects={projects} tasks={tasks} currentUserId={currentUserId}
      onNewPerson={openNewPerson} onOpenPerson={openPerson} onEditPerson={openEditPerson} onDeletePerson={askDeletePerson} />
  } else if (effectiveRoute.view === 'reports') {
    screen = <Reports projects={projects} tasks={tasks} users={users} />
  } else if (effectiveRoute.view === 'team') {
    screen = <TeamReport users={users} tasks={tasks} projects={projects} sessions={sessions} now={now} isAdmin={isAdmin} onSetSector={setUserSector} />
  } else if (effectiveRoute.view === 'myreport') {
    screen = <MyWeeklyReport authUser={authUser} projects={projects} onFlash={flash} onFail={falhou} />
  } else if (effectiveRoute.view === 'weeklyreports' && isAdmin) {
    screen = <AdminWeeklyReports users={users} projects={projects} />
  }

  return (
    <div className={'app' + (mobileNavOpen ? ' nav-open' : '')}>
      <Sidebar route={effectiveRoute} onNavigate={navigate} projects={projects}
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
          onOpenTask={openStageActivities}
          searchQuery={projectSearch} onSearchChange={(v) => { setProjectSearch(v); setSearchOpen(true) }}
          notifications={visibleNotifications} unreadCount={unreadNotifications.length}
          readNewsIds={lidas} onMarkRead={markNewsAsRead} onMarkAllRead={markAllNewsAsRead}
          onOpenNotification={openNotification}
          onDismiss={askDismissNotification} onDismissAll={askDismissAllNotifications}
          avisos={avisos} onToggleSom={alternarSom} onToggleNavegador={alternarNavegador} />
        {/* O Suspense cobre as telas carregadas sob demanda. A boundary em
            volta guarda a barra lateral e o topo: sem ela, uma exceção na tela
            derruba o app inteiro. O reset vai por `resetKey`, e não por `key`: a view
            'projects' cobre a lista e o detalhe de todos os projetos, e
            remontar a cada troca jogaria o ProjectDetail de volta ao Panorama. */}
        <div className="content">
          <ErrorBoundary
            resetKey={`${effectiveRoute.view}:${effectiveRoute.projectId || ''}`}
            onReset={() => { setModal(null); navigate({ view: 'hub' }) }}>
            <React.Suspense fallback={
              <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: 240, color: 'var(--fg-3)' }}>Carregando…</div>
            }>
              {screen}
            </React.Suspense>
          </ErrorBoundary>
        </div>
      </div>

      {/* Os modais são irmãos do .main, fora da boundary da tela: uma exceção
          aqui subiria até a raiz e levaria a barra lateral e o topo junto.
          Os três carregados sob demanda levam Suspense próprio: sem ele o React
          18 derruba a árvore enquanto o chunk ainda não chegou. */}
      <ErrorBoundary
        resetKey={modal?.type || (searchOpen ? 'search' : '')}
        onReset={() => { setModal(null); setSearchOpen(false) }}
        fallback={(err, reset) => (
          <div className="scrim" onMouseDown={reset}>
            <div className="modal" style={{ padding: 24, textAlign: 'center' }}>
              <p>Não foi possível abrir esta janela.</p>
              {/* A frase principal fica genérica porque esta boundary cobre qualquer
                  exceção de render de qualquer modal; a mensagem do erro entra como
                  linha de apoio. O recarregar precisa estar aqui: quando o que falha é
                  o chunk de um modal sob demanda, o handler de 'vite:preloadError'
                  desiste (há modal aberto) e reabrir falha igual, porque o navegador
                  guarda o 404 daquela URL no module map — sem este botão não há saída. */}
              {err?.message && <p style={{ color: 'var(--fg-3)' }}>{String(err.message)}</p>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button type="button" className="btn btn-secondary" onClick={reset}>Fechar</button>
                <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Recarregar a página</button>
              </div>
            </div>
          </div>
        )}>
        {modal?.type === 'task' && (() => {
          // O papel vale por PROJETO, inclusive ao criar: o alvo é o projeto que
          // veio no clique. Com `isAdmin` no lugar disso, quem tem Edição total
          // sem ser administrador abria o formulário em somente leitura.
          const pidAlvo = modal.task?.projectId || modal.defaultProjectId
          const podeEditarAlvo = canEditProject(effectiveProjectRole(projects.find(p => p.id === pidAlvo), authUser))
          // O projeto da etapa aberta fica na lista mesmo sem edição, senão o
          // <select> de Projeto ficaria com um value sem opção correspondente.
          const projetosEditaveis = projects.filter(p => canEditProject(effectiveProjectRole(p, authUser)) || p.id === modal.task?.projectId)
          return (
            <TaskModal task={modal.task} projects={projetosEditaveis} tasks={tasks} users={users} currentUserId={currentUserId}
              defaultProjectId={modal.defaultProjectId} defaultStatus={modal.defaultStatus} comoEtapa={modal.comoEtapa}
              canEdit={podeEditarAlvo}
              onToggleChecklist={toggleChecklistItem} onToggleMembership={toggleMyMembership}
              onSave={saveTask} onClose={() => setModal(null)} />
          )
        })()}
        {modal?.type === 'atividades' && (() => {
          const etapa = tasks.find(t => t.id === modal.taskId)
          return etapa ? (
            <StageActivitiesModal task={etapa} project={projects.find(p => p.id === etapa.projectId)}
              users={users} onSetState={setChecklistState}
              onAbrirEtapa={(t) => openEditTask(t)} onClose={() => setModal(null)} />
          ) : null
        })()}
        {searchOpen && (
          <ProjectSearchModal query={projectSearch} onQueryChange={setProjectSearch} projects={projects}
            onOpen={(id) => { setSearchOpen(false); setProjectSearch(''); setRoute({ view: 'projects', projectId: id }) }}
            onClose={() => { setSearchOpen(false); setProjectSearch('') }} />
        )}
        {modal?.type === 'mysector' && (
          <MySectorModal current={authUser?.sector} onSubmit={saveMySector} onClose={() => setModal(null)} />
        )}
        {modal?.type === 'change' && (
          <React.Suspense fallback={null}>
            <ChangeModal change={modal.change} projectId={modal.projectId} users={users} tasks={tasks}
              members={projects.find(p => p.id === modal.projectId)?.members || []}
              onSave={saveChange} onClose={() => setModal(null)} />
          </React.Suspense>
        )}
        {modal?.type === 'project' && (
          <ProjectModal project={modal.project} users={users} folders={folders} defaultFolderId={modal.defaultFolderId} isAdmin={isAdmin}
            initialTab={modal.tab} onSave={saveProject} onClose={() => setModal(null)} />
        )}
        {modal?.type === 'person' && (
          <React.Suspense fallback={null}>
            <PersonCard user={modal.user} projects={projects} tasks={tasks}
              onEdit={openEditPerson} onClose={() => setModal(null)} />
          </React.Suspense>
        )}
        {modal?.type === 'personEdit' && (
          <React.Suspense fallback={null}>
            <PeopleModal user={modal.user} currentUserId={currentUserId} users={users} projects={projects} tasks={tasks} changes={changes}
              onOpenProject={openProjectFromPerson} onSave={saveUser} onClose={() => setModal(null)} />
          </React.Suspense>
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
        {modal?.type === 'resource' && modal.resType === 'kmz' && (
          <KmzModal onSave={saveResource} onClose={() => setModal(null)} />
        )}
        {modal?.type === 'stageItem' && (
          <StageItemModal
            etapas={etapasDoProjeto(tasks, modal.projectId)}
            users={users}
            members={projects.find(p => p.id === modal.projectId)?.members || []}
            defaultStageId={modal.stageTaskId}
            onSave={addStageItems}
            onClose={() => setModal(null)} />
        )}
        {modal?.type === 'confirm' && (
          <ConfirmDialog title={modal.title} message={modal.message} confirmLabel={modal.confirmLabel} onConfirm={modal.onConfirm} onClose={() => setModal(null)} />
        )}
        {modal?.type === 'password' && (
          <ChangePasswordModal onSubmit={changePassword} onClose={() => setModal(null)} />
        )}
      </ErrorBoundary>
      <Toast aviso={toast} onClose={() => setToast(null)} />
    </div>
  )
}
