import './Relatorios.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
// Casca das telas de relatório do administrador: só a faixa de abas.

// Quem renderiza o conteúdo é quem usa esta casca, por `children`. É o que
// mantém as três telas em chunks separados — cada uma só é baixada quando a
// aba dela é aberta pela primeira vez, como já era quando eram três itens da
// barra lateral.
export const ABAS_RELATORIO = [
  { id: 'projetos', label: 'Dos projetos', icon: 'trendingUp' },
  { id: 'equipe', label: 'Da equipe', icon: 'users' },
  { id: 'individuais', label: 'Individuais', icon: 'file' },
]

export function Relatorios({ aba, onAba, children }) {
  return (
    <>
      {/* Rótulos curtos porque o nome inteiro de cada relatório já aparece no
          título da tela, logo abaixo: repetir "Relatórios" três vezes na faixa
          só rouba largura. `aria-pressed` e não `role="tab"`, seguindo as abas
          da tela de projeto — são botões de alternância, e declarar um widget
          de abas exigiria tabpanel, que o conteúdo aqui não é. */}
      <div className="relnav">
        <div className="relnav-inner" role="group" aria-label="Tipo de relatório">
          {ABAS_RELATORIO.map(a => (
            <button key={a.id} type="button" className={'relnav-item' + (aba === a.id ? ' on' : '')}
              aria-pressed={aba === a.id} onClick={() => onAba(a.id)}>
              <Icon name={a.icon} size={16} />{a.label}
            </button>
          ))}
        </div>
      </div>
      {/* Suspense próprio: o do App é o boundary mais próximo e trocaria a faixa
          de abas junto com o miolo pelo "Carregando…" na primeira vez que cada
          aba é aberta — as abas piscariam a cada troca. Com um boundary aqui,
          só o conteúdo espera e a faixa fica parada. */}
      <React.Suspense fallback={<div className="page relnav-carga">Carregando…</div>}>
        {children}
      </React.Suspense>
    </>
  )
}
