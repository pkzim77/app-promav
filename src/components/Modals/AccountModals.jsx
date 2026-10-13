import React from 'react'
import { Modal, Field } from '../primitives/primitives.jsx'
import { SECTORS } from '../../data/store.js'
import { FieldError } from './shared/FieldError.jsx'

// A pessoa liga a própria conta ao setor em que trabalha. É esse vínculo que
// faz uma mudança endereçada a "Engenharia" encontrar gente de verdade.
export function MySectorModal({ current, onSubmit, onClose }) {
  const [sector, setSector] = React.useState(current || '')
  const [busy, setBusy] = React.useState(false)
  const save = async () => { setBusy(true); try { await onSubmit(sector || null) } finally { setBusy(false) } }
  return (
    <Modal title="Meu setor" onClose={onClose} travado={busy}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <Field label="Setor em que você trabalha">
        <select className="control" value={sector} onChange={e => setSector(e.target.value)}>
          <option value="">Sem setor</option>
          {SECTORS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className="marca-nota">
          Mudanças endereçadas a um setor cobram ciência de quem estiver nele.
          Sem setor definido, você não recebe esses avisos.
        </span>
      </Field>
    </Modal>
  )
}

// `obrigatorio`: a senha atual foi definida por um administrador e vale como
// provisória. O modal não fecha e não tem Cancelar — sair dele sem trocar
// deixaria a conta com a senha que outra pessoa escolheu.
export function ChangePasswordModal({ onSubmit, onClose, obrigatorio = false }) {
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState(null)
  const [busy, setBusy] = React.useState(false)

  const save = async () => {
    if (busy) return
    setError(null)
    if (next.length < 6) return setError('A nova senha precisa ter ao menos 6 caracteres.')
    if (next !== confirm) return setError('A confirmação não confere.')
    setBusy(true)
    try { await onSubmit(current, next) }
    catch (err) { setError(err.message || 'Não foi possível trocar a senha.'); setBusy(false) }
  }

  return (
    <Modal title={obrigatorio ? 'Defina sua senha' : 'Trocar senha'} onClose={onClose} semSaida={obrigatorio}
      footer={<>
        {!obrigatorio && <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>}
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
      </>}>
      {obrigatorio && (
        <p className="sub" style={{ margin: 0 }}>
          A senha desta conta foi definida por um administrador. Escolha uma só sua para continuar.
        </p>
      )}
      <Field label="Senha atual">
        <input className="control" type="password" autoFocus value={current}
          onChange={e => setCurrent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
      </Field>
      <Field label="Nova senha">
        <input className="control" type="password" value={next}
          onChange={e => setNext(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
      </Field>
      <Field label="Confirmar nova senha">
        <input className="control" type="password" value={confirm}
          onChange={e => setConfirm(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
      </Field>
      <FieldError>{error}</FieldError>
    </Modal>
  )
}
