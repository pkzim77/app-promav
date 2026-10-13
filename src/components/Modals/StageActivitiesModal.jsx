import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Avatar, SemResponsavel } from '../primitives/primitives.jsx'
import { CHECK_STATES, STATUS_MAP, estadoDoItem, taskMembers } from '../../data/store.js'

// As atividades de uma etapa, e só elas.
//
// Aberto pelo cronômetro, onde a pergunta é uma só: "o que eu tenho para fazer
// aqui?". O modal de editar a etapa responde isso no meio de título, projeto,
// responsável, prazo, prioridade, membros e status — sete campos que ninguém
// veio mexer, e que ainda deixam a pessoa a um clique de mudar algo sem querer.
//
// Mudar o estado de uma atividade grava na hora, como na aba Etapas: não há
// "salvar" aqui porque não há rascunho — cada linha é uma decisão completa.

export function StageActivitiesModal({ task, project, users = [], onSetState, onAbrirEtapa, onClose }) {
  const itens = task?.checklist || []
  const feitos = itens.filter(i => estadoDoItem(i) === 'done').length

  // Sem dono gravado e com uma pessoa só na etapa, é ela por dedução — mesma
  // regra da aba, para as duas telas não contarem histórias diferentes.
  const equipe = taskMembers(task).map(id => users.find(u => u.id === id)).filter(Boolean)
  const unico = equipe.length === 1 ? equipe[0] : null

  return (
    <Modal title={task?.title || 'Atividades'} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Fechar</button>
        {onAbrirEtapa && (
          <button className="btn btn-primary" onClick={() => onAbrirEtapa(task)}>
            <Icon name="pencil" size={16} />Abrir a etapa
          </button>
        )}
      </>}>

      <p className="ma-onde">
        <span className="ma-proj">{project?.name || 'Projeto'}</span>
        {itens.length > 0 && <span className="ma-conta">{feitos}/{itens.length} concluídas</span>}
      </p>

      {itens.length === 0 ? (
        <p className="ro-hint">
          <Icon name="flag" size={14} />
          Esta etapa ainda não tem atividades. Use <strong>Nova atividade</strong> na
          aba Etapas do projeto para escrever o que há para fazer aqui.
        </p>
      ) : (
        <ul className="ma-lista">
          {itens.map(item => {
            const dono = users.find(u => u.id === item.assigneeId) || unico
            const estado = estadoDoItem(item)
            const cor = STATUS_MAP[estado] || STATUS_MAP.todo
            return (
              <li key={item.id} className={estado === 'done' ? 'ok' : ''}>
                <select className="estado-chip" value={estado}
                  style={{ background: cor.soft, color: cor.text }}
                  aria-label={`Estado de: ${item.text}`}
                  onChange={(e) => onSetState(task, item.id, e.target.value)}>
                  {CHECK_STATES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <span className="ma-texto">{item.text}</span>
                {dono
                  ? <span className="ma-dono"><Avatar user={dono} size={22} />{dono.shortName || dono.name.split(' ')[0]}</span>
                  : <SemResponsavel compacto />}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
