import React from 'react'
import { Icon } from './Icon.jsx'
import { Modal, Field, SegControl } from './primitives.jsx'
import { STATUSES, PRIORITIES, PROJECT_HEX } from '../data/store.js'
// Create/edit modals for tasks and projects + confirm dialog. Includes validation.

function dateError(start, end) {
  if (start && end && new Date(end) < new Date(start)) return 'A data de término não pode ser anterior à de início.'
  return null
}

export function TaskModal({ task, projects, users, defaultProjectId, defaultStatus, onSave, onClose }) {
  const editing = !!task
  const [title, setTitle] = React.useState(task?.title || '')
  const [projectId, setProjectId] = React.useState(task?.projectId || defaultProjectId || projects[0]?.id || '')
  const [assigneeId, setAssigneeId] = React.useState(task?.assigneeId || users[0]?.id || '')
  const [memberIds, setMemberIds] = React.useState(task?.memberIds ? [...task.memberIds] : [])
  const [status, setStatus] = React.useState(task?.status || defaultStatus || 'todo')
  const [priority, setPriority] = React.useState(task?.priority || 'medium')
  const [start, setStart] = React.useState(task?.start || '2026-05-26')
  const [end, setEnd] = React.useState(task?.end || '2026-06-05')
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
  const toggleItem = (id) => setChecklist(c => c.map(i => i.id === id ? { ...i, done: !i.done } : i))
  const removeItem = (id) => setChecklist(c => c.filter(i => i.id !== id))

  const toggleMember = (id) => setMemberIds(m => m.includes(id) ? m.filter(x => x !== id) : [...m, id])

  const dErr = dateError(start, end)
  const titleErr = touched && !title.trim() ? 'Informe um título.' : null
  const projErr = touched && !projectId ? 'Selecione um projeto.' : null

  const save = () => {
    setTouched(true)
    if (!title.trim() || !projectId || dErr) return
    onSave({ ...(task || {}), title: title.trim(), projectId, assigneeId, memberIds: memberIds.filter(id => id !== assigneeId), status, priority, start, end, checklist })
  }

  return (
    <Modal title={editing ? 'Editar atividade' : 'Nova atividade'} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>{editing ? 'Salvar alterações' : 'Criar atividade'}</button>
      </>}>
      <Field label="Título da atividade">
        <input className="control" value={title} autoFocus placeholder="Ex.: Revisar protótipo"
          onChange={e => setTitle(e.target.value)} />
        {titleErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{titleErr}</span>}
      </Field>
      <div className="field-row">
        <Field label="Projeto">
          <select className="control" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="" disabled>Selecione</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {projErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{projErr}</span>}
        </Field>
        <Field label="Responsável">
          <select className="control" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Status"><SegControl options={STATUSES} value={status} onChange={setStatus} /></Field>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Membros
          <span style={{ fontWeight: 400, color: 'var(--fg-4)', fontSize: 12.5 }}>além do responsável</span>
        </label>
        <div className="member-picker">
          {users.map(u => {
            const isResp = u.id === assigneeId
            const on = isResp || memberIds.includes(u.id)
            return (
              <button type="button" key={u.id}
                className={'member-chip' + (on ? ' on' : '') + (isResp ? ' resp' : '')}
                disabled={isResp}
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
      <Field label="Prioridade"><SegControl options={PRIORITIES} value={priority} onChange={setPriority} /></Field>
      <div className="field-row">
        <Field label="Data de início"><input type="date" className="control" value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="Data de término"><input type="date" className="control" value={end} onChange={e => setEnd(e.target.value)} /></Field>
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
              <button type="button" className="btn-icon ck-del" onClick={() => removeItem(item.id)} aria-label="Remover"><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
        <div className="ck-add">
          <input className="control" value={newItem} placeholder="Adicionar item…"
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}><Icon name="plus" size={15} stroke={2.2} />Adicionar</button>
        </div>
      </div>
    </Modal>
  )
}

export function ProjectModal({ project, onSave, onClose }) {
  const editing = !!project
  const [name, setName] = React.useState(project?.name || '')
  const [desc, setDesc] = React.useState(project?.desc || '')
  const [color, setColor] = React.useState(project?.color || 'indigo')
  const [start, setStart] = React.useState(project?.start || '2026-05-26')
  const [end, setEnd] = React.useState(project?.end || '2026-07-01')
  const [touched, setTouched] = React.useState(false)

  const dErr = dateError(start, end)
  const nameErr = touched && !name.trim() ? 'Informe um nome.' : null

  const save = () => {
    setTouched(true)
    if (!name.trim() || dErr) return
    onSave({ ...(project || {}), name: name.trim(), desc: desc.trim(), color, start, end })
  }

  return (
    <Modal title={editing ? 'Editar projeto' : 'Novo projeto'} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>{editing ? 'Salvar alterações' : 'Criar projeto'}</button>
      </>}>
      <Field label="Nome do projeto">
        <input className="control" value={name} autoFocus placeholder="Ex.: Rebrand 2026" onChange={e => setName(e.target.value)} />
        {nameErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{nameErr}</span>}
      </Field>
      <Field label="Descrição">
        <textarea className="control" value={desc} placeholder="Sobre o que é este projeto?" onChange={e => setDesc(e.target.value)} />
      </Field>
      <Field label="Cor">
        <div className="color-swatches">
          {Object.keys(PROJECT_HEX).map(k => (
            <button key={k} className={color === k ? 'on' : ''} style={{ background: PROJECT_HEX[k] }} onClick={() => setColor(k)} aria-label={k} />
          ))}
        </div>
      </Field>
      <div className="field-row">
        <Field label="Data de início"><input type="date" className="control" value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="Data de término"><input type="date" className="control" value={end} onChange={e => setEnd(e.target.value)} /></Field>
      </div>
      {dErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{dErr}</span>}
    </Modal>
  )
}

export function ChangePasswordModal({ onSubmit, onClose }) {
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState(null)
  const [busy, setBusy] = React.useState(false)

  const save = async () => {
    setError(null)
    if (next.length < 6) return setError('A nova senha precisa ter ao menos 6 caracteres.')
    if (next !== confirm) return setError('A confirmação não confere.')
    setBusy(true)
    try { await onSubmit(current, next) }
    catch (err) { setError(err.message || 'Não foi possível trocar a senha.'); setBusy(false) }
  }

  return (
    <Modal title="Trocar senha" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
      </>}>
      <Field label="Senha atual">
        <input className="control" type="password" autoFocus value={current} onChange={e => setCurrent(e.target.value)} />
      </Field>
      <Field label="Nova senha">
        <input className="control" type="password" value={next} onChange={e => setNext(e.target.value)} />
      </Field>
      <Field label="Confirmar nova senha">
        <input className="control" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
      </Field>
      {error && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{error}</span>}
    </Modal>
  )
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel || 'Excluir'}</button>
      </>}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>{message}</p>
    </Modal>
  )
}
