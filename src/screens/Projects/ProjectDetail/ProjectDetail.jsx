import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { PROJECT_COLORS, fmtMed, canPublishProjectChange } from '../../../data/store.js'
import { ProjectCover } from './ProjectCover.jsx'
import { ProjectTechSheet } from './ProjectTechSheet.jsx'
import { ProjectStages } from './ProjectStages.jsx'
import { ProjectChanges } from './ProjectChanges.jsx'

export function ProjectDetail({ project, tasks, users, sessions, changes = [], currentUserId, now, canEdit = true, role, initialTab, focusId, focusNonce, onToggleChecklist, onAssignChecklist, onStartTimer, onStopTimer, onBack, onEdit, onNewTask, onEditTask, onDeleteTask, onCopyResource, onDeleteResource, onAddResource, onNewChange, onEditChange, onAckChange, onDecideChange }) {
  // O Panorama abre primeiro: é o que se mostra numa reunião com o cliente.
  // Uma notificação clicada entra com a aba já escolhida em 'initialTab'.
  const [tab, setTab] = React.useState(initialTab || 'panorama') // 'panorama' | 'etapas' | 'arquivos' | 'mudancas'

  // Vindo de uma notificação: troca a aba. O 'focusNonce' entra nas dependências
  // para funcionar também quando a mesma notificação é clicada de novo depois
  // de o usuário ter mudado de aba na mão.
  React.useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab, focusNonce])

  // Rola até o item da notificação e o destaca por alguns segundos. Depende de
  // 'tab' porque o elemento só existe depois que a aba certa renderiza.
  React.useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(focusId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('is-focused')
    const t = setTimeout(() => el.classList.remove('is-focused'), 2800)
    return () => { clearTimeout(t); el.classList.remove('is-focused') }
  }, [focusId, focusNonce, tab])

  const cienciasPendentes = changes
    .filter(c => c.projectId === project.id)
    .reduce((total, c) => total + (c.acks || []).some(a => a.userId === currentUserId && !a.confirmedAt), 0)
  const color = PROJECT_COLORS[project.color]
  const canPublish = canPublishProjectChange(role)
  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 16, marginLeft: -8 }}>
        <Icon name="chevronLeft" size={16} />Projetos
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
        <span style={{ width: 46, height: 46, borderRadius: 'var(--r-lg)', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ font: 'var(--text-h1)', margin: 0, letterSpacing: 'var(--tracking-tight)', overflowWrap: 'anywhere' }}>{project.name}</h1>
          <p style={{ fontSize: 14, color: 'var(--fg-3)', margin: '5px 0 0' }}>{project.desc}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-3)', marginTop: 10 }}>
            <Icon name="calendar" size={15} />{fmtMed(project.start)} — {fmtMed(project.end)}
          </div>
        </div>
        {canEdit && <button className="btn btn-secondary" onClick={() => onEdit(project)}><Icon name="pencil" size={16} />Editar</button>}
        {canEdit && <button className="btn btn-primary" onClick={() => onNewTask(project.id)}><Icon name="plus" size={17} stroke={2.2} />Nova atividade</button>}
      </div>

      {/* Abas: Panorama (cliente) → Etapas (equipe) → Arquivos → Mudanças.
          "Ficha técnica" e "Atividades" saíram: a primeira só tinha um aviso de
          campos não definidos mais os arquivos (que viraram aba própria), e a
          segunda era a mesma tabela de tasks que Etapas agora lê como etapas. */}
      <div className="proj-tabs">
        <button className={'proj-tab' + (tab === 'panorama' ? ' on' : '')} onClick={() => setTab('panorama')}>
          <Icon name="landmark" size={15} />Panorama
        </button>
        <button className={'proj-tab' + (tab === 'etapas' ? ' on' : '')} onClick={() => setTab('etapas')}>
          <Icon name="list" size={15} />Etapas
        </button>
        <button className={'proj-tab' + (tab === 'arquivos' ? ' on' : '')} onClick={() => setTab('arquivos')}>
          <Icon name="file" size={15} />Arquivos
        </button>
        <button className={'proj-tab' + (tab === 'mudancas' ? ' on' : '')} onClick={() => setTab('mudancas')}>
          <Icon name="history" size={15} />Mudanças{cienciasPendentes > 0 && <span className="proj-tab-dot" />}
        </button>
      </div>

      {/* A key do ProjectStages remonta ao trocar de projeto: sem ela, o
          conjunto de etapas abertas (guardado por NÚMERO) vazaria de um
          projeto para o outro. */}
      {tab === 'panorama' ? (
        <ProjectCover project={project} tasks={tasks} users={users} />
      ) : tab === 'arquivos' ? (
        <ProjectTechSheet project={project} canEdit={canEdit}
          onCopyResource={onCopyResource} onDeleteResource={onDeleteResource} onAddResource={onAddResource} />
      ) : tab === 'mudancas' ? (
        <ProjectChanges project={project} changes={changes} tasks={tasks} users={users}
          currentUserId={currentUserId} canEdit={canEdit} canPublish={canPublish} onNew={onNewChange} onEdit={onEditChange}
          onAck={onAckChange} onDecide={onDecideChange} onOpenTask={onEditTask} />
      ) : (
        <ProjectStages key={project.id} project={project} tasks={tasks} users={users} sessions={sessions}
          currentUserId={currentUserId} now={now} canEdit={canEdit}
          onToggleChecklist={onToggleChecklist} onAssignChecklist={onAssignChecklist} onNewTask={onNewTask} onEditTask={onEditTask}
          onDeleteTask={onDeleteTask} onStartTimer={onStartTimer} onStopTimer={onStopTimer} />
      )}
    </div>
  )
}
