import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { RESOURCE_ORIGIN_MAP, PROJECT_STATUS_MAP, dayDiff, parseDate, todayISO, formatBRL, calcularProgresso, fmtFull } from '../../../data/store.js'
import { NotesText } from '../shared/NotesText.jsx'

// Percentual em pt-BR: vírgula decimal e sem o ",0" quando é inteiro.
const pctBR = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

// Fatia de pizza como path SVG. `from`/`to` vão de 0 a 1, começando às 12h.
function pieSlice(cx, cy, r, from, to) {
  if (to - from >= 1) {
    // Círculo inteiro: dois arcos, porque um arco de 360° é degenerado em SVG.
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
  }
  const a0 = from * 2 * Math.PI - Math.PI / 2
  const a1 = to * 2 * Math.PI - Math.PI / 2
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
  const large = to - from > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
}

// Pizza das atividades por situação.
//  • o tamanho da fatia = fatia do projeto que aquele grupo representa (regra de 3);
//  • o número dentro da fatia = essa mesma porcentagem;
//  • ao passar o mouse, a fatia se destaca para fora.
// O texto é tinta escura (contraste ≥ 4.5:1 sobre as três cores de status).
function StatusPie({ slices, size = 180, hovered, onHover }) {
  const total = slices.reduce((s, x) => s + x.share, 0)
  const cx = size / 2, cy = size / 2
  const r = size / 2 - 10 // folga para a fatia elevada não ser cortada

  let acc = 0
  const parts = slices.filter(s => s.share > 0).map(s => {
    const from = acc / total
    acc += s.share
    const to = acc / total
    const a = ((from + to) / 2) * 2 * Math.PI - Math.PI / 2
    return {
      ...s, from, to,
      dx: Math.cos(a) * 7, dy: Math.sin(a) * 7,                 // deslocamento no hover
      lx: cx + Math.cos(a) * r * 0.62, ly: cy + Math.sin(a) * r * 0.62, // posição do número
    }
  })

  return (
    <svg className="cover-pie" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      role="img" onMouseLeave={() => onHover(null)}
      aria-label={total > 0
        ? `Progresso do projeto: ${slices.filter(s => s.share > 0).map(s => `${s.label} ${pctBR(s.share)}`).join(', ')}`
        : 'Nenhuma atividade cadastrada'}>
      {!(total > 0) && <circle cx={cx} cy={cy} r={r} fill="var(--bg-muted)" />}
      {parts.map(s => {
        const on = hovered === s.id
        return (
          <g key={s.id} className={'pie-slice' + (on ? ' on' : '')}
            style={{ transform: on ? `translate(${s.dx}px, ${s.dy}px)` : 'none' }}
            onMouseEnter={() => onHover(s.id)}>
            <path d={pieSlice(cx, cy, r, s.from, s.to)} fill={s.color}
              stroke="var(--surface)" strokeWidth="2" />
            {s.share >= 8 && (
              <text className="pie-label" x={s.lx} y={s.ly} fill={s.ink}
                textAnchor="middle" dominantBaseline="central">
                {pctBR(s.share)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// Soma meses a uma data limitando ao último dia do mês de destino: sem isso,
// 31/01 + 1 mês viraria 03/03 (o Date estoura fevereiro) e a conta se perde.
function addMeses(d, n) {
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), ultimoDia))
}

// Diferença de calendário entre duas datas, em anos/meses/dias reais — não em
// médias de 30 dias, que erram meses cheios e soam falsas num cronograma.
// Conta os meses inteiros que cabem no intervalo e mede o resto em dias.
function diffCalendario(deISO, ateISO) {
  const a = parseDate(deISO), b = parseDate(ateISO)
  if (b <= a) return { anos: 0, meses: 0, dias: 0 }
  let meses = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (addMeses(a, meses) > b) meses-- // passou do destino: recua um mês
  const base = addMeses(a, meses)
  const dias = Math.round((b - base) / 86400000)
  return { anos: Math.floor(meses / 12), meses: meses % 12, dias }
}

// "3 meses e 6 dias", "1 ano e 2 meses", "15 dias". Usa no máximo duas unidades:
// com anos na frente, os dias viram ruído.
function prazoPorExtenso(deISO, ateISO) {
  const { anos, meses, dias } = diffCalendario(deISO, ateISO)
  const un = (n, sing, plur) => `${n} ${n === 1 ? sing : plur}`
  const partes = []
  if (anos > 0) {
    partes.push(un(anos, 'ano', 'anos'))
    if (meses > 0) partes.push(un(meses, 'mês', 'meses'))
  } else if (meses > 0) {
    partes.push(un(meses, 'mês', 'meses'))
    if (dias > 0) partes.push(un(dias, 'dia', 'dias'))
  } else if (dias > 0) {
    partes.push(un(dias, 'dia', 'dias'))
  }
  if (!partes.length) return null // mesma data
  // "Falta 1 dia" / "Faltam 3 meses e 6 dias" — evita concordar "restante(s)".
  const singular = partes.length === 1 && /^1 /.test(partes[0])
  return { texto: partes.join(' e '), singular }
}

// Cronograma: quanto do prazo já passou contra quanto do projeto foi executado.
// É a leitura que importa numa reunião — 60% executado com 80% do prazo
// consumido é atraso, mesmo o número de progresso parecendo bom sozinho.
function Cronograma({ start, end, executado }) {
  if (!start || !end) return null
  const hoje = todayISO()
  const totalDias = dayDiff(start, end)
  if (totalDias <= 0) return null

  const decorridos = Math.min(Math.max(dayDiff(start, hoje), 0), totalDias)
  const prazoPct = Math.round((decorridos / totalDias) * 100)
  const restam = totalDias - decorridos
  const folga = Math.round(executado - prazoPct) // positivo = adiantado

  // Antes do início e depois do fim o comparativo não faz sentido.
  const naoComecou = parseDate(hoje) < parseDate(start)
  const terminou = parseDate(hoje) > parseDate(end)

  const situacao =
    naoComecou ? { label: 'Ainda não iniciado', cor: 'var(--fg-3)', fundo: 'var(--bg-muted)' }
    : folga >= 0 ? { label: 'Dentro do prazo', cor: 'var(--success)', fundo: 'var(--success-soft)' }
    : folga >= -10 ? { label: 'Atenção ao prazo', cor: '#A8680A', fundo: '#FDF2E2' }
    : { label: 'Atrasado', cor: 'var(--danger)', fundo: 'var(--danger-soft, #FDECEC)' }

  return (
    <div className="card crono">
      <div className="crono-head">
        <span className="cover-eyebrow" style={{ margin: 0 }}>Cronograma</span>
        <span className="crono-tag" style={{ color: situacao.cor, background: situacao.fundo }}>
          {situacao.label}
        </span>
      </div>

      {/* Só o prazo. O selo acima continua comparando com o percentual
          executado — a execução em si já é o número grande do topo. */}
      <div className="crono-bars">
        <div className="crono-row">
          <span className="crono-lab">Prazo decorrido</span>
          <div className="crono-track">
            <span className="crono-fill prazo" style={{ width: `${prazoPct}%` }} />
          </div>
          <span className="crono-val">{prazoPct}%</span>
        </div>
      </div>

      <div className="crono-foot">
        <span><Icon name="calendar" size={14} />{fmtFull(start)}</span>
        {/* Prazo por extenso; o número exato de dias fica no title, para quem
            precisar da precisão sem poluir a leitura. */}
        <span className="crono-foot-mid" title={`${restam} ${restam === 1 ? 'dia' : 'dias'}`}>
          {(() => {
            if (naoComecou) {
              const p = prazoPorExtenso(hoje, start)
              return p ? `Começa em ${p.texto}` : 'Começa hoje'
            }
            if (terminou) {
              const p = prazoPorExtenso(end, hoje)
              return p ? `Prazo encerrado há ${p.texto}` : 'Prazo encerrado hoje'
            }
            const p = prazoPorExtenso(hoje, end)
            if (!p) return 'Último dia do prazo'
            return `${p.singular ? 'Falta' : 'Faltam'} ${p.texto}`
          })()}
        </span>
        <span>{fmtFull(end)}<Icon name="flag" size={14} /></span>
      </div>
    </div>
  )
}

// Panorama — primeira aba, pensada para ser projetada numa reunião:
// progresso do projeto em destaque + a ficha do cadastro em blocos legíveis.
export function ProjectCover({ project, tasks, users }) {
  const list = tasks.filter(t => t.projectId === project.id)
  const origem = RESOURCE_ORIGIN_MAP[project.origemRecurso]
  const st = PROJECT_STATUS_MAP[project.status] || PROJECT_STATUS_MAP.planejamento
  const responsibles = (project.responsibleIds || []).map(id => users.find(u => u.id === id)).filter(Boolean)
  const dash = (v) => (v && String(v).trim() ? v : '—')
  const [hovered, setHovered] = React.useState(null)

  // src/data/progresso.js: toda atividade pesa igual (100/N) e a fatia vem do
  // status — checklist 100% marcado promove para Concluído. O percentual grande
  // é o `executado`, que conta só a parte do checklist já marcada nas demais.
  // Recalcula sozinho a cada marcação, porque `tasks` vem do estado do App.
  const prog = calcularProgresso(list)
  const pct = Math.round(prog.executado)
  // `ink` é a cor do número dentro da fatia. Nenhuma tinta única passa em
  // contraste sobre as três cores da marca, então cada fatia leva a que a atende:
  // cinza 6,66:1 no branco · dourado 6,57:1 no preto · verde 5,03:1 no branco.
  const breakdown = [
    { id: 'aFazer', label: 'A fazer', color: 'var(--chart-todo)', ink: '#fff', share: prog.aFazer,
      hint: 'das atividades ainda não iniciadas' },
    { id: 'emAndamento', label: 'Em andamento', color: 'var(--chart-doing)', ink: '#000', share: prog.emAndamento,
      hint: 'das atividades em execução — a barra grande conta só o que já foi marcado nelas' },
    { id: 'concluido', label: 'Concluído', color: 'var(--chart-done)', ink: '#fff', share: prog.concluido,
      hint: 'das atividades finalizadas — status Concluído ou checklist inteiro marcado' },
  ]
  const detail = breakdown.find(s => s.id === hovered) || null
  const dias = project.start && project.end ? dayDiff(project.start, project.end) : null

  return (
    <div className="proj-cover">
      {/* ---- Faixa de destaque: progresso + valor + status ---- */}
      <div className="card cover-hero">
        <StatusPie slices={breakdown} hovered={hovered} onHover={setHovered} />

        <div className="cover-hero-main">
          <span className="cover-eyebrow">Progresso do projeto</span>
          <span className="cover-pct">{pct}<i>%</i></span>
          <span className="cover-pct-sub">executado</span>
          {/* A legenda nomeia as fatias e abre a conta: quanto do projeto cada
              situação ocupa, quanto dela já foi executado e o que isso soma. */}
          <div className="cover-breakdown">
            {breakdown.map(s => (
              <div key={s.id}
                className={'cover-bd-item' + (hovered === s.id ? ' on' : '') + (s.share ? '' : ' off')}
                onMouseEnter={() => setHovered(s.share ? s.id : null)}
                onMouseLeave={() => setHovered(null)}>
                <span className="cover-bd-dot" style={{ background: s.color }} />
                <span className="cover-bd-lab">{s.label}</span>
                <span className="cover-bd-share">{pctBR(s.share)}</span>
              </div>
            ))}
          </div>
          {/* Altura reservada: o texto troca no hover sem empurrar o layout. */}
          <div className="cover-bd-detail">
            {detail
              ? <><strong>{pctBR(detail.share)}</strong> {detail.hint}.</>
              : prog.total > 0
                ? <span className="muted">Passe o mouse sobre uma fatia para ver o que ela representa.</span>
                : <span className="muted">Nenhuma atividade cadastrada ainda.</span>}
          </div>
        </div>

        <div className="cover-hero-side">
          <div className="cover-money">
            <span className="cover-eyebrow">Valor estimado</span>
            <strong>{formatBRL(project.valorEstimado)}</strong>
          </div>
          <div className="cover-money alt">
            <span className="cover-eyebrow">Valor orçado</span>
            <strong>{formatBRL(project.valorOrcado)}</strong>
            {origem && <span className="cover-money-sub">{origem.label}</span>}
          </div>
          <span className="proj-status-badge lg" style={{ color: st.color, background: st.color + '1f' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.color }} />{st.label}
          </span>
        </div>
      </div>

      <Cronograma start={project.start} end={project.end} executado={prog.executado} />

      {/* ---- Ficha do cadastro ---- */}
      <div className="cover-facts">
        <div className="card fact">
          <span className="fact-ic"><Icon name="landmark" size={18} /></span>
          <div>
            <label>Prefeitura</label>
            <div className="fact-value">{dash(project.prefeitura)}</div>
            {project.secretaria && <div className="fact-sub">Secretaria de {project.secretaria}</div>}
          </div>
        </div>
        <div className="card fact">
          <span className="fact-ic"><Icon name="banknote" size={18} /></span>
          <div>
            <label>Origem do recurso</label>
            <div className="fact-value">{origem ? origem.label : '—'}</div>
          </div>
        </div>
        <div className="card fact">
          <span className="fact-ic"><Icon name="users" size={18} /></span>
          <div style={{ minWidth: 0 }}>
            <label>Profissionais responsáveis</label>
            {responsibles.length === 0 ? (
              <div className="fact-sub" style={{ marginTop: 2 }}>Nenhum definido. Edite o projeto para incluir.</div>
            ) : (
              <div className="ds-people">
                {responsibles.map(u => (
                  <span className="ds-person" key={u.id} title={u.name}>
                    <span className="av" style={{ width: 24, height: 24, background: u.color, fontSize: 9 }}>{u.initials}</span>
                    {u.name.split(' ')[0]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- Responsáveis ---- */}
      {/* ---- Observações ---- */}
      {project.notes && (
        <div className="card cover-block">
          <h3>Observações</h3>
          <NotesText text={project.notes} />
        </div>
      )}
    </div>
  )
}
