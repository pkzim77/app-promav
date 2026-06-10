import React from 'react'
import { Icon } from '../components/Icon.jsx'
// Tela de login — email + senha. Chama onLogin(email, password) que rejeita em caso de erro.

export function Login({ onLogin }) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState(null)
  const [busy, setBusy] = React.useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await onLogin(email.trim(), password)
    } catch (err) {
      setError(err.message || 'Não foi possível entrar.')
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/assets/promav-mark-light.svg" alt="" />
          <span className="word">promav</span>
        </div>
        <h1 className="login-title">Entrar</h1>
        <p className="login-sub">Acesse com seu email e senha.</p>

        <div className="field">
          <label>Email</label>
          <input className="control" type="email" autoFocus autoComplete="username" placeholder="voce@promav.app"
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Senha</label>
          <input className="control" type="password" autoComplete="current-password" placeholder="••••••••"
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>

        {error && <div className="login-error"><Icon name="x" size={14} stroke={2.5} />{error}</div>}

        <button className="btn btn-primary login-submit" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
