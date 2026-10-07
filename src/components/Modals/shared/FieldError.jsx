import React from 'react'
import { Icon } from '../../Icon.jsx'

// O mesmo aviso de campo inválido estava copiado em sete modais, e nenhuma das
// cópias era anunciada: sem role="alert" o leitor de tela não conta que o
// formulário recusou o que a pessoa acabou de digitar.
export function FieldError({ children }) {
  if (!children) return null
  return <span className="field-error" role="alert"><Icon name="x" size={13} stroke={2.5} />{children}</span>
}
