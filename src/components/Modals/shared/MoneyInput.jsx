import React from 'react'
import { maskBRL } from '../../../data/store.js'

// Campo de dinheiro: formata a cada tecla (2.500,00) e mantém o cursor no fim,
// já que a máscara faz o número crescer sempre pela direita.
export function MoneyInput({ value, onChange, placeholder }) {
  const ref = React.useRef(null)
  const handle = (e) => {
    onChange(maskBRL(e.target.value))
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) el.setSelectionRange(el.value.length, el.value.length)
    })
  }
  return (
    <div className="money-field">
      <span className="money-prefix">R$</span>
      <input ref={ref} className="control" inputMode="numeric" placeholder={placeholder}
        value={value} onChange={handle} />
    </div>
  )
}
