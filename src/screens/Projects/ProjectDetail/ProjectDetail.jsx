import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { PROJECT_COLORS, fmtMed, fmtPeriodo, canPublishProjectChange, partesDoProjeto, dataDoCodigo, todayISO } from '../../../data/store.js'
import { ProjectCover } from './ProjectCover.jsx'
import { ProjectTechSheet } from './ProjectTechSheet.jsx'
import { ProjectStages } from './ProjectStages.jsx'
import { ProjectChanges } from './ProjectChanges.jsx'

export function ProjectDetail({ project, tasks, users, sessions, changes = [], currentUserId, now, canEdit = true, role, initialTab, focusId, focusNonce, navNonce, onAssignChecklist, onSetChecklistState, onEditChecklistItem, onExcluirChecklistItem, onDeleteStages, onMoveTask, onNewStageItem, onNewStage, onCreateStages, onStartTimer, onStopTimer, onBack, onEdit, renderVisao, onEditTask, onDeleteTask, onCopyResource, onDeleteResource, onAddResource, onNewChange, onEditChange, onAckChange, onDecideChange }) {
  // O Panorama abre primeiro: é o que se mostra numa reunião com o cliente.
  // Uma notificação clicada entra com a aba já escolhida em 'initialTab'.
  const [visao, setVisao] = React.useState('projeto') // 'projeto' | 'kanban' | 'list' | 'gantt'
  React.useEffect(() => { setVisao('projeto') }, [project.id])
  const [tab, setTab] = React.useState(initialTab || 'panorama') // 'panorama' | 'etapas' | 'arquivos' | 'mudancas'

  // Cada navegação até aqui reabre a aba que a rota pediu (notificação, pendência
  // do Hub) e o Panorama quando ela não pediu nenhuma — é o que faz a barra
  // lateral, a busca e a lista de projetos caírem sempre na tela do projeto.
  // 'focusNonce' e 'navNonce' entram nas dependências para valer também quando o
  // destino é o mesmo de antes e o usuário já havia trocado de aba na mão.
  React.useEffect(() => {
    setTab(initialTab || 'panorama')
  }, [project.id, initialTab, focusNonce, navNonce])

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

  // Memoizado porque este componente re-renderiza a cada segundo (`now` do
  // cronômetro) e a conta varre todas as mudanças, com os acks de cada uma.
  const cienciasPendentes = React.useMemo(
    () => changes.filter(c => c.projectId === project.id && (c.acks || []).some(a => a.userId === currentUserId && !a.confirmedAt)).length,
    [changes, project.id, currentUserId])
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
        {renderVisao && (
          <div className="proj-visoes" role="group" aria-label="Visualização do projeto">
            {[['projeto', 'landmark', 'Projeto'], ['kanban', 'inbox', 'Kanban'], ['list', 'list', 'Lista'], ['gantt', 'calendar', 'Gantt']].map(([id, icone, rotulo]) => (
              <button key={id} className={'proj-visao' + (visao === id ? ' on' : '')} aria-pressed={visao === id} onClick={() => setVisao(id)}>
                <Icon name={icone} size={15} />{rotulo}
              </button>
            ))}
          </div>
        )}
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
          <Icon name="calendar" size={14} />
          {project.start || project.end
            ? fmtPeriodo(project.start, project.end, fmtMed, ' — ')
            : 'Sem prazo definido'}
        </span>
      </div>

      {/* Abas: Panorama (cliente) → Etapas (equipe) → Arquivos → Mudanças.
          "Ficha técnica" e "Atividades" saíram: a primeira só tinha um aviso de
          campos não definidos mais os arquivos (que viraram aba própria), e a
          segunda era a mesma tabela de tasks que Etapas agora lê como etapas. */}
      {visao !== 'projeto' ? renderVisao(visao) : <>
      <div className="proj-tabs">
        {[['panorama', 'landmark', 'Panorama'], ['etapas', 'list', 'Etapas'], ['arquivos', 'file', 'Arquivos'], ['mudancas', 'history', 'Mudanças']].map(([id, icone, rotulo]) => (
          <button key={id} type="button" className={'proj-tab' + (tab === id ? ' on' : '')} aria-pressed={tab === id} onClick={() => setTab(id)}>
            <Icon name={icone} size={15} />{rotulo}
            {id === 'mudancas' && cienciasPendentes > 0 && <span className="proj-tab-dot" />}
          </button>
        ))}
      </div>

      {/* A key do ProjectStages remonta ao trocar de projeto: sem ela, o
          conjunto de etapas abertas (guardado por NÚMERO) vazaria de um
          projeto para o outro. O focusNonce entra na key para remontar a cada
          clique em notificação: a etapa da task já nasce aberta no mesmo
          commit em que o efeito lá em cima procura o elemento. O preço é o
          filtro e a seleção zerarem nesse clique — aceitável numa navegação. */}
      {tab === 'panorama' ? (
        <ProjectCover project={project} tasks={tasks} users={users} hoje={todayISO()} />
      )  : tab === 'arquivos' ? (
        <ProjectTechSheet project={project} canEdit={canEdit}
          onCopyResource={onCopyResource} onDeleteResource={onDeleteResource} onAddResource={onAddResource}
          onEditSegments={() => onEdit(project, 'tipo')} />
      ) : tab === 'mudancas' ? (
        <ProjectChanges project={project} changes={changes} tasks={tasks} users={users}
          currentUserId={currentUserId} canEdit={canEdit} canPublish={canPublish} onNew={onNewChange} onEdit={onEditChange}
          onAck={onAckChange} onDecide={onDecideChange} onOpenTask={onEditTask} />
      ) : (
        <ProjectStages key={project.id + ':' + (focusNonce || 0)} focusId={focusId} project={project} tasks={tasks} users={users} sessions={sessions}
          currentUserId={currentUserId} now={now} canEdit={canEdit} isAdmin={role === 'admin'}
          onAssignChecklist={onAssignChecklist} onMoveTask={onMoveTask}
          onSetChecklistState={onSetChecklistState} onEditChecklistItem={onEditChecklistItem}
          onExcluirChecklistItem={onExcluirChecklistItem} onDeleteStages={onDeleteStages} onNewStage={onNewStage}
          onNewStageItem={onNewStageItem} onCreateStages={onCreateStages} onEditTask={onEditTask}
          onDeleteTask={onDeleteTask} onStartTimer={onStartTimer} onStopTimer={onStopTimer} />
      )}
      </>}
    </div>
  )
}
