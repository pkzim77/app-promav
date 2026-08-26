import './Modals.css'
import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field, SegControl, StatusTag, PriorityTag } from '../primitives/primitives.jsx'
import { STATUSES, PRIORITIES, PROJECT_HEX, MAX_FILE_BYTES, formatBytes, PROJECT_ROLES, ROLE_LABEL, RESOURCE_ORIGINS, PROJECT_STATUSES, parseBRL, maskBRL } from '../../data/store.js'
// Create/edit modals for tasks and projects + confirm dialog. Includes validation.

// Campo de dinheiro: formata a cada tecla (2.500,00) e mantém o cursor no fim,
// já que a máscara faz o número crescer sempre pela direita.
function MoneyInput({ value, onChange, placeholder }) {
  const ref = React.useRef(null)
  const handle = (e) => {
    onChange(maskBRL(e.target.value))
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) el.setSelectionRange(el.value.length, el.value.length)
    })
  }
  return (
    <div className="money-field">
      <span className="money-prefix">R$</span>
      <input ref={ref} className="control" inputMode="numeric" placeholder={placeholder}
        value={value} onChange={handle} />
    </div>
  )
}

function dateError(start, end) {
  if (start && end && new Date(end) < new Date(start)) return 'A data de término não pode ser anterior à de início.'
  return null
}

export function TaskModal({ task, projects, users, currentUserId, defaultProjectId, defaultStatus, canEdit = true, onToggleChecklist, onToggleMembership, onSave, onClose }) {
  const editing = !!task
  const ro = !canEdit // somente leitura (papel 'Só exibição'): só checklist + entrar/sair
  const [title, setTitle] = React.useState(task?.title || '')
  const [projectId, setProjectId] = React.useState(task?.projectId || defaultProjectId || projects[0]?.id || '')
  const [assigneeId, setAssigneeId] = React.useState(task?.assigneeId || '')
  const [memberIds, setMemberIds] = React.useState(task?.memberIds ? [...task.memberIds] : [])
  const [status, setStatus] = React.useState(task?.status || defaultStatus || 'todo')
  const [priority, setPriority] = React.useState(task?.priority || 'medium')
  const [start, setStart] = React.useState(task?.start || '')
  const [end, setEnd] = React.useState(task?.end || '')
  const [checklist, setChecklist] = React.useState(task?.checklist ? task.checklist.map(i => ({ ...i })) : [])
  const [newItem, setNewItem] = React.useState('')
  const [selectedMemberId, setSelectedMemberId] = React.useState('')
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

  const addMember = () => {
    if (!selectedMemberId) return
    setMemberIds(m => m.includes(selectedMemberId) ? m : [...m, selectedMemberId])
    setSelectedMemberId('')
  }
  const removeMember = (id) => setMemberIds(m => m.filter(x => x !== id))

  // Auto-participação (viewers): entrar/sair só da própria participação, sem salvar o resto.
  const meAssignee = assigneeId === currentUserId
  const meMember = memberIds.includes(currentUserId)
  const toggleSelf = () => {
    const join = !meMember
    setMemberIds(m => join ? [...m, currentUserId] : m.filter(x => x !== currentUserId))
    if (onToggleMembership && task) onToggleMembership(task, join)
  }

  const activityMembers = users.filter(u => u.id === assigneeId || memberIds.includes(u.id))
  const availableMembers = users.filter(u => !u.isAdmin && u.id !== assigneeId && !memberIds.includes(u.id))

  const dErr = dateError(start, end)
  const titleErr = touched && !title.trim() ? 'Informe um título.' : null
  const projErr = touched && !projectId ? 'Selecione um projeto.' : null

  const save = () => {
    setTouched(true)
    if (!title.trim() || !projectId || dErr) return
    onSave({ ...(task || {}), title: title.trim(), projectId, parentId, assigneeId, memberIds: memberIds.filter(id => id !== assigneeId), status, priority, start: start || null, end: end || null, checklist })
  }

  return (
    <Modal className="task-modal" title={ro ? 'Detalhes da atividade' : (editing ? 'Editar atividade' : 'Nova atividade')} onClose={onClose}
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
            <option value="">Sem responsável</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
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
        {!ro && (
          <div className="perm-add">
            <select className="control" value={selectedMemberId} onChange={e => setSelectedMemberId(e.target.value)}>
              <option value="">Selecionar pessoa</option>
              {availableMembers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!selectedMemberId} onClick={addMember}>
              <Icon name="plus" size={15} stroke={2.2} />Adicionar
            </button>
          </div>
        )}
        <div className="member-picker">
          {activityMembers.map(u => {
            const isResp = u.id === assigneeId
            const on = isResp || memberIds.includes(u.id)
            return (
              <button type="button" key={u.id}
                className={'member-chip' + (on ? ' on' : '') + (isResp ? ' resp' : '')}
                disabled={isResp || ro}
                title={isResp ? 'Responsável' : 'Remover'}
                onClick={() => removeMember(u.id)}>
                <span className="av" style={{ width: 22, height: 22, background: u.color, fontSize: 9 }}>{u.initials}</span>
                {u.name.split(' ')[0]}
                {isResp
                  ? <span className="member-tag">resp.</span>
                  : on && <Icon name="x" size={13} stroke={2.2} style={{ color: 'var(--fg-4)' }} />}
              </button>
            )
          })}
        </div>
        {!activityMembers.length && <div className="perm-empty">Nenhum membro adicionado.</div>}
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

// Editor de recursos do projeto: documentos, links e imagens (por URL) que
// ajudam a entender o projeto. Cada item = { id, type: 'doc'|'link'|'image', url, label }.
const RES_ICON = { doc: 'file', image: 'image', link: 'link' }
const RES_PLACEHOLDER = {
  doc:   { url: 'URL do documento (Google Docs, PDF…)', label: 'Nome do documento' },
  link:  { url: 'URL do link (https://…)',              label: 'Texto do link (opcional)' },
  image: { url: 'URL da imagem (https://…)',            label: 'Legenda (opcional)' },
}
const RES_OPTIONS = [{ id: 'doc', label: 'Documento' }, { id: 'link', label: 'Link' }, { id: 'image', label: 'Imagem' }]

// Monta um recurso a partir dos campos do formulário (normaliza a URL com https://).
function buildResource(type, url, label) {
  const u = url.trim()
  if (!u) return null
  const withProto = /^https?:\/\//i.test(u) ? u : 'https://' + u
  return {
    id: 'r' + Date.now() + Math.random().toString(36).slice(2, 5),
    type, url: withProto, label: label.trim(),
  }
}

// ----- Modais dedicados (um por tipo de recurso) -----
// São independentes de propósito: cada um pode ganhar campos próprios no futuro.

// Campo de seleção de arquivo reutilizado pelos modais de upload.
function FilePicker({ accept, file, onPick, error }) {
  const inputRef = React.useRef(null)
  const pick = (f) => {
    if (f && f.size > MAX_FILE_BYTES) { onPick(f, `Arquivo maior que ${formatBytes(MAX_FILE_BYTES)}.`); return }
    onPick(f || null, null)
  }
  return (
    <>
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }}
        onChange={(e) => pick(e.target.files[0])} />
      <button type="button" className="filepicker" onClick={() => inputRef.current?.click()}>
        {file ? (
          <span className="filepicker-file">
            <Icon name="file" size={18} />
            <span className="filepicker-meta">
              <span className="filepicker-name">{file.name}</span>
              <span className="filepicker-size">{formatBytes(file.size)}</span>
            </span>
          </span>
        ) : (
          <span className="filepicker-empty"><Icon name="plus" size={16} stroke={2.2} />Escolher arquivo do computador</span>
        )}
      </button>
      {error && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{error}</span>}
    </>
  )
}

// Modal para adicionar um DOCUMENTO (upload de arquivo do computador → banco).
export function DocumentModal({ onSave, onClose }) {
  const [file, setFile] = React.useState(null)
  const [name, setName] = React.useState('')
  const [err, setErr] = React.useState(null)
  const [saving, setSaving] = React.useState(false)

  const onPick = (f, fileErr) => { setFile(fileErr ? null : f); setErr(fileErr) }

  const save = async () => {
    if (!file) { setErr('Selecione um arquivo.'); return }
    setSaving(true)
    try { await onSave({ upload: true, file, kind: 'doc', label: name.trim() }) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Novo documento" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Enviando…' : 'Adicionar documento'}</button>
      </>}>
      <Field label="Arquivo do documento">
        <FilePicker file={file} onPick={onPick} error={err} />
      </Field>
      <Field label="Nome do documento">
        <input className="control" value={name} placeholder="Opcional — usa o nome do arquivo se vazio"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
      </Field>
    </Modal>
  )
}

// Modal para adicionar um LINK (URL + título).
export function LinkModal({ onSave, onClose }) {
  const [url, setUrl] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const urlErr = touched && !url.trim() ? 'Informe a URL do link.' : null

  const save = () => {
    setTouched(true)
    const res = buildResource('link', url, title)
    if (!res) return
    onSave(res)
  }

  return (
    <Modal title="Novo link" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>Adicionar link</button>
      </>}>
      <Field label="URL do link">
        <input className="control" value={url} autoFocus placeholder="https://…"
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
        {urlErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{urlErr}</span>}
      </Field>
      <Field label="Título do link">
        <input className="control" value={title} placeholder="Texto exibido (opcional)"
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
      </Field>
    </Modal>
  )
}

// Modal para adicionar uma IMAGEM: arquivo do computador (→ banco) OU URL externa.
export function ImageModal({ onSave, onClose }) {
  const [source, setSource] = React.useState('file') // 'file' | 'url'
  const [file, setFile] = React.useState(null)
  const [url, setUrl] = React.useState('')
  const [caption, setCaption] = React.useState('')
  const [err, setErr] = React.useState(null)
  const [touched, setTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [filePreview, setFilePreview] = React.useState(null)

  // Gera/revoga a URL de pré-visualização ao trocar de arquivo.
  React.useEffect(() => {
    if (!file) { setFilePreview(null); return }
    const obj = URL.createObjectURL(file)
    setFilePreview(obj)
    return () => URL.revokeObjectURL(obj)
  }, [file])

  const onPick = (f, fileErr) => { setFile(fileErr ? null : f); setErr(fileErr) }

  const urlErr = touched && source === 'url' && !url.trim() ? 'Informe a URL da imagem.' : null
  const normUrl = /^https?:\/\//i.test(url.trim()) ? url.trim() : 'https://' + url.trim()
  const preview = source === 'file' ? filePreview : (url.trim() ? normUrl : null)

  const save = async () => {
    setTouched(true)
    if (source === 'file') {
      if (!file) { setErr('Selecione uma imagem.'); return }
      setSaving(true)
      try { await onSave({ upload: true, file, kind: 'image', label: caption.trim() }) }
      finally { setSaving(false) }
    } else {
      const res = buildResource('image', url, caption)
      if (!res) return
      await onSave(res)
    }
  }

  return (
    <Modal title="Nova imagem" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Enviando…' : 'Adicionar imagem'}</button>
      </>}>
      <Field label="Origem da imagem">
        <SegControl options={[{ id: 'file', label: 'Arquivo' }, { id: 'url', label: 'Link' }]} value={source} onChange={setSource} />
      </Field>
      {source === 'file' ? (
        <Field label="Imagem do computador">
          <FilePicker accept="image/*" file={file} onPick={onPick} error={err} />
        </Field>
      ) : (
        <Field label="URL da imagem">
          <input className="control" value={url} autoFocus placeholder="https://…/imagem.jpg"
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
          {urlErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{urlErr}</span>}
        </Field>
      )}
      {preview && (
        <div className="img-modal-preview">
          <img src={preview} alt="Pré-visualização" />
        </div>
      )}
      <Field label="Legenda">
        <input className="control" value={caption} placeholder="Descrição curta (opcional)"
          onChange={e => setCaption(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
      </Field>
    </Modal>
  )
}
function ResourceEditor({ resources, onChange }) {
  const [type, setType] = React.useState('doc')
  const [url, setUrl] = React.useState('')
  const [label, setLabel] = React.useState('')

  const add = () => {
    const res = buildResource(type, url, label)
    if (!res) return
    onChange([...resources, res])
    setUrl(''); setLabel('')
  }
  const remove = (id) => onChange(resources.filter(r => r.id !== id))

  return (
    <div className="field">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Documentos e links
        <span style={{ fontWeight: 400, color: 'var(--fg-4)', fontSize: 12.5 }}>materiais de apoio</span>
      </label>

      {resources.length > 0 && (
        <div className="res-edit-list">
          {resources.map(r => (
            <div className="res-edit-row" key={r.id}>
              <span className="res-edit-ic"><Icon name={RES_ICON[r.type] || 'link'} size={15} /></span>
              <span className="res-edit-info">
                <span className="res-edit-label">{r.label || r.url}</span>
                <span className="res-edit-url">{r.url}</span>
              </span>
              <button type="button" className="btn-icon res-del" onClick={() => remove(r.id)} aria-label="Remover"><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="res-add">
        <SegControl options={RES_OPTIONS} value={type} onChange={setType} />
        <input className="control" value={url}
          placeholder={RES_PLACEHOLDER[type].url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <input className="control" value={label}
          placeholder={RES_PLACEHOLDER[type].label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={add}><Icon name="plus" size={15} stroke={2.2} />Adicionar</button>
      </div>
    </div>
  )
}

// Equipe do projeto — lista única que resolve duas coisas de uma vez:
//  • acesso: quem não estiver na lista NÃO enxerga o projeto no sistema
//    (administradores têm acesso total e não ocupam vaga de participante);
//  • responsabilidade: o check da esquerda marca quem responde pelo projeto.
// O seletor de acesso e o "Adicionar" só aparecem para administradores; os
// demais veem o papel como texto (o backend também ignora alterações de
// permissão de não-admins) mas ainda podem marcar os responsáveis, porque
// PUT /api/projects/:id aceita responsibleIds de quem tem Edição total.
function PermissionsEditor({ users, members, responsibleIds, onChangeMembers, onChangeResponsibles, isAdmin, error }) {
  const [selectedUserId, setSelectedUserId] = React.useState('')
  const roleOf = (userId) => members.find(x => x.userId === userId)?.role || 'none'
  const setRole = (userId, value) => {
    const others = members.filter(x => x.userId !== userId)
    onChangeMembers(value === 'none' ? others : [...others, { userId, role: value }])
  }
  const addMember = () => {
    if (!selectedUserId) return
    onChangeMembers([...members, { userId: selectedUserId, role: 'view' }])
    setSelectedUserId('')
  }
  // Tirar alguém do projeto também o tira da responsabilidade: um responsável
  // sem acesso apareceria no Panorama sem conseguir abrir o projeto.
  const removeMember = (userId) => {
    onChangeMembers(members.filter(x => x.userId !== userId))
    onChangeResponsibles(responsibleIds.filter(x => x !== userId))
  }

  const isResp = (userId) => responsibleIds.includes(userId)
  const toggleResp = (u) => {
    if (isResp(u.id)) { onChangeResponsibles(responsibleIds.filter(x => x !== u.id)); return }
    onChangeResponsibles([...responsibleIds, u.id])
    // Marcar alguém como responsável garante que ele enxergue o projeto.
    if (isAdmin && !u.isAdmin && roleOf(u.id) === 'none') setRole(u.id, 'full')
  }

  const availableUsers = users.filter(u => !u.isAdmin && roleOf(u.id) === 'none')
  // Admins entram na lista mesmo sem vínculo: têm acesso total e são elegíveis
  // a responsável (normalmente é o engenheiro responsável quem responde).
  const teamUsers = users.filter(u => u.isAdmin || roleOf(u.id) !== 'none')
  const comAcesso = users.filter(u => !u.isAdmin && roleOf(u.id) !== 'none').length
  const nResp = users.filter(u => isResp(u.id)).length
  return (
    <div className="field">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Equipe do projeto
        <span style={{ fontWeight: 400, color: 'var(--fg-4)', fontSize: 12.5 }}>marque quem responde pelo projeto</span>
      </label>
      {isAdmin && (
        <div className="perm-add">
          <select className="control" value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
            <option value="">Selecionar pessoa</option>
            {availableUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!selectedUserId} onClick={addMember}>
            <Icon name="plus" size={15} stroke={2.2} />Adicionar
          </button>
        </div>
      )}
      <div className="perm-head">
        <span className="perm-head-resp">Resp.</span>
        <span>Pessoa</span>
        <span className="perm-head-role">Acesso ao projeto</span>
        {isAdmin && <span className="perm-head-spacer" />}
      </div>
      <div className="perm-list">
        {teamUsers.map(u => {
          const resp = isResp(u.id)
          return (
            <div className={'perm-row' + (resp ? ' is-resp' : '')} key={u.id}>
              <button type="button" role="checkbox" aria-checked={resp}
                className={'resp-check' + (resp ? ' on' : '')}
                title={resp ? 'Remover como responsável' : 'Marcar como responsável'}
                onClick={() => toggleResp(u)}>
                {resp && <Icon name="check" size={13} stroke={3} />}
              </button>
              <span className="av" style={{ width: 26, height: 26, background: u.color, fontSize: 10 }}>{u.initials}</span>
              <span className="perm-name">{u.name}{u.isAdmin ? ' · admin' : ''}</span>
              {u.isAdmin ? (
                <span className="perm-admin-tag">Acesso total</span>
              ) : isAdmin ? (
                <>
                  <select className="control perm-select" value={roleOf(u.id)} onChange={e => setRole(u.id, e.target.value)}>
                    {PROJECT_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                  <button type="button" className="btn-icon perm-remove" onClick={() => removeMember(u.id)} aria-label={`Remover ${u.name}`} title="Remover participante">
                    <Icon name="x" size={15} />
                  </button>
                </>
              ) : (
                <span className="perm-role-static">{ROLE_LABEL[roleOf(u.id)] || 'Sem acesso'}</span>
              )}
            </div>
          )
        })}
      </div>
      {!teamUsers.length && <div className="perm-empty">Nenhum participante adicionado.</div>}
      {error && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{error}</span>}
      <div className="perm-default-label" style={{ marginTop: 10 }}>
        {comAcesso === 0
          ? 'Ninguém além dos administradores vê este projeto.'
          : `${comAcesso} ${comAcesso === 1 ? 'pessoa vê' : 'pessoas veem'} este projeto (além dos administradores).`}
        {nResp > 0 && ` · ${nResp} ${nResp === 1 ? 'responsável' : 'responsáveis'}.`}
      </div>
    </div>
  )
}

export function ProjectModal({ project, users = [], folders = [], defaultFolderId = null, isAdmin = false, onSave, onClose }) {
  const editing = !!project
  const [name, setName] = React.useState(project?.name || '')
  const [desc, setDesc] = React.useState(project?.desc || '')
  const [color, setColor] = React.useState(project?.color || 'indigo')
  const [folderId, setFolderId] = React.useState(project?.folderId || defaultFolderId || '')
  const [start, setStart] = React.useState(project?.start || null)
  const [end, setEnd] = React.useState(project?.end || null)
  const [notes, setNotes] = React.useState(project?.notes || '')
  const [resources, setResources] = React.useState(project?.resources ? project.resources.map(r => ({ ...r })) : [])
  const [members, setMembers] = React.useState(project?.members ? project.members.map(m => ({ ...m })) : [])
  // ----- ficha do projeto (dados do convênio) -----
  const [prefeitura, setPrefeitura] = React.useState(project?.prefeitura || '')
  const [secretaria, setSecretaria] = React.useState(project?.secretaria || '')
  const [responsibleIds, setResponsibleIds] = React.useState(project?.responsibleIds ? [...project.responsibleIds] : [])
  const [origemRecurso, setOrigemRecurso] = React.useState(project?.origemRecurso || 'federal')
  // Valores em R$: mantidos como texto enquanto digita; convertidos ao salvar.
  const moneyText = (v) => (v != null ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
  const [estimadoText, setEstimadoText] = React.useState(moneyText(project?.valorEstimado))
  const [orcadoText, setOrcadoText] = React.useState(moneyText(project?.valorOrcado))
  const [projStatus, setProjStatus] = React.useState(project?.status || 'planejamento')
  const [touched, setTouched] = React.useState(false)

  const dErr = dateError(start, end)
  const nameErr = touched && !name.trim() ? 'Informe um nome.' : null
  const prefErr = touched && !prefeitura.trim() ? 'Informe a prefeitura.' : null
  const respErr = touched && responsibleIds.length === 0 ? 'Selecione ao menos um profissional responsável.' : null
  const badMoney = (t) => !!t.trim() && parseBRL(t) === null
  const estimadoErr = touched && badMoney(estimadoText) ? 'Valor inválido. Ex.: 250000,00' : null
  const orcadoErr = touched && badMoney(orcadoText) ? 'Valor inválido. Ex.: 250000,00' : null

  const save = () => {
    setTouched(true)
    if (!name.trim() || !prefeitura.trim() || dErr) return
    if (badMoney(estimadoText) || badMoney(orcadoText)) return
    onSave({
      ...(project || {}), name: name.trim(), desc: desc.trim(), color, folderId: folderId || null, start, end, notes: notes.trim(), resources, members,
      prefeitura: prefeitura.trim(), secretaria: secretaria.trim(), responsibleIds,
      origemRecurso, valorEstimado: parseBRL(estimadoText), valorOrcado: parseBRL(orcadoText), status: projStatus,
    })
  }

  return (
    <Modal className='project-modal' title={editing ? 'Editar projeto' : 'Novo projeto'} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>{editing ? 'Salvar alterações' : 'Criar projeto'}</button>
      </>}>
      <Field label="Nome do projeto">
        <input className="control" value={name?? ''} autoFocus placeholder="Ex.: Rebrand 2026" onChange={e => setName(e.target.value)} />
        {nameErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{nameErr}</span>}
      </Field>
      <Field label="Descrição">
        <textarea className="control" value={desc?? ''} placeholder="Sobre o que é este projeto?" onChange={e => setDesc(e.target.value)} />
      </Field>

      <div className="field-row">
        <Field label="Prefeitura">
          <input className="control" value={prefeitura?? ''} placeholder="Ex.: Umari" onChange={e => setPrefeitura(e.target.value)} />
          {prefErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{prefErr}</span>}
        </Field>
        <Field label="Secretaria">
          <input className="control" value={secretaria?? ''} placeholder="Ex.: Educação" onChange={e => setSecretaria(e.target.value)} />
        </Field>
      </div>

      <PermissionsEditor users={users} members={members} responsibleIds={responsibleIds}
        onChangeMembers={setMembers} onChangeResponsibles={setResponsibleIds}
        isAdmin={isAdmin} error={respErr} />

      <div className="field-row">
        <Field label="Valor estimado">
          <MoneyInput value={estimadoText?? ''} onChange={setEstimadoText} placeholder="0,00" />
          {estimadoErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{estimadoErr}</span>}
        </Field>
        <Field label="Valor orçado">
          <MoneyInput value={orcadoText?? ''} onChange={setOrcadoText} placeholder="0,00" />
          {orcadoErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{orcadoErr}</span>}
        </Field>
      </div>

      <div className="field-row">
        <Field label="Origem do recurso">
          <select className="control" value={origemRecurso?? ''} onChange={e => setOrigemRecurso(e.target.value)}>
            {RESOURCE_ORIGINS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Status do projeto">
          <select className="control" value={projStatus?? ''} onChange={e => setProjStatus(e.target.value)}>
            {PROJECT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Pasta">
        <select className="control" value={folderId??''} onChange={e => setFolderId(e.target.value)}>
          <option value="">Sem pasta</option>
          {folders.map(f => {
            // Caminho completo da pasta (ex: "Obras / São Paulo") para distinguir subpastas.
            const byId = new Map(folders.map(x => [x.id, x]))
            const parts = []
            for (let cur = f, guard = 0; cur && guard < 50; cur = byId.get(cur.parentId), guard++) parts.unshift(cur.name)
            return <option key={f.id} value={f.id}>{parts.join(' / ')}</option>
          })}
        </select>
      </Field>
      <Field label="Anotações">
        <textarea className="control" value={notes?? ''} style={{ minHeight: 110 }}
          placeholder="Contexto, objetivos, observações… O que ajuda a entender o projeto. Links colados aqui viram clicáveis."
          onChange={e => setNotes(e.target.value)} />
      </Field>
      <Field label="Cor">
        <div className="color-swatches">
          {Object.keys(PROJECT_HEX).map(k => (
            <button key={k} className={color === k ? 'on' : ''} style={{ background: PROJECT_HEX[k] }} onClick={() => setColor(k)} aria-label={k} />
          ))}
        </div>
      </Field>
      <div className="field-row">
        <Field label="Data de início"><input type="date" className="control" value={start??''} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="Data de término"><input type="date" className="control" value={end??''} onChange={e => setEnd(e.target.value)} /></Field>
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
