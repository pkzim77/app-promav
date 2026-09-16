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

// Enquanto está aberto, o modal é a tela inteira para o teclado. Antes o Tab
// saía da caixa e ia parar nos botões da página atrás — dava para chegar em
// "Excluir projeto" sem ver, com o modal ainda na frente —, e ao fechar o foco
// caía no <body>, então o próximo Tab recomeçava do canto da página.
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, children, footer, className = '' }) {
  const caixa = React.useRef(null)
  const tituloId = React.useId()

  // onClose costuma ser uma arrow escrita no JSX, ou seja, outra função a cada
  // render. Numa dependência do efeito, o modal se desmontaria e devolveria o
  // foco à origem a cada tecla digitada.
  const fechar = React.useRef(onClose)
  fechar.current = onClose

  // Quem abriu o modal, para o foco voltar para lá no fim. Precisa ser lido
  // AQUI, durante o render: o autoFocus de um campo é aplicado no commit, que
  // acontece antes de qualquer useEffect — lido lá dentro, isto guardaria o
  // próprio campo do modal, e no fim o foco seria devolvido a um elemento que
  // acabou de sair da tela, ou seja, a lugar nenhum.
  const origem = React.useRef(null)
  if (origem.current === null) origem.current = document.activeElement

  React.useEffect(() => {
    const caixaNo = caixa.current
    // Campo com autoFocus já se resolveu sozinho. Se ninguém pegou o foco, ele
    // vai para a caixa, e o leitor de tela anuncia o título do diálogo.
    if (!caixa.current.contains(document.activeElement)) caixa.current.focus()

    const aoTeclar = (e) => {
      if (e.key === 'Escape') { fechar.current(); return }
      if (e.key !== 'Tab') return
      // offsetParent descarta o que está escondido (campo de aba fechada, por
      // exemplo): o foco não pode parar em algo que ninguém enxerga.
      const lista = [...caixa.current.querySelectorAll(FOCAVEIS)].filter(el => el.offsetParent !== null)
      if (!lista.length) { e.preventDefault(); return }
      const primeiro = lista[0]
      const ultimo = lista[lista.length - 1]
      const atual = document.activeElement
      if (!caixa.current.contains(atual)) { e.preventDefault(); (e.shiftKey ? ultimo : primeiro).focus() }
      else if (!e.shiftKey && atual === ultimo) { e.preventDefault(); primeiro.focus() }
      else if (e.shiftKey && atual === primeiro) { e.preventDefault(); ultimo.focus() }
    }

    window.addEventListener('keydown', aoTeclar)
    return () => {
      window.removeEventListener('keydown', aoTeclar)

      // O StrictMode roda efeito → limpeza → efeito de novo no mesmo instante,
      // com o modal ainda na tela. Devolver o foco ali tiraria o cursor do
      // campo com autoFocus toda vez que o modal abrisse em desenvolvimento.
      // Fechou de verdade quando a caixa já saiu do documento — e o navegador,
      // ao remover o que estava focado, deixou o foco no <body>.
      const fechouMesmo = !document.contains(caixaNo) || document.activeElement === document.body
      if (!fechouMesmo) return

      // Devolve o foco a quem abriu — a não ser que aquele botão tenha saído
      // da tela junto com o que o modal acabou de excluir.
      const voltarPara = origem.current
      if (voltarPara instanceof HTMLElement && voltarPara !== document.body && document.contains(voltarPara)) voltarPara.focus()
    }
  }, [])

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div ref={caixa} className={'modal ' + className} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby={tituloId}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id={tituloId}>{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar"><Icon name="x" size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// O <label> não apontava para nada: clicar no texto não focava o campo, e o
// leitor de tela anunciava "edição de texto" sem dizer de quê. São 52 usos de
// <Field> e 59 campos no app, nenhum com id — escrever um a um seria pedir
// para esquecer metade, então o id nasce aqui.
//
// Quando o conteúdo não é um campo nativo (SegControl, MoneyInput, uma tag de
// leitura), htmlFor não teria a quem apontar: aí o Field inteiro vira um grupo
// com aquele nome, que é o que o leitor de tela precisa para anunciar os
// botões de status como "Status".
const CAMPOS_NATIVOS = new Set(['input', 'textarea', 'select'])

export function Field({ label, children }) {
  const id = React.useId()
  let alvo = null
  const conteudo = React.Children.map(children, (filho) => {
    if (alvo || !React.isValidElement(filho) || !CAMPOS_NATIVOS.has(filho.type)) return filho
    alvo = filho.props.id || id
    return filho.props.id ? filho : React.cloneElement(filho, { id })
  })
  if (!alvo) return <div className="field" role="group" aria-labelledby={id}><label id={id}>{label}</label>{children}</div>
  return <div className="field"><label htmlFor={alvo}>{label}</label>{conteudo}</div>
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
