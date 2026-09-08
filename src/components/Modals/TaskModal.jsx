import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field, SegControl, StatusTag, PriorityTag } from '../primitives/primitives.jsx'
import { STATUSES, PRIORITIES, paraAtribuir } from '../../data/store.js'
import { dateError } from './shared/formHelpers.js'

export function TaskModal({ task, projects, users, currentUserId, defaultProjectId, defaultStatus, canEdit = true, onToggleChecklist, onToggleMembership, onSave, onClose }) {
  const editing = !!task
  const ro = !canEdit // somente leitura (papel 'Só exibição'): só checklist + entrar/sair
  const [title, setTitle] = React.useState(task?.title || '')
  const [projectId, setProjectId] = React.useState(task?.projectId || defaultProjectId || projects[0]?.id || '')
  // O padrão é a primeira pessoa que pode receber trabalho: users[0] é a conta
  // de manutenção mais antiga, e toda atividade nova nasceria no nome dela.
  const [assigneeId, setAssigneeId] = React.useState(task?.assigneeId || users.find(u => !u.isDev)?.id || '')
  const [memberIds, setMemberIds] = React.useState(task?.memberIds ? [...task.memberIds] : [])
  const [status, setStatus] = React.useState(task?.status || defaultStatus || 'todo')
  const [priority, setPriority] = React.useState(task?.priority || 'medium')
  const [start, setStart] = React.useState(task?.start || '')
  const [end, setEnd] = React.useState(task?.end || '')
  const [checklist, setChecklist] = React.useState(task?.checklist ? task.checklist.map(i => ({ ...i })) : [])
  const [newItem, setNewItem] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  const ckDone = checklist.filter(i => i.done).length
  const ckPct = checklist.length ? Math.round(ckDone / checklist.length * 100) : 0
  const addItem = () => {
    const text = newItem.trim()
    if (!text) return
    setChecklist(c => [...c, { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 5), text, done: false }])
    setNewItem('')
  }
  // Em modo leitura, marcar checklist persiste na hora (endpoint dedicado); em
  // modo edição, só atualiza o estado local e é salvo no "Salvar alterações".
  const toggleItem = (id) => {
    setChecklist(c => c.map(i => i.id === id ? { ...i, done: !i.done } : i))
    if (ro && onToggleChecklist && task) onToggleChecklist(task, id)
  }
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

  const dErr = dateError(start, end)
  const titleErr = touched && !title.trim() ? 'Informe um título.' : null
  const projErr = touched && !projectId ? 'Selecione um projeto.' : null

  const save = () => {
    setTouched(true)
    if (!title.trim() || !projectId || dErr) return
    onSave({ ...(task || {}), title: title.trim(), projectId, assigneeId, memberIds: memberIds.filter(id => id !== assigneeId), status, priority, start: start || null, end: end || null, checklist })
  }

  return (
    <Modal className="project-modal" title={ro ? 'Detalhes da atividade' : (editing ? 'Editar atividade' : 'Nova atividade')} onClose={onClose}
      footer={ro ? (
        <button className="btn btn-secondary" onClick={onClose}>Fechar</button>
      ) : (<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>{editing ? 'Salvar alterações' : 'Criar atividade'}</button>
      </>)}>
      {ro && (
        <p className="ro-hint"><Icon name="lock" size={14} />Você tem acesso de exibição. Pode marcar o checklist, mas não editar a atividade.</p>
      )}
      <Field label="Título da atividade">
        <input className="control" value={title} autoFocus={!ro} disabled={ro} placeholder="Ex.: Revisar protótipo"
          onChange={e => setTitle(e.target.value)} />
        {titleErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{titleErr}</span>}
      </Field>
      <div className="field-row">
        <Field label="Projeto">
          <select className="control" value={projectId} disabled={ro} onChange={e => setProjectId(e.target.value)}>
            <option value="" disabled>Selecione</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {projErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{projErr}</span>}
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
                className={'member-chip' + (on ? ' on' : '') + (isResp ? ' resp' : '')}
                disabled={isResp || ro}
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
      {dErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{dErr}</span>}

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Checklist
          {checklist.length > 0 && (
            <span className="ck-badge"><Icon name="check" size={11} stroke={3} />{ckDone}/{checklist.length} · {ckPct}%</span>
          )}
        </label>
        {checklist.length > 0 && (
          <div className="progress" style={{ marginBottom: 4 }}><div style={{ width: ckPct + '%', background: ckPct === 100 ? 'var(--success)' : 'var(--brand)' }} /></div>
        )}
        <div className="ck-edit-list">
          {checklist.map(item => (
            <div className="ck-edit-row" key={item.id}>
              <button type="button" className={'ck-box' + (item.done ? ' on' : '')} onClick={() => toggleItem(item.id)} aria-label="Marcar">
                {item.done && <Icon name="check" size={12} stroke={3} />}
              </button>
              <span className={'ck-text' + (item.done ? ' done' : '')}>{item.text}</span>
              {!ro && <button type="button" className="btn-icon ck-del" onClick={() => removeItem(item.id)} aria-label="Remover"><Icon name="x" size={14} /></button>}
            </div>
          ))}
        </div>
        {!ro && (
          <div className="ck-add">
            <input className="control" value={newItem} placeholder="Adicionar item…"
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}><Icon name="plus" size={15} stroke={2.2} />Adicionar</button>
          </div>
        )}
      </div>
    </Modal>
  )
}
