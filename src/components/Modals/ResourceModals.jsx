import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field, SegControl } from '../primitives/primitives.jsx'
import { MAX_FILE_BYTES, formatBytes } from '../../data/store.js'

// Editor de recursos do projeto: documentos, links e imagens (por URL) que
// ajudam a entender o projeto. Cada item = { id, type: 'doc'|'link'|'image', url, label }.
const RES_ICON = { doc: 'file', image: 'image', link: 'link', kmz: 'map' }
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

// Modal para adicionar um arquivo .KMZ (área/trecho georreferenciado do
// serviço) — só aparece para projetos de piçarramento/pavimentação. Mesmo
// fluxo do documento: sobe pro banco e vira um recurso do tipo 'kmz'.
export function KmzModal({ onSave, onClose }) {
  const [file, setFile] = React.useState(null)
  const [name, setName] = React.useState('')
  const [err, setErr] = React.useState(null)
  const [saving, setSaving] = React.useState(false)

  const onPick = (f, fileErr) => {
    if (f && !/\.kmz$/i.test(f.name)) { setFile(null); setErr('Selecione um arquivo .kmz.'); return }
    setFile(fileErr ? null : f); setErr(fileErr)
  }

  const save = async () => {
    if (!file) { setErr('Selecione um arquivo .kmz.'); return }
    setSaving(true)
    try { await onSave({ upload: true, file, kind: 'kmz', label: name.trim() }) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Novo arquivo .kmz" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Enviando…' : 'Adicionar .kmz'}</button>
      </>}>
      <Field label="Arquivo .kmz">
        <FilePicker accept=".kmz" file={file} onPick={onPick} error={err} />
      </Field>
      <Field label="Nome">
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

// Lista editável de documentos/links dentro do formulário do projeto (ProjectModal).
export function ResourceEditor({ resources, onChange }) {
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
