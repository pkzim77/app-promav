import './Login.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { Logo } from '../../components/Logo/Logo.jsx'
import { Field } from '../../components/primitives/primitives.jsx'
// Tela de login — email + senha. Chama onLogin(email, password) que rejeita em
// caso de erro. `motivo` explica por que esta tela voltou (sessão vencida).

export function Login({ onLogin, motivo }) {
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
          <Logo size={20} />
        </div>
        <h1 className="login-title">Entrar</h1>
        <p className="login-sub">Acesse com seu email e senha.</p>

        {/* Vem antes dos campos: a pessoa precisa saber que não errou nada —
            foi o tempo de sessão que acabou. */}
        {motivo && <div className="login-error"><Icon name="lock" size={14} stroke={2.5} />{motivo}</div>}

        <Field label="Email">
          <input className="control" type="email" autoFocus autoComplete="username" placeholder="voce@promav.app"
            value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha">
          <input className="control" type="password" autoComplete="current-password" placeholder="••••••••"
            value={password} onChange={e => setPassword(e.target.value)} />
        </Field>

        {error && <div className="login-error" role="alert"><Icon name="x" size={14} stroke={2.5} />{error}</div>}

        <button className="btn btn-primary login-submit" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
