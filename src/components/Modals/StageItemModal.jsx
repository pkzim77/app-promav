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
// Aqui a pessoa escolhe a etapa e o trabalho entra como atividade dela.
// Atividade realmente avulsa continua existindo, pelo botão ao lado.
//
// A tela aceita VÁRIAS de uma vez, cada uma com responsável próprio — é assim
// que o trabalho chega na prática ("nesta etapa faltam estas quatro coisas"), e
// abrir o modal quatro vezes para digitar quatro linhas era o custo de não
// aceitar. Vão todas numa ida só ao servidor.

const MAX = 50 // o mesmo teto do servidor: acima dele as linhas seriam descartadas em silêncio

const linhaVazia = () => ({ chave: 'l' + Math.random().toString(36).slice(2, 8), text: '', assigneeId: '' })

export function StageItemModal({ etapas = [], users = [], members = [], defaultStageId = null, onSave, onClose }) {
  const [taskId, setTaskId] = React.useState(defaultStageId || etapas[0]?.id || '')
  const [linhas, setLinhas] = React.useState([linhaVazia()])
  const [touched, setTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // A equipe do PROJETO, não só quem já está na etapa: etapa recém-criada não
  // tem ninguém, e o seletor ficaria vazio justo na hora de distribuir o
  // trabalho. Quem for escolhido entra na etapa junto (o servidor cuida disso).
  // Contas de manutenção e gente inativa ficam de fora, como em toda escolha
  // de pessoa no app.
  const responsaveis = paraAtribuir(users)
    .filter(u => u.isAdmin || members.some(m => m.userId === u.id))

  const etapaAtual = etapas.find(e => e.id === taskId)
  const jaNaEtapa = (etapaAtual?.task?.checklist || []).map(i => i.text)

  const preenchidas = linhas.filter(l => l.text.trim())
  const textErr = touched && !preenchidas.length ? 'Escreva ao menos uma atividade.' : null

  const mudar = (chave, campos) => setLinhas(ls => ls.map(l => l.chave === chave ? { ...l, ...campos } : l))
  const tirar = (chave) => setLinhas(ls => (ls.length === 1 ? [linhaVazia()] : ls.filter(l => l.chave !== chave)))
  const somar = () => setLinhas(ls => (ls.length >= MAX ? ls : [...ls, linhaVazia()]))

  const save = async () => {
    setTouched(true)
    if (!preenchidas.length || !taskId) return
    setSaving(true)
    try {
      await onSave(taskId, preenchidas.map(l => ({ text: l.text.trim(), assigneeId: l.assigneeId || null })))
    } finally { setSaving(false) }
  }

  return (
    <Modal title="Novas atividades" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving || !etapas.length}>
          {saving
            ? <><span className="spin" />Salvando…</>
            : preenchidas.length > 1 ? `Adicionar ${preenchidas.length} atividades` : 'Adicionar atividade'}
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

          <Field label="Atividades">
            <div className="ev-lista">
              {linhas.map((l, i) => (
                <div className="ev-linha" key={l.chave}>
                  <SugestaoItem value={l.text} onChange={(v) => mudar(l.chave, { text: v })}
                    onEnter={() => l.text.trim() && somar()} autoFocus={i === 0}
                    etapa={etapaAtual?.n} jaUsados={[...jaNaEtapa, ...linhas.filter(x => x.chave !== l.chave).map(x => x.text)]}
                    placeholder="Ex.: Revisar a prancha 04 do arquitetônico"
                    ariaLabel={`Atividade ${i + 1}`} />

                  {/* Responsável POR LINHA: numa etapa com quatro entregas, cada
                      uma costuma ter dono diferente — era o que obrigava a abrir
                      o modal uma vez por atividade. */}
                  <select className="control ev-dono" value={l.assigneeId}
                    aria-label={`Responsável pela atividade ${i + 1}`}
                    onChange={e => mudar(l.chave, { assigneeId: e.target.value })}>
                    <option value="">Sem responsável</option>
                    {responsaveis.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>

                  <button type="button" className="btn-icon ev-tirar" onClick={() => tirar(l.chave)}
                    title="Remover esta linha" aria-label={`Remover a atividade ${i + 1}`}
                    disabled={linhas.length === 1 && !l.text}>
                    <Icon name="x" size={16} />
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="btn btn-secondary btn-sm ev-mais" onClick={somar}
              disabled={linhas.length >= MAX}>
              <Icon name="plus" size={15} stroke={2.2} />Mais uma atividade
            </button>
            {textErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{textErr}</span>}
          </Field>

          {/* Admin aparece sempre, então a lista nunca fica vazia — mas num projeto
              sem equipe ela oferece só a coordenação, e é isso que precisa estar
              dito, senão parece que as pessoas do projeto sumiram. */}
          {!members.length && (
            <p className="ro-hint">
              <Icon name="users" size={14} />
              Este projeto ainda não tem equipe: só a coordenação aparece como
              responsável. Inclua pessoas no cadastro do projeto para distribuir as atividades.
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
