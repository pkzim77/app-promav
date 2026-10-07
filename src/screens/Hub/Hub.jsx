import './Hub.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { ProgressBar } from '../../components/primitives/primitives.jsx'
import { sameDay, fmtDur } from '../../components/TimeTracker/TimeTracker.jsx'
import { PROJECT_COLORS, SEM_ATIVIDADES, projectProgress, tasksByProject, taskMembers, todayISO, dayDiff } from '../../data/store.js'
// Hub / Visão geral — o que precisa de você, atalhos e os seus projetos.

function StatCard({ num, label }) {
  return (
    <div className="stat-card">
      <div className="stat-num">{num}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

// Os quatro atalhos ficavam em cartões grandes, com ícone e frase explicativa,
// ocupando a primeira dobra inteira para repetir o que a barra lateral já
// oferece. Compactados, sobra espaço para conteúdo que só existe aqui.
function HubNav({ icon, title, onClick }) {
  return (
    <button className="hubnav" onClick={onClick}>
      <Icon name={icon} size={18} stroke={2} />
      {title}
    </button>
  )
}

// O que espera por você. Sai da tela inteira quando não há nada — um painel
// vazio dizendo "nada pendente" ocupa a melhor área para não informar nada.
function PrecisaDeVoce({ atrasadas, ciencias, relatorio, projetoDe, onNavigate }) {
  // A lista cresce aqui dentro em vez de mandar para a Lista: lá não há
  // recorte de atraso, e "minhas" é estado global que grudaria no Kanban.
  const [todas, setTodas] = React.useState(false)
  const hoje = todayISO()
  if (!atrasadas.length && !ciencias.length && !relatorio) return null

  return (
    <section className="card pend">
      <h2 className="pend-titulo"><Icon name="flag" size={16} stroke={2.2} />Precisa de você</h2>

      {!!atrasadas.length && (
        <div className="pend-bloco">
          <div className="pend-cab">
            <b>{atrasadas.length}</b> atividade{atrasadas.length === 1 ? '' : 's'} atrasada{atrasadas.length === 1 ? '' : 's'}
          </div>
          <ul className="pend-lista">
            {atrasadas.slice(0, todas ? atrasadas.length : 5).map(t => {
              const dias = dayDiff(t.end, hoje) ?? 0
              return (
                <li key={t.id}>
                  <button className="pend-item"
                    onClick={() => onNavigate({ view: 'projects', projectId: t.projectId, tab: 'etapas', focusId: `task-${t.id}` })}>
                    <span className="pend-item-tit">{t.title}</span>
                    <span className="pend-item-proj">{projetoDe(t.projectId)?.name || 'Projeto removido'}</span>
                    <span className="pend-atraso">{dias} dia{dias === 1 ? '' : 's'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {atrasadas.length > 5 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setTodas(v => !v)}>
              {todas ? 'Mostrar menos' : `Ver as ${atrasadas.length - 5} restantes`}
            </button>
          )}
        </div>
      )}

      {!!ciencias.length && (
        <div className="pend-bloco">
          <div className="pend-cab">
            <b>{ciencias.length}</b> mudança{ciencias.length === 1 ? '' : 's'} esperando sua ciência
          </div>
          <ul className="pend-lista">
            {ciencias.slice(0, 3).map(c => (
              <li key={c.id}>
                <button className="pend-item"
                  onClick={() => onNavigate({ view: 'projects', projectId: c.projectId, tab: 'mudancas', focusId: `change-${c.id}` })}>
                  <span className="pend-item-tit">{c.title}</span>
                  <span className="pend-item-proj">{projetoDe(c.projectId)?.name || 'Projeto removido'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {relatorio && (
        <div className="pend-bloco">
          <button className="pend-item pend-item-solo" onClick={() => onNavigate({ view: 'myreport' })}>
            {/* Rascunho salvo não é relatório entregue: o aviso continua, mas diz
                o que realmente falta em vez de acusar a pessoa de não ter feito. */}
            <span className="pend-item-tit">
              {relatorio === 'rascunho'
                ? 'Seu relatório desta semana está salvo como rascunho — falta enviar'
                : 'Seu relatório desta semana ainda não foi enviado'}
            </span>
            <Icon name="arrowRight" size={15} />
          </button>
        </div>
      )}
    </section>
  )
}

export function Hub({ projects, tasks, changes = [],
                      onNavigate, sessions, currentUserId, authUser, relatorioSemana = 'enviado', now }) {
  // Agrupa uma vez; os cards abaixo pegam as suas por id em vez de cada um
  // varrer a lista inteira duas vezes.
  const porProjeto = React.useMemo(() => tasksByProject(tasks), [tasks])
  const projetoDe = React.useCallback((id) => projects.find(p => p.id === id), [projects])

  // "Meus projetos" pelo trabalho, não pela data de criação.
  //
  // Ordenar por criação era o problema real: quem está em 26 projetos via os 10
  // mais NOVOS, que não são onde ele está trabalhando. E filtrar só por equipe
  // teria quebrado para administrador — ele enxerga os 37 e é membro de 1.
  //
  // Aqui entra quem tem vínculo de qualquer natureza (equipe, responsabilidade
  // ou atividade sua), e quem tem trabalho em aberto vem primeiro.
  const meusProjetos = React.useMemo(() => {
    const comPeso = projects.map(p => {
      const minhas = (porProjeto.get(p.id) || SEM_ATIVIDADES).filter(t => taskMembers(t).includes(currentUserId))
      return {
        p,
        abertas: minhas.filter(t => t.status !== 'done').length,
        minhas: minhas.length,
        resp: (p.responsibleIds || []).includes(currentUserId),
        membro: (p.members || []).some(m => m.userId === currentUserId),
        mexido: minhas.reduce((max, t) => Math.max(max, t.updatedAt || 0), 0),
      }
    })
    return comPeso
      .filter(x => x.abertas || x.minhas || x.resp || x.membro)
      .sort((a, b) => b.abertas - a.abertas || b.minhas - a.minhas
        || (b.resp - a.resp) || b.mexido - a.mexido
        || a.p.name.localeCompare(b.p.name, 'pt-BR'))
      .slice(0, 8)
      .map(x => x.p)
  }, [projects, porProjeto, currentUserId])

  const hoje = todayISO()
  const minhasAtrasadas = React.useMemo(() => tasks
    .filter(t => t.status !== 'done' && t.end && t.end < hoje && taskMembers(t).includes(currentUserId))
    .sort((a, b) => a.end.localeCompare(b.end)), [tasks, currentUserId, hoje])

  const ciencias = React.useMemo(() => changes
    .filter(c => (c.acks || []).some(a => a.userId === currentUserId && !a.confirmedAt)), [changes, currentUserId])

  // Administrador não tem a aba "Meu relatório" — cobrá-lo dela seria mandá-lo
  // a uma tela que a barra lateral não oferece.
  const avisoRelatorio = !authUser?.isAdmin && relatorioSemana !== 'enviado' ? relatorioSemana : null

  const inProgress = tasks.filter(t => t.status === 'progress').length
  const done = tasks.filter(t => t.status === 'done').length
  const todayMs = (sessions || []).filter(s => s.userId === currentUserId && sameDay(s.start, now))
    .reduce((sum, s) => sum + ((s.end || now) - s.start), 0)

  const atalhos = [
    { icon: 'folder', title: 'Projetos', view: 'projects' },
    { icon: 'kanban', title: 'Kanban', view: 'kanban' },
    { icon: 'gantt', title: 'Gantt', view: 'gantt' },
    { icon: 'list', title: 'Lista', view: 'list' },
  ]

  const primeiroNome = (authUser?.name || '').split(' ')[0]

  return (
    <div className="page">
      <p className="eyebrow">Bem-vindo de volta</p>
      <h1 className="hub-titulo">{primeiroNome ? `Olá, ${primeiroNome}` : 'Sua semana na Promav'}</h1>

      <div className="hub-stats">
        <StatCard num={projects.filter(p => p.status !== 'concluido').length} label="Projetos ativos" />
        <StatCard num={inProgress} label="Atividades em andamento" />
        <StatCard num={done} label="Atividades concluídas" />
        <StatCard num={fmtDur(todayMs)} label="Tempo registrado hoje" />
      </div>

      <PrecisaDeVoce atrasadas={minhasAtrasadas} ciencias={ciencias}
        relatorio={avisoRelatorio} projetoDe={projetoDe} onNavigate={onNavigate} />

      <div className="hubnavs">
        {atalhos.map(a => (
          <HubNav key={a.title} icon={a.icon} title={a.title} onClick={() => onNavigate({ view: a.view })} />
        ))}
      </div>

      <div className="sec-head">
        <div><h2 className="hub-sec">Meus projetos</h2></div>
        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate({ view: 'projects' })}>
          Ver todos<Icon name="arrowRight" size={15} />
        </button>
      </div>

      {meusProjetos.length ? (
        <div className="hub-projs">
          {meusProjetos.map(p => {
            const doProjeto = porProjeto.get(p.id) || SEM_ATIVIDADES
            const pct = projectProgress(doProjeto)
            const minhasAqui = doProjeto.filter(t => t.status !== 'done' && taskMembers(t).includes(currentUserId)).length
            return (
              <button key={p.id} className="card hub-proj" onClick={() => onNavigate({ view: 'projects', projectId: p.id })}>
                <div className="hub-proj-topo">
                  <span className="hub-proj-cor" style={{ background: PROJECT_COLORS[p.color] }} />
                  <div className="hub-proj-id">
                    <div className="hub-proj-nome" title={p.name}>{p.name}</div>
                    <div className="hub-proj-sub">
                      {doProjeto.length} atividade{doProjeto.length === 1 ? '' : 's'}
                      {/* O que interessa ao dono da tela não é o total do projeto,
                          é quanto dele está na mão dele. */}
                      {!!minhasAqui && <span className="hub-proj-minhas">{minhasAqui} sua{minhasAqui === 1 ? '' : 's'} em aberto</span>}
                    </div>
                  </div>
                  <span className="hub-proj-pct">{pct}%</span>
                </div>
                <ProgressBar value={pct} color={PROJECT_COLORS[p.color]} />
              </button>
            )
          })}
        </div>
      ) : (
        <div className="card hub-vazio">
          Você ainda não está em nenhum projeto. Fale com a coordenação para ser incluído na equipe de um.
        </div>
      )}
    </div>
  )
}
