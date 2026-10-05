import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal } from '../primitives/primitives.jsx'

// Resultado da busca de projetos. Abre quando a pessoa digita na barra do topo
// e leva o próprio campo de busca junto: o modal toma o foco ao abrir, então
// quem continuasse digitando lá em cima falaria com uma tela que não responde.

export function ProjectSearchModal({ query, onQueryChange, projects = [], onOpen, onClose }) {
  const termo = query.trim().toLocaleLowerCase('pt-BR')
  const achados = termo
    ? projects.filter(p => `${p.name} ${p.desc || ''}`.toLocaleLowerCase('pt-BR').includes(termo))
    : []

  return (
    <Modal className="modal-busca" title="Buscar projetos" onClose={onClose}>
      <div className="search busca-campo">
        <Icon name="search" size={17} />
        <input autoFocus value={query} onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar projetos" aria-label="Buscar projetos" />
      </div>
      {!termo ? (
        <p className="busca-vazio">Digite para buscar um projeto.</p>
      ) : achados.length === 0 ? (
        <p className="busca-vazio">Nenhum projeto encontrado para “{query.trim()}”.</p>
      ) : (
        <ul className="busca-lista">
          {achados.map(p => (
            <li key={p.id}>
              <button className="busca-item" onClick={() => onOpen(p.id)}>
                <strong>{p.name}</strong>
                {p.desc && <span>{p.desc}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
