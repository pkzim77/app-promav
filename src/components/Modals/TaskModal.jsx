import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field, SegControl, StatusTag, PriorityTag, PopupPendencias, ProgressBar } from '../primitives/primitives.jsx'
import { STATUSES, PRIORITIES, CHECK_STATES, STATUS_MAP, estadoDoItem, paraAtribuir, ETAPAS_PADRAO, tituloDaEtapa, PADRAO_ETAPA, pendenciasDaEtapa } from '../../data/store.js'
import { dateError } from './shared/formHelpers.js'
import { SugestaoItem } from './shared/SugestaoItem.jsx'
import { FieldError } from './shared/FieldError.jsx'

export function TaskModal({ task, projects, tasks = [], users, currentUserId, defaultProjectId, defaultStatus, comoEtapa = false, canEdit = true, onToggleChecklist, onToggleMembership, onSave, onClose }) {
  const editing = !!task
  const ro = !canEdit // somente leitura (papel 'Só exibição'): só checklist + entrar/sair
  const [title, setTitle] = React.useState(task?.title || '')
  const [projectId, setProjectId] = React.useState(task?.projectId || defaultProjectId || projects[0]?.id || '')
  // O padrão é a primeira pessoa que pode receber trabalho: conta ativa e fora
  // da manutenção. users[0] é a conta de manutenção mais antiga, e toda
  // atividade nova nasceria no nome dela — ou no de alguém já desativado.
  const [assigneeId, setAssigneeId] = React.useState(task?.assigneeId || users.find(u => !u.isDev && u.isActive !== false)?.id || '')
  const [memberIds, setMemberIds] = React.useState(task?.memberIds ? [...task.memberIds] : [])
  const [status, setStatus] = React.useState(task?.status || defaultStatus || 'todo')
  const [priority, setPriority] = React.useState(task?.priority || 'medium')
  const [start, setStart] = React.useState(task?.start || '')
  const [end, setEnd] = React.useState(task?.end || '')
  const [checklist, setChecklist] = React.useState(task?.checklist ? task.checklist.map(i => ({ ...i })) : [])
  const [newItem, setNewItem] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [avisado, setAvisado] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Criar pela aba Etapas é criar uma ETAPA do template: o título nasce no
  // padrão "N · Nome", que é o que a aba lê para agrupar. Digitá-lo à mão foi
  // como os projetos ganharam etapas duplicadas e trabalho que caía em "Outras
  // atividades" sem ninguém entender por quê.
  //
  // A caixa de avulsa fica no topo porque é ela que decide o resto do
  // formulário — descobrir isso depois de preencher seria refazer o preenchido.
  const [avulsa, setAvulsa] = React.useState(editing ? true : !comoEtapa)
  const [etapaEscolhida, setEtapaEscolhida] = React.useState('')

  // As etapas que o projeto já tem. Oferecer uma delas é oferecer a duplicata —
  // e etapa duplicada é problema velho aqui: a própria aba tem um aviso para
  // quando acontece.
  const jaNoProjeto = React.useMemo(() => new Set(
    tasks.filter(t => t.projectId === projectId)
      .map(t => PADRAO_ETAPA.exec(t.title || '')?.[1])
      .filter(Boolean).map(Number)), [tasks, projectId])
  const livres = ETAPAS_PADRAO.map((_, i) => i).filter(i => !jaNoProjeto.has(i))

  // O template são onze etapas, mas o processo não acaba nelas: projeto que
  // precisa de uma décima segunda ganha uma, e a numeração continua de onde
  // parou. Antes, com as onze criadas, o modal simplesmente se recusava a
  // trabalhar — e o trabalho extra virava atividade avulsa, fora da contagem.
  const maiorNumero = Math.max(ETAPAS_PADRAO.length - 1, ...[...jaNoProjeto, -1])
  const proximoNumero = maiorNumero + 1
  const criandoNova = etapaEscolhida === 'nova' || (etapaEscolhida === '' && !livres.length)
  const nEtapaNova = criandoNova ? proximoNumero
    : etapaEscolhida !== '' && ETAPAS_PADRAO[Number(etapaEscolhida)] ? Number(etapaEscolhida)
    : livres[0]
  // O título de uma etapa do template não se digita: ele se monta. O da etapa
  // nova junta o número da vez com o nome que a pessoa escrever.
  const tituloFinal = avulsa || editing
    ? title.trim()
    : criandoNova
      ? (title.trim() ? `${proximoNumero} · ${title.trim()}` : '')
      : (nEtapaNova != null ? tituloDaEtapa(nEtapaNova) : '')

  const ckDone = checklist.filter(i => estadoDoItem(i) === 'done').length
  const ckPct = checklist.length ? Math.round(ckDone / checklist.length * 100) : 0
  const addItem = () => {
    const text = newItem.trim()
    if (!text) return
    setChecklist(c => [...c, { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 5), text, done: false, state: 'todo' }])
    setNewItem('')
  }
  const mudarItem = (id, campos) => setChecklist(c => c.map(i => i.id === id ? { ...i, ...campos } : i))

  // A caixa e o estado são a MESMA informação em dois controles: marcar leva
  // direto para Concluído e desmarcar volta para Pendente, senão o item ficaria
  // riscado dizendo "em revisão" — e o servidor, que deriva o status da etapa a
  // partir do estado, discordaria do que a tela mostra.
  //
  // Em modo leitura, marcar persiste na hora (endpoint dedicado); em modo
  // edição, fica local e é salvo no "Salvar alterações".
  const toggleItem = (id) => {
    const atual = checklist.find(i => i.id === id)
    const feito = estadoDoItem(atual) !== 'done'
    mudarItem(id, { done: feito, state: feito ? 'done' : 'todo' })
    // O valor novo vai junto: `task` aqui é a cópia tirada na abertura do
    // modal, e recalcular o estado a partir dela reenviaria done:true no
    // segundo clique no mesmo item.
    if (ro && onToggleChecklist && task) onToggleChecklist(task, id, feito)
  }

  // Escolher "Concluído" no chip marca a caixa, pelo mesmo motivo. O chip só
  // aparece em modo edição, então aqui não há nada a persistir na hora.
  const mudarEstado = (id, state) => mudarItem(id, { state, done: state === 'done' })
  const removeItem = (id) => setChecklist(c => c.filter(i => i.id !== id))

  const toggleMember = (id) => setMemberIds(m => m.includes(id) ? m.filter(x => x !== id) : [...m, id])

  // Auto-participação (viewers): entrar/sair só da própria participação, sem salvar o resto.
  const meAssignee = assigneeId === currentUserId
  const meMember = memberIds.includes(currentUserId)
  const toggleSelf = () => {
    const join = !meMember
    setMemberIds(m => join ? [...m, currentUserId] : m.filter(x => x !== currentUserId))
    if (onToggleMembership && task) onToggleMembership(task, join)
  }

  // Quem pode receber a atividade. Um responsável ou membro já gravado entra
  // na lista mesmo sendo conta de manutenção, senão o salvamento o trocaria.
  const pessoas = paraAtribuir(users, assigneeId, memberIds, task?.assigneeId, task?.memberIds)

  // Numa etapa do template ("3 · Orçamento"), o número decide as sugestões.
  // Atividade avulsa não tem etapa: cai na lista geral. Na criação o título
  // ainda não existe, então o número vem da etapa escolhida — em string, que
  // é como o servidor indexa as sugestões.
  const nEtapa = editing ? PADRAO_ETAPA.exec(task?.title || '')?.[1] : (!avulsa && nEtapaNova != null ? String(nEtapaNova) : null)

  const dErr = dateError(start, end)
  const titleErr = touched && (avulsa || criandoNova) && !title.trim()
    ? (criandoNova ? 'Dê um nome à etapa.' : 'Informe um título.') : null
  const projErr = touched && !projectId ? 'Selecione um projeto.' : null

  // O que falta numa etapa não impede de criá-la: a etapa nasce e o responsável
  // ou o prazo chegam depois. Mas é dito antes de gravar, e continua dito por um
  // aviso ao lado do nome dela na aba.
  const pendencias = pendenciasDaEtapa({ assigneeId, end, checklist })

  const save = () => {
    setTouched(true)
    if (!tituloFinal || !projectId || dErr) return
    if (pendencias.length) { setAvisado(true); return }
    gravar()
  }

  // A guarda contra o clique duplo fica aqui, e não em save(): o
  // PopupPendencias chama gravar() direto.
  const gravar = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave({ ...(task || {}), title: tituloFinal, projectId, assigneeId, memberIds: memberIds.filter(id => id !== assigneeId), status, priority, start: start || null, end: end || null, checklist })
    } finally { setSaving(false) }
  }

  // Etapa do processo ou atividade avulsa? O modal é o mesmo, mas o nome não:
  // ele chamava tudo de etapa, inclusive a avulsa que nasce fora do template.
  // Numa já gravada o título é quem diz, porque `avulsa` só vale na criação.
  const ehEtapa = editing ? PADRAO_ETAPA.test(task?.title || '') : !avulsa

  return (
    <Modal className="project-modal" title={ro ? (ehEtapa ? 'Detalhes da etapa' : 'Detalhes da atividade') : editing ? (ehEtapa ? 'Editar etapa' : 'Editar atividade') : avulsa ? 'Nova atividade avulsa' : 'Nova etapa'} onClose={onClose}
      footer={ro ? (
        <button className="btn btn-secondary" onClick={onClose}>Fechar</button>
      ) : (<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : editing ? 'Salvar alterações' : ehEtapa ? 'Criar etapa' : 'Criar atividade'}
        </button>
      </>)}>
      {ro && (
        <p className="ro-hint"><Icon name="lock" size={14} />Você tem acesso de exibição. Pode marcar o checklist, mas não editar a atividade.</p>
      )}
      {avisado && !ro && (
        <PopupPendencias itens={pendencias} onCancelar={() => setAvisado(false)}
          onSalvar={() => { setAvisado(false); gravar() }}
          rotulo={editing ? 'Salvar mesmo assim' : 'Criar mesmo assim'}
          acao={'Dá para ' + (editing ? 'salvar' : 'criar') + ' assim e completar depois. Enquanto faltar, um aviso fica ao lado do nome da etapa.'} />
      )}
      {!editing && !ro && (
        <Field label="O que você está criando">
          <label className="marca">
            <input type="checkbox" className="ck-nativo" checked={avulsa} onChange={e => setAvulsa(e.target.checked)} />
            Atividade avulsa — fora do template de etapas
          </label>
          <span className="marca-nota">
            {avulsa
              ? 'Nasce solta, em "Outras atividades", com o título que você escrever.'
              : 'Entra como etapa numerada do processo, no padrão que a aba Etapas agrupa.'}
          </span>
        </Field>
      )}

      {avulsa || editing ? (
        <Field label={editing ? 'Título' : 'Título da atividade'}>
          <input className="control" value={title} autoFocus={!ro} disabled={ro} placeholder="Ex.: Revisar protótipo"
            onChange={e => setTitle(e.target.value)} />
          <FieldError>{titleErr}</FieldError>
        </Field>
      ) : (
        <Field label="Etapa do processo">
          <select className="control" value={criandoNova ? 'nova' : nEtapaNova}
            onChange={e => setEtapaEscolhida(e.target.value)}>
            {ETAPAS_PADRAO.map((nome, i) => (
              <option key={i} value={i}>
                {i} · {nome}{jaNoProjeto.has(i) ? ' — o projeto já tem esta' : ''}
              </option>
            ))}
            {/* Nada fica desligado: repetir uma etapa é decisão de quem cadastra,
                não erro. O aviso ao lado do nome basta para ninguém fazer por
                descuido, e a aba já sabe mostrar etapa duplicada. */}
            <option value="nova">Nova etapa — continuar a numeração ({proximoNumero})</option>
          </select>
          {criandoNova ? (<>
            <input className="control" value={title} placeholder="Nome da etapa. Ex.: Complementação de projeto"
              style={{ marginTop: 8 }} onChange={e => setTitle(e.target.value)} />
            <FieldError>{titleErr}</FieldError>
            <span className="marca-nota">
              Entra como <strong>{tituloFinal || `${proximoNumero} · …`}</strong>, depois
              da última etapa do projeto.
            </span>
          </>) : (
            <span className="marca-nota">
              A etapa entra como <strong>{tituloFinal}</strong>.
              {jaNoProjeto.has(nEtapaNova) && ' O projeto já tem uma com este número — vão aparecer as duas.'}
            </span>
          )}
        </Field>
      )}
      <div className="field-row">
        <Field label="Projeto">
          <select className="control" value={projectId} disabled={ro} onChange={e => setProjectId(e.target.value)}>
            <option value="" disabled>Selecione</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <FieldError>{projErr}</FieldError>
        </Field>
        <Field label="Responsável">
          <select className="control" value={assigneeId} disabled={ro} onChange={e => setAssigneeId(e.target.value)}>
            {pessoas.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Status">{ro ? <StatusTag status={status} /> : <SegControl options={STATUSES} value={status} onChange={setStatus} />}</Field>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Membros
          <span style={{ fontWeight: 400, color: 'var(--fg-4)', fontSize: 12.5 }}>além do responsável</span>
        </label>
        {ro && task && (
          meAssignee ? (
            <p className="ro-hint" style={{ margin: '0 0 10px' }}><Icon name="flag" size={14} />Você é o responsável por esta atividade.</p>
          ) : (
            <button type="button" className={'btn btn-sm ' + (meMember ? 'btn-secondary' : 'btn-primary')} style={{ marginBottom: 10 }} onClick={toggleSelf}>
              <Icon name={meMember ? 'logout' : 'plus'} size={15} stroke={2.2} />{meMember ? 'Sair da atividade' : 'Participar da atividade'}
            </button>
          )
        )}
        <div className="member-picker">
          {pessoas.map(u => {
            const isResp = u.id === assigneeId
            const on = isResp || memberIds.includes(u.id)
            return (
              <button type="button" key={u.id}
                className={'chip chip-av' + (on ? ' active' : '') + (isResp ? ' resp' : '')}
                disabled={isResp || ro} aria-pressed={on}
                title={isResp ? 'Responsável' : (on ? 'Remover' : 'Adicionar')}
                onClick={() => toggleMember(u.id)}>
                <span className="av" style={{ width: 22, height: 22, background: u.color, fontSize: 9 }}>{u.initials}</span>
                {u.name.split(' ')[0]}
                {isResp
                  ? <span className="member-tag">resp.</span>
                  : on && <Icon name="check" size={13} stroke={2.6} style={{ color: 'var(--brand)' }} />}
              </button>
            )
          })}
        </div>
      </div>
      <Field label="Prioridade">{ro ? <PriorityTag priority={priority} /> : <SegControl options={PRIORITIES} value={priority} onChange={setPriority} />}</Field>

      <div className="field-row">
        <Field label="Data de início"><input type="date" className="control" value={start} disabled={ro} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="Data de término"><input type="date" className="control" value={end} disabled={ro} onChange={e => setEnd(e.target.value)} /></Field>
      </div>
      <FieldError>{dErr}</FieldError>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Atividades
          {checklist.length > 0 && (
            <span className="ck-badge"><Icon name="check" size={11} stroke={3} />{ckDone}/{checklist.length} · {ckPct}%</span>
          )}
        </label>
        {checklist.length > 0 && (
          <ProgressBar value={ckPct} color={ckPct === 100 ? 'var(--success)' : 'var(--brand)'} style={{ marginBottom: 4 }} />
        )}
        <div className="ck-edit-list">
          {checklist.map(item => {
            const estado = estadoDoItem(item)
            const feito = estado === 'done'
            const cor = STATUS_MAP[estado] || STATUS_MAP.todo
            return (
            <div className="ck-edit-row" key={item.id}>
              <button type="button" className={'ck-box' + (feito ? ' on' : '')} onClick={() => toggleItem(item.id)}
                aria-pressed={feito} aria-label={feito ? `Desmarcar: ${item.text}` : `Marcar: ${item.text}`}>
                {feito && <Icon name="check" size={12} stroke={3} />}
              </button>
              {/* Editável no lugar. Antes o texto era só leitura aqui e a única
                  saída era remover e recriar — o item voltava sem dono, sem
                  estado e no fim da lista. */}
              {ro ? (
                <span className={'ck-text' + (feito ? ' done' : '')}>{item.text}</span>
              ) : (
                <input className={'control ck-input' + (feito ? ' done' : '')} value={item.text}
                  aria-label={`Texto do item: ${item.text}`}
                  onChange={e => mudarItem(item.id, { text: e.target.value })} />
              )}
              {!ro && (
                <select className="estado-chip" value={estado} style={{ background: cor.soft, color: cor.text }}
                  aria-label={`Estado de: ${item.text}`}
                  onChange={e => mudarEstado(item.id, e.target.value)}>
                  {CHECK_STATES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              )}
              {!ro && <button type="button" className="btn-icon ck-del" onClick={() => removeItem(item.id)} aria-label={`Remover: ${item.text}`}><Icon name="x" size={14} /></button>}
            </div>
            )
          })}
        </div>
        {!ro && (
          <div className="ck-add">
            <SugestaoItem value={newItem} onChange={setNewItem} onEnter={addItem}
              etapa={nEtapa} jaUsados={checklist.map(i => i.text)}
              placeholder="Adicionar atividade…" ariaLabel="Adicionar atividade à etapa" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}><Icon name="plus" size={15} stroke={2.2} />Adicionar</button>
          </div>
        )}
      </div>
    </Modal>
  )
}
