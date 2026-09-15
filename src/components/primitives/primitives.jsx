import './primitives.css'
import React from 'react'
import { Icon } from '../Icon.jsx'
import { STATUS_MAP, PRIORITY_MAP, PROJECT_COLORS } from '../../data/store.js'
// Reusable presentational primitives for the Promav UI.

// Pessoa inativa continua aparecendo onde já é histórico (responsável de uma
// atividade antiga, sessão de tempo, mudança publicada) — só fica esmaecida e
// com "(inativo)" no tooltip, para não sumir do registro nem parecer ativa.
const avatarStyle = (user, size) => ({
  width: size, height: size, background: user.color, fontSize: size * 0.4,
  opacity: user.isActive === false ? 0.5 : 1,
})
const avatarTitle = (user) => user.name + (user.isActive === false ? ' (inativo)' : '')

export function Avatar({ user, size = 28 }) {
  if (!user) return null
  return React.createElement('span', {
    className: 'av',
    style: avatarStyle(user, size),
    title: avatarTitle(user),
  }, user.initials)
}

export function AvatarStack({ users, size = 24, max = 4 }) {
  const list = (users || []).filter(Boolean)
  if (!list.length) return null
  const shown = list.slice(0, max)
  const extra = list.length - shown.length
  return (
    <span className="av-stack">
      {shown.map((u, i) => (
        <span key={u.id} className="av" title={avatarTitle(u)}
          style={{ ...avatarStyle(u, size), marginLeft: i ? -size * 0.32 : 0, zIndex: shown.length - i }}>
          {u.initials}
        </span>
      ))}
      {extra > 0 && (
        <span className="av av-more" style={{ width: size, height: size, fontSize: size * 0.36, marginLeft: -size * 0.32 }}>+{extra}</span>
      )}
    </span>
  )
}

// Atividade sem responsável é pendência de gestão, não um campo em branco.
// Um travessão discreto some no meio da tela e a lacuna nunca é resolvida —
// hoje são 25 de 81 atividades e 147 de 152 itens de checklist sem dono.
// Fica FORA do Panorama de propósito: aquela é a aba que se projeta em reunião
// com o cliente, e não é lá que a equipe resolve a própria escala.
export function SemResponsavel({ compacto = false }) {
  return (
    <span className={'sem-resp' + (compacto ? ' compacto' : '')} title="Ninguém foi definido como responsável">
      <Icon name="flag" size={compacto ? 11 : 13} />
      {compacto ? 'sem dono' : 'Sem responsável'}
    </span>
  )
}

export function StatusTag({ status }) {
  const s = STATUS_MAP[status]
  return (
    <span className="tag" style={{ background: s.soft, color: s.text }}>
      <span className="dot" style={{ background: s.color }} />{s.label}
    </span>
  )
}

export function PriorityTag({ priority }) {
  const p = PRIORITY_MAP[priority]
  return (
    <span className="tag" style={{ background: p.soft, color: p.text }}>
      <Icon name="flag" size={12} stroke={2.3} style={{ color: p.color }} />{p.label}
    </span>
  )
}

export function ProjectPill({ project, size = 8 }) {
  if (!project) return null
  return (
    <span className="proj-pill">
      <span className="dot" style={{ width: size, height: size, background: PROJECT_COLORS[project.color] }} />
      {project.name}
    </span>
  )
}

export function ProgressBar({ value, color = 'var(--brand)' }) {
  return (
    <div className="progress">
      <div style={{ width: value + '%', background: color }} />
    </div>
  )
}

export function ChecklistMini({ task }) {
  const list = task.checklist || []
  if (!list.length) return null
  const done = list.filter(i => i.done).length
  const full = done === list.length
  return (
    <span className={'ck-mini' + (full ? ' full' : '')} title={`${done} de ${list.length} itens concluídos`}>
      <Icon name={full ? 'checkCircle' : 'check'} size={14} stroke={2.2} />{done}/{list.length}
    </span>
  )
}

export function Modal({ title, onClose, children, footer, className = '' }) {
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className={'modal ' + className} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar"><Icon name="x" size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>
}

export function SegControl({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={o.id}
          className={value === o.id ? 'on' : ''}
          // A cor da opção é OPCIONAL (CHANGE_KINDS não tem). Quando existe,
          // tinge a borda que o .on já desenha — antes montava um box-shadow
          // com 'undefined' dentro, que o navegador descartava, deixando o
          // selecionado sem marca nenhuma além do fundo branco.
          style={value === o.id && o.color ? { borderColor: o.color, color: o.text || o.color } : null}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toast({ message }) {
  return (
    <div className="toast-wrap">
      <div className="toast"><span className="ic"><Icon name="check" size={16} stroke={2.5} /></span>{message}</div>
    </div>
  )
}
