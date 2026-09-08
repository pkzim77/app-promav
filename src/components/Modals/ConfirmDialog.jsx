import React from 'react'
import { Modal } from '../primitives/primitives.jsx'

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel || 'Excluir'}</button>
      </>}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>{message}</p>
    </Modal>
  )
}
