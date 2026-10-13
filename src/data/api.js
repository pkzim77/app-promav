// Cliente da API do backend (Express + Neon). O Vite faz proxy de /api.
// As respostas já vêm no formato que as telas consomem (ids/labels de store.js).

// Em dev, VITE_API_URL é vazio → usa /api (proxy do Vite).
// Em produção, VITE_API_URL = URL do serviço promav-api no Render (ver .env.production e render.yaml).
// A barra final da variável é descartada: "https://x/" + "/api" daria "//api" e 404 em tudo.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api'
const TOKEN_KEY = 'promav-token'

let token = null
try { token = localStorage.getItem(TOKEN_KEY) } catch { /* ignore */ }

function setToken(t) {
  token = t
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

// Chamado quando o token é rejeitado (401) — limpa a sessão e avisa o app.
let onUnauthorized = () => {}

// Nestas rotas o 401 é credencial errada, não token vencido: derrubar a sessão
// por uma senha atual digitada errado jogava a pessoa para a tela de login.
const SEM_DERRUBAR = new Set(['/auth/login', '/auth/change-password'])

// fetch só rejeita quando a requisição nem chegou (servidor dormindo no Render,
// rede caída). O 'Failed to fetch' do navegador ia cru para o toast, em inglês.
function erroDeRede(causa) {
  const err = new Error('Não foi possível falar com o servidor. Ele pode estar reiniciando — confira a conexão e tente de novo em instantes.')
  err.rede = true
  err.cause = causa
  return err
}

async function fetchOuSemRede(url, init) {
  try { return await fetch(url, init) } catch (e) { throw erroDeRede(e) }
}

async function lerResposta(res, path) {
  if (res.status === 401 && !SEM_DERRUBAR.has(path)) {
    setToken(null)
    onUnauthorized()
  }
  if (!res.ok) {
    // 'Erro 404' e não '404': sem corpo JSON o número cru aparecia sozinho no
    // toast, como se fosse a mensagem.
    let msg = `Erro ${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* corpo não-JSON */ }
    throw new Error(msg)
  }
  return res.status === 204 ? null : res.json()
}

async function req(method, path, body) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  // Serializa ANTES do fetch: corpo que não vira JSON é erro de programação, e
  // não pode se disfarçar de falha de rede.
  const payload = body !== undefined ? JSON.stringify(body) : undefined
  const res = await fetchOuSemRede(BASE + path, { method, headers, body: payload })
  return lerResposta(res, path)
}

export const api = {
  hasToken: () => !!token,
  setUnauthorizedHandler: (fn) => { onUnauthorized = fn },

  // ----- auth -----
  login: async (email, password) => {
    const { token: t, user } = await req('POST', '/auth/login', { email, password })
    setToken(t)
    return user
  },
  me: () => req('GET', '/auth/me'),
  logout: () => setToken(null),
  changePassword: (currentPassword, newPassword) => req('POST', '/auth/change-password', { currentPassword, newPassword }),

  // ----- dados -----
  bootstrap: () => req('GET', '/bootstrap'),

  createProject: (data) => req('POST', '/projects', data),
  updateProject: (id, data) => req('PUT', `/projects/${id}`, data),
  deleteProject: (id) => req('DELETE', `/projects/${id}`),

  // ----- pastas (agrupam projetos na sidebar) -----
  createFolder: (name, parentId = null) => req('POST', '/folders', { name, parentId }),
  renameFolder: (id, name) => req('PUT', `/folders/${id}`, { name }),
  deleteFolder: (id) => req('DELETE', `/folders/${id}`),
  reorderFolders: (parentId, orderedIds) => req('PUT', '/folders/reorder', { parentId, orderedIds }),
  reorderProjects: (folderId, orderedIds) => req('PUT', '/projects/reorder', { folderId, orderedIds }),

  // ----- relatório semanal -----
  // A semana vai como a sexta que a encerra; o servidor normaliza de novo, para
  // não depender do fuso de quem clicou.
  weeklyReportMine: (week) => req('GET', `/weekly-reports/me?week=${week}`),
  saveWeeklyReport: (data) => req('PUT', '/weekly-reports/me', data),
  weeklyReports: (week) => req('GET', `/weekly-reports?week=${week}`),

  // ----- arquivos (upload/download de documentos e imagens guardados no banco) -----
  // Envia o arquivo cru; metadados (tipo, nome, rótulo) vão na query string.
  uploadFile: async (projectId, file, kind, label = '') => {
    const qs = new URLSearchParams({ kind, filename: file.name, label, mime: file.type || 'application/octet-stream' })
    // Enviamos sempre como octet-stream para o express.json não tentar parsear
    // arquivos .json; o mime real vai na query string.
    const headers = { 'Content-Type': 'application/octet-stream' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetchOuSemRede(`${BASE}/projects/${projectId}/files?${qs}`, { method: 'POST', headers, body: file })
    return lerResposta(res, `/projects/${projectId}/files`)
  },
  // Tokens de link dos arquivos, em lote: { [fileId]: token }. Cada token abre
  // só o arquivo dele. O token de SESSÃO não vai mais para a URL — bastava
  // receber um link copiado para entrar na conta de quem copiou, por 7 dias e
  // em qualquer rota. Arquivo que a pessoa não enxerga não vem na resposta.
  fileTokens: (ids) => req('POST', '/files/tokens', { ids }),
  // Monta a URL a partir de um token já em mãos. Separado de fileTokens para a
  // tela pedir todos de uma vez e montar as URLs sem voltar à rede.
  linkDeArquivo: (fileId, t) => `${BASE}/files/${fileId}?t=${encodeURIComponent(t)}`,
  // Link de um arquivo só, para quando não há lote (o "Baixar .kmz" do modal).
  fileLink: async (fileId) => {
    const ts = await api.fileTokens([fileId])
    if (!ts[fileId]) throw new Error('Não foi possível gerar o link deste arquivo.')
    return api.linkDeArquivo(fileId, ts[fileId])
  },
  // Baixa o arquivo para ler no navegador (o .kmz do mapa). Vai com o header
  // Authorization: aqui quem busca é o próprio app, não uma tag <img>/<a>,
  // então não há motivo para token nenhum aparecer na URL.
  fetchFile: async (fileId) => {
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetchOuSemRede(`${BASE}/files/${fileId}`, { headers })
    if (!res.ok) throw new Error('Não foi possível baixar o arquivo do servidor.')
    return res
  },

  // Adiciona um material (link) — permitido também para 'Só exibição'.
  addResource: (projectId, resource) => req('POST', `/projects/${projectId}/resources`, resource),
  // Remove um material — exige Edição total.
  deleteResource: (projectId, resourceId) => req('DELETE', `/projects/${projectId}/resources/${resourceId}`),
  // Mexe num item só, mandando apenas os campos que mudaram: o servidor toca
  // no que vier e ignora o resto. Mandar o item inteiro faria o backend achar
  // que o texto está sendo editado e cobrar Edição total de quem só marcou.
  patchChecklistItem: (taskId, item) => req('PATCH', `/tasks/${taskId}/checklist`, { checklist: [item] }),
  // Entrar/sair de uma atividade (só a própria participação) — permitido para 'Só exibição'.
  toggleMembership: (taskId, join) => req('POST', `/tasks/${taskId}/membership`, { join }),

  createTask: (data) => req('POST', '/tasks', data),
  updateTask: (id, data) => req('PUT', `/tasks/${id}`, data),
  deleteTask: (id) => req('DELETE', `/tasks/${id}`),
  moveTask: (id, status) => req('PATCH', `/tasks/${id}/status`, { status }),
  // Carimbo barato do estado do banco (~100 bytes) — ver o polling em App.jsx.
  pulse: () => req('GET', '/pulse'),
  // Registra que a pessoa abriu a atividade — permitido para 'Só exibição'.
  viewTask: (id) => req('POST', `/tasks/${id}/view`),
  // Textos de item já usados, por número de etapa. Só dos projetos que a pessoa
  // enxerga — o servidor filtra, não o cliente.
  checklistSuggestions: () => req('GET', '/checklist-suggestions'),

  // Acrescenta uma ou VÁRIAS atividades a uma etapa, numa ida só — exige Edição
  // total. A tela deixa escrever uma lista, e um pedido por linha repetiria o
  // custo de rede que o "criar template" já teve.
  addChecklistItems: (taskId, items) => req('POST', `/tasks/${taskId}/checklist`, { items }),

  // Remove UMA atividade da etapa, sem reescrever o checklist inteiro.
  deleteChecklistItem: (taskId, itemId) => req('DELETE', `/tasks/${taskId}/checklist/${itemId}`),

  // Exclui várias etapas de uma vez (seleção em massa da aba Etapas).
  bulkDeleteTasks: (ids) => req('POST', '/tasks/bulk-delete', { ids }),

  // Cria de uma vez as etapas do processo que faltam no projeto.
  createStages: (projectId) => req('POST', `/projects/${projectId}/stages`),

  // ----- mudanças do projeto (orientações) -----
  publishChange: (projectId, data) => req('POST', `/projects/${projectId}/changes`, data),
  updateChange: (id, data) => req('PUT', `/changes/${id}`, data),
  ackChange: (id) => req('POST', `/changes/${id}/ack`),
  decideChange: (id, accept, reason) => req('POST', `/changes/${id}/decide`, { accept, reason }),
  createUser: (data) => req('POST', '/users', data),
  updateUser: (id, data) => req('PUT', `/users/${id}`, data),
  deleteUser: (id) => req('DELETE', `/users/${id}`),
  setUserSector: (id, sector) => req('PUT', `/users/${id}/sector`, { sector }),
  setMySector: (sector) => req('POST', '/auth/sector', { sector }),

  startTimer: (taskId) => req('POST', '/sessions/start', { taskId }),
  stopTimer: () => req('POST', '/sessions/stop'),
}
