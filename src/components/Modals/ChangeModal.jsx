import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field, SegControl } from '../primitives/primitives.jsx'
import { SECTORS, CHANGE_KINDS, URGENCIES, paraAtribuir, etapasDoProjeto } from '../../data/store.js'

// Emissor e destinatário são polimórficos: pessoa OU setor. O <select> codifica
// como "u:<id>" ou "s:<setor>" e o valor é desmontado ao salvar.
const LADO_PESSOA = (id) => `u:${id}`
const LADO_SETOR = (s) => `s:${s}`
function lerLado(v) {
  if (!v) return { userId: null, sector: null }
  if (v.startsWith('u:')) return { userId: v.slice(2), sector: null }
  return { userId: null, sector: v.slice(2) }
}
// Um <select> de pessoa-ou-setor, com as duas listas separadas por grupo.
function LadoSelect({ value, onChange, equipe, incluirVazio, rotuloVazio }) {
  return (
    <select className="control" value={value} onChange={e => onChange(e.target.value)}>
      {incluirVazio && <option value="">{rotuloVazio}</option>}
      <optgroup label="Pessoas do projeto">
        {equipe.map(u => <option key={u.id} value={LADO_PESSOA(u.id)}>{u.name}</option>)}
      </optgroup>
      <optgroup label="Setores">
        {SECTORS.map(s => <option key={s.id} value={LADO_SETOR(s.id)}>{s.label}</option>)}
      </optgroup>
    </select>
  )
}

// Publicar ou editar uma MUDANÇA do projeto (a "orientação"). O mesmo modal
// serve aos dois casos; só a criação pergunta se altera orçamento ou prazo e
// em que etapa a mudança entra, porque as duas respostas congelam na publicação.
export function ChangeModal({ change, projectId, users = [], members = [], tasks = [], onSave, onClose }) {
  const editing = !!change
  const [title, setTitle] = React.useState(change?.title || '')
  const [changeDate, setChangeDate] = React.useState(change?.changeDate || new Date().toISOString().slice(0, 10))
  const [description, setDescription] = React.useState(change?.description || '')
  const [requester, setRequester] = React.useState(change?.requester || '')
  const [kind, setKind] = React.useState(change?.kind || 'requisicao')
  const [urgency, setUrgency] = React.useState(change?.urgency || 'medium')
  // Etapa que recebe a mudança. Só na publicação: mover de etapa depois
  // exigiria mover o item de checklist, e isso ainda não existe.
  const etapas = React.useMemo(() => etapasDoProjeto(tasks, projectId), [tasks, projectId])
  const [etapa, setEtapa] = React.useState('')
  const [affectsBudget, setAffectsBudget] = React.useState(!!change?.affectsBudget)
  const [touched, setTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Só quem participa do projeto entra nas listas de pessoa — e contas de
  // manutenção ficam de fora, salvo se já forem o emissor ou o destinatário
  // de uma mudança gravada antes desta regra.
  const equipe = paraAtribuir(users, change?.emitterUserId, change?.targetUserIds, change?.responsibleId)
    .filter(u => u.isAdmin || members.some(m => m.userId === u.id))
  const equipeDestinatarios = equipe.filter(u => members.some(m => m.userId === u.id))

  // O emissor não é mais escolhido no formulário: é sempre quem publica, e o
  // servidor é quem carimba (o cliente nem envia). Editar não troca o emissor.
  // Destinatário: um setor e/ou uma lista de pessoas. O setor continua sendo
  // único por compatibilidade com o contrato da API, mas pode ser combinado
  // com participantes avulsos.
  const [destSetores, setDestSetores] = React.useState(
    change?.targetSectors?.length ? [...change.targetSectors] : change?.targetSector ? [change.targetSector] : []
  )
  const [destPessoas, setDestPessoas] = React.useState(
    change?.targetUserIds?.length ? [...change.targetUserIds]
      : change?.responsibleId ? [change.responsibleId] : []
  )
  // Escolher no seletor vazio acrescenta; escolher num preenchido troca.
  const definirDestino = (indice, valor) => {
    const { userId, sector } = lerLado(valor)
    if (sector) {
      setDestSetores(atual => atual.includes(sector) ? atual : [...atual, sector])
      return
    }
    setDestPessoas(atual => {
      if (!userId) return atual.filter((_, i) => i !== indice)      // "remover"
      if (atual.includes(userId)) return atual                       // já está
      const copia = [...atual]
      if (indice < copia.length) copia[indice] = userId; else copia.push(userId)
      return copia
    })
  }
  const definirSetorOuPessoa = (valor) => {
    const { userId, sector } = lerLado(valor)
    if (sector) { setDestSetores(atual => atual.includes(sector) ? atual : [...atual, sector]); return }
    if (!userId) return
    setDestPessoas(atual => atual.includes(userId) ? atual : [userId, ...atual])
  }
  const alterarSetor = (indice, valor) => {
    const { sector } = lerLado(valor)
    if (sector) setDestSetores(atual => atual.map((item, i) => i === indice ? sector : item).filter((item, i, lista) => lista.indexOf(item) === i))
  }
  const removerSetor = (indice) => setDestSetores(atual => atual.filter((_, i) => i !== indice))
  const removerDestino = (i) => setDestPessoas(a => a.filter((_, k) => k !== i))

  const titleErr = touched && !title.trim() ? 'Diga o que mudou, em uma linha.' : null
  const descErr = touched && !description.trim() ? 'Descreva a mudança para quem vai fazer.' : null
  const temDestino = destSetores.length > 0 || destPessoas.length > 0
  const destErr = touched && !temDestino ? 'Escolha para quem vai a mudança.' : null

  // Endereçar a um setor cobra quem está nele — mas só quem participa do
  // projeto pode ser avisado. Avisa antes de publicar, não depois.
  const foraDoProjeto = destSetores.length
    ? users.filter(u => destSetores.includes(u.sector) && !u.isAdmin && !members.some(m => m.userId === u.id))
    : []
  // Setor escolhido sem ninguém dentro não avisa ninguém — vale dizer antes.
  const semNinguemNoSetor = destSetores.some(setor => !members.some(m => users.some(u => u.id === m.userId && u.sector === setor)))

  const save = async () => {
    setTouched(true)
    if (!title.trim() || !description.trim() || !changeDate || !temDestino) return
    setSaving(true)
    try {
      await onSave({
        ...(change ? { id: change.id } : {}), projectId,
        title: title.trim(), description: description.trim(), requester: requester.trim(),
        changeDate, urgency,
        targetUserIds: destPessoas, targetSectors: destSetores, targetSector: destSetores[0] || null,
        ...(editing ? {} : { kind, affectsBudget, stageTaskId: etapa || null }),
      })
    } finally { setSaving(false) }
  }

  return (
    <Modal className="project-modal" title={editing ? 'Editar mudança' : 'Publicar mudança'} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : editing ? 'Salvar edição' : 'Publicar e avisar a equipe'}
        </button>
      </>}>
      {editing && (
        <p className="ro-hint"><Icon name="flag" size={14} />
          Editar reabre a confirmação de todo mundo: se o texto mudou, "eu vi" precisa ser dito de novo.
        </p>
      )}

      {!editing && (
        <Field label="Tipo da mudança">
          <SegControl options={CHANGE_KINDS} value={kind} onChange={setKind} />
          <span className="peso-hint">
            {kind === 'requisicao'
              ? 'Requisição obriga: a atividade já nasce no quadro.'
              : 'Sugestão é proposta: vira atividade só depois de alguém aceitar.'}
          </span>
        </Field>
      )}

      <Field label="O que mudou">
        <input className="control" value={title} autoFocus placeholder="Ex.: Mudou a estrutura da cobertura"
          onChange={e => setTitle(e.target.value)} />
        {titleErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{titleErr}</span>}
      </Field>

      <div className="field-row">
        <Field label="Data da mudança">
          <input type="date" className="control" value={changeDate} onChange={e => setChangeDate(e.target.value)} />
        </Field>
        <Field label="Urgência">
          <SegControl options={URGENCIES} value={urgency} onChange={setUrgency} />
        </Field>
      </div>

      {!editing && (
        <Field label="Etapa">
          <select className="control" value={etapa} onChange={e => setEtapa(e.target.value)}>
            <option value="">Sem etapa</option>
            {etapas.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          <span className="peso-hint">
            {etapa
              ? 'Entra como item do checklist desta etapa.'
              : 'Sem etapa, entra em "Outras atividades" — na aba Etapas do projeto.'}
          </span>
        </Field>
      )}

      {/* Não há campo de emissor: quem publica é o emissor, e isso aparece no
          cartão depois de publicado ("De … Para …"). */}
      <Field label="Destinatário">
        {/* Cada escolha mantém um seletor abaixo para incluir outra pessoa
            ou setor; pessoas avulsas podem acompanhar o setor. */}
        <div className="dest-lista">
          {destSetores.map((setor, i) => <div className="dest-linha" key={'setor-' + setor}>
            <LadoSelect value={LADO_SETOR(setor)} onChange={v => alterarSetor(i, v)} equipe={equipeDestinatarios} />
            <button type="button" className="btn-icon" onClick={() => removerSetor(i)} aria-label="Remover setor"><Icon name="x" size={16} /></button>
          </div>)}
          {destPessoas.map((uid, i) => <div className="dest-linha" key={uid}>
            <LadoSelect value={LADO_PESSOA(uid)} onChange={v => definirDestino(i, v)} equipe={equipeDestinatarios} />
            <button type="button" className="btn-icon" onClick={() => removerDestino(i)} aria-label="Remover destinatário"><Icon name="x" size={16} /></button>
          </div>)}
          <LadoSelect value="" onChange={definirSetorOuPessoa} equipe={equipeDestinatarios}
            incluirVazio rotuloVazio={temDestino ? '+ incluir outra pessoa ou setor' : 'Escolha pessoa ou setor'} />
        </div>
        {destErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{destErr}</span>}
      </Field>

      {semNinguemNoSetor && (
        <p className="ro-hint" style={{ marginTop: -4 }}>
          <Icon name="flag" size={14} />
          Ninguém tem esse setor definido na conta ainda — a mudança não vai cobrar ciência de ninguém.
          Defina o setor das pessoas na tela Equipe.
        </p>
      )}
      {foraDoProjeto.length > 0 && (
        <p className="ro-hint" style={{ marginTop: -4 }}>
          <Icon name="flag" size={14} />
          {foraDoProjeto.length === 1
            ? `${foraDoProjeto[0].name} é deste setor mas não participa do projeto — não será avisada.`
            : `${foraDoProjeto.length} pessoas deste setor não participam do projeto e não serão avisadas.`}
          {' '}Inclua na equipe pelo cadastro do projeto.
        </p>
      )}

      <Field label="Descrição">
        <textarea className="control" value={description} style={{ minHeight: 110 }}
          placeholder="Escreva para quem vai executar: o que muda na prática, o que precisa ser refeito."
          onChange={e => setDescription(e.target.value)} />
        {descErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{descErr}</span>}
      </Field>

      <Field label="Solicitante">
        <input className="control" value={requester} placeholder="Opcional — ofício, ata, cliente, visita técnica…"
          onChange={e => setRequester(e.target.value)} />
      </Field>

      {!editing && (
        <div className="field">
          <button type="button" role="checkbox" aria-checked={affectsBudget}
            className={'change-check' + (affectsBudget ? ' on' : '')}
            onClick={() => setAffectsBudget(v => !v)}>
            <span className="change-check-box">{affectsBudget && <Icon name="check" size={13} stroke={3} />}</span>
            Esta mudança altera orçamento ou prazo
          </button>
          <span className="peso-hint">
            Fica marcado na mudança para a coordenação enxergar. Não trava o trabalho —
            e não pode ser alterado depois de publicar.
          </span>
        </div>
      )}
    </Modal>
  )
}
