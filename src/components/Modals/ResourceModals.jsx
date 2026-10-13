import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field, SegControl } from '../primitives/primitives.jsx'
import { MAX_FILE_BYTES, formatBytes } from '../../data/store.js'
import { FieldError } from './shared/FieldError.jsx'

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

// Campo de seleção de arquivo reutilizado pelos modais de upload — e pela
// aba "Tipo de obra" do modal de projeto, que anexa o .kmz da obra.
export function FilePicker({ accept, file, onPick, error }) {
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
      <FieldError>{error}</FieldError>
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
    if (saving) return
    if (!file) { setErr('Selecione um arquivo.'); return }
    setSaving(true)
    try { await onSave({ upload: true, file, kind: 'doc', label: name.trim() }) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Novo documento" onClose={onClose} travado={saving}
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
    if (saving) return
    if (!file) { setErr('Selecione um arquivo .kmz.'); return }
    setSaving(true)
    try { await onSave({ upload: true, file, kind: 'kmz', label: name.trim() }) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Novo arquivo .kmz" onClose={onClose} travado={saving}
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
  const [saving, setSaving] = React.useState(false)
  const urlErr = touched && !url.trim() ? 'Informe a URL do link.' : null

  const save = async () => {
    if (saving) return
    setTouched(true)
    const res = buildResource('link', url, title)
    if (!res) return
    setSaving(true)
    try { await onSave(res) } finally { setSaving(false) }
  }

  return (
    <Modal title="Novo link" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Adicionar link'}</button>
      </>}>
      <Field label="URL do link">
        <input className="control" value={url} autoFocus placeholder="https://…"
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
        <FieldError>{urlErr}</FieldError>
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
    if (saving) return
    setTouched(true)
    if (source === 'file') {
      if (!file) { setErr('Selecione uma imagem.'); return }
      setSaving(true)
      try { await onSave({ upload: true, file, kind: 'image', label: caption.trim() }) }
      finally { setSaving(false) }
    } else {
      const res = buildResource('image', url, caption)
      if (!res) return
      setSaving(true)
      try { await onSave(res) } finally { setSaving(false) }
    }
  }

  return (
    <Modal title="Nova imagem" onClose={onClose} travado={saving}
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
          <FieldError>{urlErr}</FieldError>
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

