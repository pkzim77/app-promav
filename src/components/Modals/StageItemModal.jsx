import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field } from '../primitives/primitives.jsx'
import { paraAtribuir } from '../../data/store.js'
import { SugestaoItem } from './shared/SugestaoItem.jsx'

// Trabalho novo dentro de uma etapa. Antes, "Nova atividade" criava sempre uma
// atividade de texto livre, que não batia o padrão "N · Nome" e caía em
// "Outras atividades" — não era isso que a equipe queria ao registrar, por
// exemplo, "revisar a prancha 04" (que é trabalho da etapa 2 · Projetos).
//
// Aqui a pessoa escolhe a etapa e o trabalho entra como item do checklist
// dela. Atividade realmente avulsa continua existindo, pelo botão ao lado.
export function StageItemModal({ etapas = [], users = [], members = [], defaultStageId = null, onSave, onClose }) {
  const [taskId, setTaskId] = React.useState(defaultStageId || etapas[0]?.id || '')
  const [text, setText] = React.useState('')
  const [assigneeId, setAssigneeId] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // A equipe do PROJETO, não só quem já está na etapa: etapa recém-criada não
  // tem ninguém, e o seletor ficaria vazio justo na hora de distribuir o
  // trabalho. Quem for escolhido entra na etapa junto (o servidor cuida disso).
  // Contas de manutenção e gente inativa ficam de fora, como em toda escolha
  // de pessoa no app.
  const responsaveis = paraAtribuir(users)
    .filter(u => u.isAdmin || members.some(m => m.userId === u.id))

  const textErr = touched && !text.trim() ? 'Escreva o que precisa ser feito.' : null

  // A etapa escolhida decide o que é sugerido, e o checklist dela sai da lista:
  // oferecer o que já está lá é oferecer trabalho duplicado.
  const etapaAtual = etapas.find(e => e.id === taskId)
  const jaNaEtapa = (etapaAtual?.task?.checklist || []).map(i => i.text)

  const save = async () => {
    setTouched(true)
    if (!text.trim() || !taskId) return
    setSaving(true)
    try { await onSave(taskId, text.trim(), assigneeId || null) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Nova atividade" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving || !etapas.length}>
          {saving ? 'Salvando…' : 'Adicionar à etapa'}
        </button>
      </>}>
      {!etapas.length ? (
        <p className="ro-hint">
          <Icon name="flag" size={14} />
          Este projeto ainda não tem etapas. Use <strong>Criar template</strong> na aba
          Etapas para gerar as 11 de uma vez.
        </p>
      ) : (
        <>
          <Field label="Etapa">
            <select className="control" value={taskId}
              onChange={e => setTaskId(e.target.value)}>
              {etapas.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </Field>

          <Field label="O que precisa ser feito">
            <SugestaoItem value={text} onChange={setText} onEnter={save} autoFocus
              etapa={etapaAtual?.n} jaUsados={jaNaEtapa}
              placeholder="Ex.: Revisar a prancha 04 do arquitetônico"
              ariaLabel="O que precisa ser feito" />
            {textErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{textErr}</span>}
          </Field>

          <Field label="Responsável">
            <select className="control" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
              <option value="">Sem responsável</option>
              {responsaveis.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <span className="peso-hint">
              {responsaveis.length
                ? 'Quem for escolhido entra na etapa automaticamente.'
                : 'Este projeto ainda não tem equipe. Inclua pessoas no cadastro do projeto.'}
            </span>
          </Field>
        </>
      )}
    </Modal>
  )
}
