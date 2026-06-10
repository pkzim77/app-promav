// Cliente da API do backend (Express + Neon). O Vite faz proxy de /api.
// As respostas já vêm no mesmo formato dos seeds de store.js.

// Em dev, VITE_API_URL é vazio → usa /api (proxy do Vite).
// Em produção (build do Firebase), VITE_API_URL = URL do Cloud Run → ex.: https://promav-api-xxx.run.app
const BASE = (import.meta.env.VITE_API_URL || '') + '/api'
const TOKEN_KEY = 'promav-token'

let token = null
try { token = localStorage.getItem(TOKEN_KEY) } catch { /* ignore */ }

function setToken(t) {
  token = t
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

// Chamado quando o token é rejeitado (401) — limpa a sessão e avisa o app.
let onUnauthorized = () => {}

async function req(method, path, body) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && path !== '/auth/login') {
    setToken(null)
    onUnauthorized()
  }
  if (!res.ok) {
    let msg = `${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* corpo não-JSON */ }
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
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

  createTask: (data) => req('POST', '/tasks', data),
  updateTask: (id, data) => req('PUT', `/tasks/${id}`, data),
  deleteTask: (id) => req('DELETE', `/tasks/${id}`),
  moveTask: (id, status) => req('PATCH', `/tasks/${id}/status`, { status }),

  startTimer: (userId, taskId) => req('POST', '/sessions/start', { userId, taskId }),
  stopTimer: (userId) => req('POST', '/sessions/stop', { userId }),
}
