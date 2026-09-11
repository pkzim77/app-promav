import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { PROJECT_COLORS, fmtMed, canPublishProjectChange, partesDoProjeto, dataDoCodigo } from '../../../data/store.js'
import { ProjectCover } from './ProjectCover.jsx'
import { ProjectTechSheet } from './ProjectTechSheet.jsx'
import { ProjectStages } from './ProjectStages.jsx'
import { ProjectChanges } from './ProjectChanges.jsx'

export function ProjectDetail({ project, tasks, users, sessions, changes = [], currentUserId, now, canEdit = true, role, initialTab, focusId, focusNonce, onToggleChecklist, onAssignChecklist, onMoveTask, onNewStageItem, onCreateStages, onStartTimer, onStopTimer, onBack, onEdit, onNewTask, onEditTask, onDeleteTask, onCopyResource, onDeleteResource, onAddResource, onNewChange, onEditChange, onAckChange, onDecideChange }) {
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
  const partes = partesDoProjeto(project.name)
  return (
    <div className="page">
      {/* Cabeçalho compacto: antes eram ~500px de moldura (voltar, quadrado de
          46px, título em duas linhas, descrição, datas) antes de a lista
          aparecer — mais da metade da tela num notebook. Agora o "voltar" fica
          na mesma linha do título, e código, tipo, datas e complemento dividem
          uma faixa só embaixo. */}
      <div className="proj-head">
        <button className="btn btn-ghost btn-sm proj-head-voltar" onClick={onBack} aria-label="Voltar aos projetos">
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className="proj-head-cor" style={{ background: color }} />
        <div className="proj-head-nome">
          <h1>{partes.titulo}</h1>
          {project.desc && <p className="proj-head-desc">{project.desc}</p>}
        </div>
        {canEdit && (
          <button className="btn btn-secondary btn-sm proj-head-editar" onClick={() => onEdit(project)}>
            <Icon name="pencil" size={15} />Editar
          </button>
        )}
      </div>

      {/* O nome do projeto é um código de até 62 caracteres. Como <h1> cru ele
          quebrava em duas linhas; aqui as partes viram etiquetas e o título
          fica com o que a pessoa procura. Quem não segue o padrão (12 dos 36)
          aparece inteiro no título, sem etiqueta nenhuma. */}
      <div className="proj-head-meta">
        {partes.codigo && (
          <span className="proj-head-cod" title={`Código do projeto · ${dataDoCodigo(partes.codigo)}`}>{partes.codigo}</span>
        )}
        {partes.tipo && <span className="proj-head-tipo">{partes.tipo}</span>}
        {partes.complemento && <span className="proj-head-compl">{partes.complemento}</span>}
        <span className="proj-head-datas">
          <Icon name="calendar" size={14} />{fmtMed(project.start)} — {fmtMed(project.end)}
        </span>
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
          onToggleChecklist={onToggleChecklist} onAssignChecklist={onAssignChecklist} onMoveTask={onMoveTask}
          onNewStageItem={onNewStageItem} onCreateStages={onCreateStages} onNewTask={onNewTask} onEditTask={onEditTask}
          onDeleteTask={onDeleteTask} onStartTimer={onStartTimer} onStopTimer={onStopTimer} />
      )}
    </div>
  )
}
