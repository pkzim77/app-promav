import React from 'react'
import { api } from '../../../data/api.js'

// Campo de texto que sugere itens de checklist já usados na MESMA etapa em
// outros projetos.
//
// Por que vale a pena: medido no banco, são 157 itens para 55 textos distintos,
// e 102 dos 152 itens do template já existiam palavra por palavra em outro
// projeto. A etapa 3 · Orçamento tem sempre os mesmos cinco, redigitados a cada
// projeto novo.
//
// Sem biblioteca. As setas, o Enter e o Esc são ~40 linhas aqui, e um
// <datalist> nativo não deixaria mostrar o "usado em 6 projetos" — que é o que
// diz à pessoa se aquele texto é o padrão da casa ou o improviso de alguém.

// Um carregamento por sessão do navegador: são ~55 textos, uns 3 KB, e mudam
// devagar. No bootstrap eles seriam rebaixados a peso morto para todo mundo,
// inclusive para quem nunca abre um modal de checklist.
let emCache = null
function carregarSugestoes() {
  if (!emCache) {
    emCache = api.checklistSuggestions().catch((e) => { emCache = null; throw e })
  }
  return emCache
}

// Compara ignorando acento e caixa: quem digita "orcamento" tem que achar
// "Orçamento", e ninguém acentua quando está com pressa.
const chave = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLocaleLowerCase('pt-BR').trim()

const MOSTRAR = 8

export function SugestaoItem({ value, onChange, onEnter, etapa = null, jaUsados = [],
                               placeholder, autoFocus = false, ariaLabel }) {
  const [sugestoes, setSugestoes] = React.useState(null)
  const [aberto, setAberto] = React.useState(false)
  const [marcado, setMarcado] = React.useState(-1)
  const listaId = React.useId()

  // Busca uma vez, na montagem — não a cada tecla. Quando a pessoa termina de
  // ler o modal os dados já estão aqui, e a primeira letra não espera a rede.
  React.useEffect(() => {
    let vivo = true
    carregarSugestoes().then(d => vivo && setSugestoes(d)).catch(() => {})
    return () => { vivo = false }
  }, [])

  const usadosKey = jaUsados.map(chave).join('|')
  const candidatas = React.useMemo(() => {
    if (!sugestoes) return []
    const usados = new Set(usadosKey ? usadosKey.split('|') : [])
    // Os da etapa primeiro; o resto entra depois, como reserva.
    const daEtapa = (etapa != null && sugestoes[String(etapa)]) || []
    const geral = sugestoes['*'] || []
    const vistos = new Set()
    return [...daEtapa, ...geral].filter(s => {
      const k = chave(s.text)
      if (!k || vistos.has(k) || usados.has(k)) return false
      vistos.add(k)
      return true
    })
  }, [sugestoes, etapa, usadosKey])

  const filtro = chave(value)
  const lista = (filtro ? candidatas.filter(s => chave(s.text).includes(filtro)) : candidatas).slice(0, MOSTRAR)
  const mostrar = aberto && lista.length > 0

  const escolher = (texto) => {
    onChange(texto)
    setAberto(false)
    setMarcado(-1)
  }

  const aoTeclar = (e) => {
    if (e.key === 'ArrowDown' && mostrar) {
      e.preventDefault()
      setMarcado(i => (i + 1) % lista.length)
    } else if (e.key === 'ArrowUp' && mostrar) {
      e.preventDefault()
      setMarcado(i => (i <= 0 ? lista.length : i) - 1)
    } else if (e.key === 'Escape' && mostrar) {
      // Só fecha a lista. Deixar o Esc subir daqui fecharia o modal inteiro,
      // levando junto tudo o que a pessoa já tinha preenchido.
      e.preventDefault()
      e.stopPropagation()
      setAberto(false)
      setMarcado(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (mostrar && marcado >= 0) escolher(lista[marcado].text)
      else if (onEnter) onEnter()
    }
  }

  return (
    <div className="sug">
      <input className="control" value={value} autoFocus={autoFocus} placeholder={placeholder}
        role="combobox" aria-expanded={mostrar} aria-controls={listaId} aria-autocomplete="list"
        aria-label={ariaLabel} aria-activedescendant={marcado >= 0 ? listaId + '-' + marcado : undefined}
        onChange={(e) => { onChange(e.target.value); setAberto(true); setMarcado(-1) }}
        onFocus={() => setAberto(true)}
        onBlur={() => { setAberto(false); setMarcado(-1) }}
        onKeyDown={aoTeclar} />

      {mostrar && (
        <ul className="sug-lista" id={listaId} role="listbox">
          {lista.map((s, i) => (
            <li key={s.text} id={listaId + '-' + i} role="option" aria-selected={i === marcado}
              className={'sug-item' + (i === marcado ? ' on' : '')}
              // mousedown em vez de click, e com preventDefault: o clique
              // tiraria o foco do campo antes de disparar, o blur fecharia a
              // lista e a escolha se perderia no caminho.
              onMouseDown={(e) => { e.preventDefault(); escolher(s.text) }}
              onMouseEnter={() => setMarcado(i)}>
              <span className="sug-txt">{s.text}</span>
              <span className="sug-n">{s.n === 1 ? '1 projeto' : `${s.n} projetos`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
