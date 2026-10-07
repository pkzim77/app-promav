import React from 'react'
import { Modal } from '../primitives/primitives.jsx'

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }) {
  // Confirmar de novo antes do servidor responder repetia a ação — e a segunda
  // voltava como erro. Os botões ficam travados enquanto roda; com onConfirm
  // síncrono o await resolve na hora e nada muda.
  const [running, setRunning] = React.useState(false)
  const confirmar = async () => {
    if (running) return
    setRunning(true)
    try { await onConfirm() } finally { setRunning(false) }
  }
  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={running}>Cancelar</button>
        <button className="btn btn-danger" onClick={confirmar} disabled={running}>{confirmLabel || 'Excluir'}</button>
      </>}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>{message}</p>
    </Modal>
  )
}
