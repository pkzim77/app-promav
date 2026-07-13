import './Logo.css'
import React from 'react'
// Wordmark "PRO | MAV". É texto (não imagem): fica nítido em qualquer tamanho
// e herda a cor do contexto — branco na sidebar escura, tinta no fundo claro.
// A barra divisória usa sempre o bege da marca (--accent).

export function Logo({ size = 20, className = '' }) {
  return (
    <span className={'logo' + (className ? ' ' + className : '')}
      style={{ fontSize: size }} role="img" aria-label="Promav">
      <span className="logo-word">PRO</span>
      <span className="logo-bar" aria-hidden="true" />
      <span className="logo-word">MAV</span>
    </span>
  )
}
