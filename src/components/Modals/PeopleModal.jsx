import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field } from '../primitives/primitives.jsx'
import { SECTORS, ROLE_LABEL, effectiveProjectRole } from '../../data/store.js'
// Cadastro/edição de um profissional, com as abas de dados e de acesso.
//
// Este componente veio de 9724d68 (tela de Profissionais). O refactor d14c415
// dividiu o Modals.jsx numa branch paralela e o merge descartou a versão que
// tinha o PeopleModal, deixando o App.jsx importando algo inexistente.
// Restaurado aqui na convenção nova: um arquivo por modal.

export function PeopleModal({ user, currentUserId, projects = [], tasks = [], changes = [], onOpenProject, onSave, onClose }) {
  const editing = !!user
  // Editando a própria conta: travar o próprio "is_admin"/"Inativo" evita se
  // trancar fora do sistema (o backend também recusa, isto é só o aviso na hora).
  const isSelf = editing && user.id === currentUserId
  const [name, setName] = React.useState(user?.name || '')
  const [email, setEmail] = React.useState(user?.email || '')
  const [sector, setSector] = React.useState(user?.sector || '')
  const [jobTitle, setJobTitle] = React.useState(user?.jobTitle || '')
  const [initials, setInitials] = React.useState(user?.initials || '')
  const [color, setColor] = React.useState(user?.color || 'var(--proj-blue)')
  const [isAdmin, setIsAdmin] = React.useState(!!user?.isAdmin)
  const [isActive, setIsActive] = React.useState(user?.isActive !== false)
  const [initialPassword, setInitialPassword] = React.useState('')
  const [revealPassword, setRevealPassword] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [touched, setTouched] = React.useState(false)
  const [tab, setTab] = React.useState('dados')

  const copyPassword = async () => {
    if (!initialPassword) return
    try { await navigator.clipboard.writeText(initialPassword); setCopied(true) }
    catch { /* área de transferência indisponível — usuário copia manualmente */ }
  }

  // Iniciais geradas automaticamente do nome, mas podem ser editadas manualmente.
  const autoInitials = React.useMemo(() => {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  }, [name])

  // Usa as iniciais manuais se existirem, senão as automáticas.
  const displayInitials = initials || autoInitials

  // Cores disponíveis do projeto para o avatar.
  const colorOptions = Object.entries(PROJECT_HEX).map(([id, hex]) => ({ id, hex }))
  const currentColorHex = colorOptions.find(c => c.id === color)?.hex || '#5A7695'

  const nameErr = touched && !name.trim() ? 'Informe o nome.' : null
  const emailErr = touched && !email.trim() ? 'Informe o e-mail.' : null
  const passwordErr = touched && !editing && initialPassword.trim().length < 6
    ? 'A senha inicial precisa ter ao menos 6 caracteres.' : null

  // Projetos em que a pessoa participa e o papel em cada um — só leitura; a
  // permissão em si se edita na ficha do projeto, não se duplica aqui.
  const myProjects = React.useMemo(() => {
    if (!editing) return []
    return projects
      .map(p => ({ project: p, role: effectiveProjectRole(p, user) }))
      .filter(x => x.role === 'full' || x.role === 'view')
  }, [editing, projects, user])
  // Admin vê tudo por definição — a falta de vínculo com projetos não é um
  // problema para ele, só para quem depende de ser adicionado a cada um.
  const semProjeto = editing && !user.isAdmin && isActive && myProjects.length === 0

  // Antes de desativar, mostra o que fica pendente: atividades em aberto sob
  // responsabilidade dela, projetos em que participa e mudanças aguardando
  // ciência dela — desativar não apaga nada disso, só tira das listas de escolha.
  const willDeactivate = editing && user.isActive !== false && !isActive
  const impact = React.useMemo(() => {
    if (!willDeactivate) return null
    return {
      openTasks: tasks.filter(t => t.assigneeId === user.id && t.status !== 'done'),
      inProjects: projects.filter(p => (p.members || []).some(m => m.userId === user.id) || (p.responsibleIds || []).includes(user.id)),
      pendingChanges: changes.filter(c => (c.acks || []).some(a => a.userId === user.id && !a.confirmedAt)),
    }
  }, [willDeactivate, tasks, projects, changes, user])

  const save = () => {
    setTouched(true)
    if (!name.trim() || !email.trim()) return
    if (!editing && initialPassword.trim().length < 6) return
    onSave({
      ...(user || {}),
      name: name.trim(),
      email: email.trim(),
      sector: sector || null,
      jobTitle: jobTitle.trim() || null,
      initials: displayInitials || 'P',
      color: color || 'var(--proj-blue)',
      isAdmin,
      isActive,
      initialPassword: initialPassword || undefined,
    })
  }

  return (
    <Modal className="project-modal" title={editing ? 'Editar profissional' : 'Novo profissional'} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>{editing ? 'Salvar alterações' : 'Criar profissional'}</button>
      </>}>
      {editing && (
        <div className="tabs-strip">
          <button type="button" className={tab === 'dados' ? 'on' : ''} onClick={() => setTab('dados')}>Dados</button>
          <button type="button" className={tab === 'projetos' ? 'on' : ''} onClick={() => setTab('projetos')}>
            Projetos{myProjects.length > 0 ? ` (${myProjects.length})` : ''}
            {semProjeto && <Icon name="flag" size={12} style={{ color: 'var(--danger)', marginLeft: 5 }} />}
          </button>
        </div>
      )}

      {tab === 'projetos' ? (
        <div className="field">
          {user.isAdmin ? (
            <p className="ro-hint" style={{ margin: 0 }}><Icon name="flag" size={14} />Administrador: acesso total a todos os projetos do sistema.</p>
          ) : (
            <>
              {semProjeto && (
                <p className="ro-hint">
                  <Icon name="flag" size={14} />
                  Este profissional está ativo mas não participa de nenhum projeto — ele consegue entrar no sistema, mas não vê nada.
                </p>
              )}
              {myProjects.length > 0 ? (
                <div className="perm-list">
                  {myProjects.map(({ project, role }) => (
                    <button type="button" key={project.id} className="people-project-row"
                      onClick={() => onOpenProject && onOpenProject(project.id)}
                      title="Abrir projeto — a permissão se edita lá">
                      <span className="perm-name">{project.name}</span>
                      <span className="perm-role-static">{ROLE_LABEL[role]}</span>
                      <Icon name="chevronRight" size={16} style={{ color: 'var(--fg-4)' }} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="perm-empty">Não participa de nenhum projeto ainda.</div>
              )}
            </>
          )}
        </div>
      ) : (
      <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{ flex: '0 0 auto' }}>
          <div className="av" style={{
            width: 56,
            height: 56,
            background: currentColorHex,
            fontSize: 20,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            borderRadius: 'var(--r-md)',
          }}>{displayInitials}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Field label="Nome completo">
            <input className="control" value={name} autoFocus placeholder="Ex.: Ana Pereira"
              onChange={e => setName(e.target.value)} />
            {nameErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{nameErr}</span>}
          </Field>
        </div>
      </div>

      <div className="field-row">
        <Field label="Iniciais (editar)">
          <input className="control" value={initials} maxLength={2} placeholder={autoInitials || 'AA'}
            onChange={e => setInitials(e.target.value.toUpperCase())} />
          <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Deixe vazio para usar automaticamente</span>
        </Field>
        <Field label="Cor do avatar">
          <div className="color-swatches" style={{ display: 'flex', gap: 6 }}>
            {colorOptions.map(c => (
              <button key={c.id} type="button"
                className={color === c.id ? 'on' : ''}
                style={{
                  width: 32,
                  height: 32,
                  background: c.hex,
                  border: color === c.id ? '3px solid var(--fg-1)' : '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  cursor: 'pointer',
                }}
                onClick={() => setColor(c.id)}
                title={c.id}
              />
            ))}
          </div>
        </Field>
      </div>

      <div className="field-row">
        <Field label="E-mail">
          <input className="control" type="email" value={email} placeholder="ana@promav.com.br"
            onChange={e => setEmail(e.target.value)} />
          {emailErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{emailErr}</span>}
        </Field>
        <Field label="Cargo">
          <input className="control" value={jobTitle} placeholder="Ex.: Engenheira"
            onChange={e => setJobTitle(e.target.value)} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Setor">
          <select className="control" value={sector} onChange={e => setSector(e.target.value)}>
            <option value="">Selecione</option>
            {SECTORS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Administrador">
          <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42 }}>
            <input type="checkbox" checked={isAdmin} disabled={isSelf} onChange={e => setIsAdmin(e.target.checked)} />
            <span>Marcar como administrador</span>
          </label>
          {isSelf && (
            <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Você não pode remover sua própria permissão de administrador.</span>
          )}
        </Field>
      </div>

      {!editing && (
        <Field label="Senha inicial">
          <div className="password-field">
            <input className="control" type={revealPassword ? 'text' : 'password'} value={initialPassword}
              placeholder="Mínimo de 6 caracteres"
              onChange={e => { setInitialPassword(e.target.value); setCopied(false) }} />
            <button type="button" className="btn-icon" onClick={() => setRevealPassword(v => !v)}
              aria-label={revealPassword ? 'Ocultar senha' : 'Mostrar senha'} title={revealPassword ? 'Ocultar senha' : 'Mostrar senha'}>
              <Icon name={revealPassword ? 'eyeOff' : 'eye'} size={16} />
            </button>
            <button type="button" className="btn-icon" onClick={copyPassword} disabled={!initialPassword}
              aria-label="Copiar senha" title="Copiar senha">
              <Icon name="copy" size={16} />
            </button>
          </div>
          {copied && <span className="password-copied" style={{ marginTop: 6 }}><Icon name="check" size={13} stroke={3} />Senha copiada!</span>}
          {passwordErr && <span className="field-error"><Icon name="x" size={13} stroke={2.5} />{passwordErr}</span>}
        </Field>
      )}

      <div className="field-row">
        <Field label="Situação">
          <div className="seg">
            <button type="button" className={isActive ? 'on' : ''} onClick={() => setIsActive(true)}>Ativo</button>
            <button type="button" className={!isActive ? 'on' : ''} disabled={isSelf} onClick={() => setIsActive(false)}>Inativo</button>
          </div>
          {isSelf && (
            <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Você não pode desativar a própria conta.</span>
          )}
        </Field>
      </div>

      {impact && (impact.openTasks.length > 0 || impact.inProjects.length > 0 || impact.pendingChanges.length > 0) && (
        <p className="ro-hint" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="flag" size={14} />Antes de desativar, veja o que fica pendente — nada será apagado, {name.trim() || 'a pessoa'} só sai das listas de escolha:</span>
          <span style={{ paddingLeft: 22 }}>
            {impact.openTasks.length > 0 && <>• {impact.openTasks.length} atividade{impact.openTasks.length === 1 ? '' : 's'} em aberto sob responsabilidade dela<br /></>}
            {impact.inProjects.length > 0 && <>• Participa de {impact.inProjects.length} projeto{impact.inProjects.length === 1 ? '' : 's'}<br /></>}
            {impact.pendingChanges.length > 0 && <>• {impact.pendingChanges.length} mudança{impact.pendingChanges.length === 1 ? '' : 's'} aguardando ciência dela<br /></>}
          </span>
        </p>
      )}
      </>
      )}
    </Modal>
  )
}
