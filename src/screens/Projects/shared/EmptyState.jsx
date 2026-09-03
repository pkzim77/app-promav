import React from 'react'
import { Icon } from '../../../components/Icon.jsx'

export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="card empty">
      <div className="ic"><Icon name={icon} size={26} stroke={1.9} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}
