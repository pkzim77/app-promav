import './TimeTracker.css'
import React from 'react'
import { Icon } from '../Icon.jsx'
import { useFecharFora } from '../primitives/primitives.jsx'
import { PROJECT_COLORS, PROJECT_STATUS_MAP, estadoDoItem } from '../../data/store.js'
// Cronômetro por atividade — cada sessão é vinculada a uma tarefa (taskId).

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}
export function fmtDur(ms) {
  const min = Math.round(ms / 60000)
  if (min < 1) return '0min'
  const h = Math.floor(min / 60), m = min % 60
  if (h && m) return `${h}h ${m}min`
  if (h) return `${h}h`
  return `${m}min`
}
export function sameDay(a, b) { const x = new Date(a), y = new Date(b); return x.toDateString() === y.toDateString() }

// total de tempo (ms) numa atividade, para um usuário (ou todos se userId omitido)
export function taskTimeFor(sessions, taskId, userId, now) {
  return sessions
    .filter(s => s.taskId === taskId && (!userId || s.userId === userId))
    .reduce((sum, s) => sum + ((s.end || now) - s.start), 0)
}
export function activeSessionFor(sessions, userId) {
  return sessions.find(s => s.userId === userId && !s.end) || null
}

// Botão play/parar reutilizável, embutido em cards e linhas de tabela.
export function TaskTimerButton({ task, sessions, currentUserId, now, onStart, onStop }) {
  const active = sessions.find(s => s.taskId === task.id && s.userId === currentUserId && !s.end)
  const total = taskTimeFor(sessions, task.id, currentUserId, now)
  if (active) {
    return (
      <button className="timerbtn running" onClick={(e) => { e.stopPropagation(); onStop() }} title="Parar cronômetro">
        <Icon name="stop" size={13} /><span className="t">{fmtClock(now - active.start)}</span>
      </button>
    )
  }
  return (
    <button className="timerbtn" onClick={(e) => { e.stopPropagation(); onStart(task.id) }} title="Iniciar cronômetro nesta atividade">
      <Icon name="play" size={13} stroke={2.4} />{total > 0 && <span className="t">{fmtDur(total)}</span>}
    </button>
  )
}

// O que a etapa não diz sozinha: de quem é o projeto e como ele está. Onze
// projetos têm uma etapa chamada "2 · Projetos", e na lista do cronômetro elas
// ficavam indistinguíveis.
//
// Vai no title nativo, e não numa ficha desenhada: a lista rola dentro de um
// popover com overflow escondido, e qualquer caixa posicionada aqui seria
// cortada na primeira linha.
function resumoDoProjeto(p) {
  if (!p) return 'Atividade fora de qualquer projeto'
  const partes = [p.name]
  if (p.prefeitura) partes.push(p.prefeitura)
  if (p.secretaria) partes.push(p.secretaria)
  const estado = PROJECT_STATUS_MAP[p.status]?.label
  if (estado) partes.push(estado)
  if (p.end) partes.push('prazo ' + p.end.split('-').reverse().join('/'))
  return partes.join(' · ')
}

export function TimeClock({ currentUser, tasks, projects, sessions, now, onStart, onStop, onOpenTask }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  useFecharFora(ref, () => setOpen(false), open)

  const mine = sessions.filter(s => s.userId === currentUser.id)
  const active = activeSessionFor(sessions, currentUser.id)
  const activeTask = active ? tasks.find(t => t.id === active.taskId) : null
  const projOf = (id) => projects.find(p => p.id === id)
  const todays = mine.filter(s => sameDay(s.start, now))
  const todayTotal = todays.reduce((sum, s) => sum + ((s.end || now) - s.start), 0)

  // tempo de hoje agrupado por atividade
  const byTask = {}
  todays.forEach(s => { byTask[s.taskId] = (byTask[s.taskId] || 0) + ((s.end || now) - s.start) })
  const todayTasks = Object.keys(byTask).map(tid => ({ task: tasks.find(t => t.id === tid), ms: byTask[tid] }))
    .filter(x => x.task).sort((a, b) => b.ms - a.ms)

  // O que entra na lista: etapa com atividade sua ainda por fazer.
  //
  // Antes bastava ser responsável ou participante da etapa, e isso enchia a
  // lista de quem coordena — a conta da coordenação está como responsável de 40
  // etapas abertas, e o cronômetro virava um catálogo do escritório. Cronometrar
  // é sobre o que você vai fazer agora, e isso está na atividade, não no
  // cabeçalho da etapa.
  //
  // Atividade SEM dono, porém, é de quem responde pela etapa: ela existe, está
  // por fazer, e sem esta regra sumiria do cronômetro de todo mundo até alguém
  // distribuí-la. Com dono, vale o dono — mesmo sendo outra pessoa na sua etapa.
  //
  // Atividade concluída não conta de jeito nenhum: não há tempo a marcar nela.
  const myTasks = tasks.filter(t => {
    if (t.status === 'done') return false
    const porFazer = (t.checklist || []).filter(i => estadoDoItem(i) !== 'done')
    return porFazer.some(i => i.assigneeId === currentUser.id)
      || (t.assigneeId === currentUser.id && porFazer.some(i => !i.assigneeId))
  })

  return (
    <div className="userselect" ref={ref}>
      <button className={'ponto-pill' + (active ? ' on' : '')} aria-expanded={open} aria-haspopup="true"
        onClick={() => setOpen(o => !o)} title="Cronômetro por atividade">
        {/* Parado, o rótulo só mostra o total de hoje a partir de um minuto:
            abaixo disso o fmtDur arredonda para "0min", que lê como defeito. */}
        {active
          ? <><span className="ponto-dot" /><span className="ponto-time">{fmtClock(now - active.start)}</span></>
          : <><Icon name="timer" size={17} /><span className="ponto-today">{todayTotal >= 60000 ? fmtDur(todayTotal) : 'Cronômetro'}</span></>}
      </button>
      {open && (
        <div className="menu ponto-pop">
          {active ? (
            <div className="ponto-head running">
              <div style={{ minWidth: 0 }}>
                <div className="ponto-head-label">Cronometrando agora</div>
                <div className="ponto-head-task">
                  <span className="dot" style={{ background: PROJECT_COLORS[projOf(activeTask?.projectId)?.color] || 'var(--fg-4)' }} />
                  {activeTask ? activeTask.title : 'Atividade'}
                </div>
                <div className="ponto-head-time live">{fmtClock(now - active.start)}</div>
              </div>
              <button className="btn btn-danger" onClick={onStop}><Icon name="stop" size={16} />Parar</button>
            </div>
          ) : (
            <div className="ponto-head">
              <div>
                <div className="ponto-head-label">Cronômetro parado</div>
                <div className="ponto-head-time">{fmtDur(todayTotal)}</div>
                <div className="ponto-since">registrado hoje</div>
              </div>
            </div>
          )}

          <div className="menu-label">Iniciar nas minhas atividades</div>
          <div className="ponto-list">
            {myTasks.length === 0 && (
              <div className="ponto-empty">
                Nenhuma atividade sua por fazer. Entram aqui as atividades no seu nome e
                as que ainda não têm dono nas etapas pelas quais você responde.
              </div>
            )}
            {myTasks.map(t => {
              const isActive = active && active.taskId === t.id
              const total = taskTimeFor(sessions, t.id, currentUser.id, now)
              const proj = projOf(t.projectId)
              return (
                <div key={t.id} className={'ponto-task' + (isActive ? ' on' : '')}>
                  {/* A linha abre a etapa; o play fica num botão à parte. São dois
                      gestos diferentes de verdade — um começa a contar tempo, o
                      outro mostra o que há para fazer — e a linha era um <button>
                      com outro dentro, que não é HTML válido. */}
                  <button type="button" className="ponto-task-abrir" title={resumoDoProjeto(proj)}
                    onClick={() => { onOpenTask?.(t); setOpen(false) }}>
                    <span className="dot" style={{ background: PROJECT_COLORS[proj?.color] }} />
                    <span className="ponto-task-txt">
                      <span className="ponto-task-title">{t.title}</span>
                      <span className="ponto-task-proj">{proj?.name || 'Sem projeto'}</span>
                    </span>
                  </button>
                  {total > 0 && <span className="ponto-task-total">{fmtDur(total)}</span>}
                  <button type="button" className={'timerbtn' + (isActive ? ' running' : '')}
                    title={isActive ? 'Parar o cronômetro' : 'Iniciar o cronômetro nesta etapa'}
                    aria-label={(isActive ? 'Parar o cronômetro em ' : 'Iniciar o cronômetro em ') + t.title}
                    onClick={() => isActive ? onStop() : onStart(t.id)}>
                    <Icon name={isActive ? 'stop' : 'play'} size={13} stroke={2.4} />
                  </button>
                </div>
              )
            })}
          </div>

          {todayTasks.length > 0 && (
            <>
              <div className="menu-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="history" size={13} />Tempo de hoje por atividade</div>
              <div className="ponto-list">
                {todayTasks.map(({ task, ms }) => (
                  <div className="ponto-row" key={task.id}>
                    <span className="ponto-rowdot" style={{ background: PROJECT_COLORS[projOf(task.projectId)?.color] }} />
                    <span className="ponto-row-title">{task.title}</span>
                    <span className="ponto-dur">{fmtDur(ms)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
