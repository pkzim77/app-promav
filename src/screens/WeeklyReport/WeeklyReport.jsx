import './WeeklyReport.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { Avatar, Field, SelecaoMultipla } from '../../components/primitives/primitives.jsx'
import { EmptyState } from '../Projects/shared/EmptyState.jsx'
import { ConfirmDialog } from '../../components/Modals/ConfirmDialog.jsx'
import { api } from '../../data/api.js'
import { fmtFull, parseDate, todayISO, addDays, MESES_EXTENSO, PROJECT_STATUSES, PROJECT_STATUS_MAP } from '../../data/store.js'

// Relatório semanal: a tela de quem escreve ("Meu relatório") e a de quem
// recebe ("Relatórios individuais"), mais o documento impresso que as duas
// compartilham — é ele que vira PDF, e ele segue o modelo em uso na empresa.
//
// O que NÃO existe aqui de propósito: gravação de PDF. O documento é montado a
// partir do texto toda vez que alguém imprime. Guardar o arquivo custaria uns
// 40 MB por ano para armazenar o que já está no banco em 1,5 MB.

// O papel escreve o dia da semana com o sufixo ('Segunda-feira'); as telas
// usam a forma curta, então esta lista é só do documento.
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

function porExtenso(iso) {
  const d = parseDate(iso)
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES_EXTENSO[d.getMonth()]} de ${d.getFullYear()}`
}

// A sexta que encerra a semana de uma data. Repete a regra do servidor de
// propósito: a tela precisa saber em que semana está antes de qualquer resposta
// chegar, senão o seletor pisca de uma semana para outra ao carregar.
function sextaDe(iso) {
  const d = parseDate(iso)
  const dow = d.getDay()
  return addDays(iso, dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow)
}

const temTexto = (html) => !!String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

// O título da atividade entra no HTML do editor; escapar mantém "&", "<" e
// ">" visíveis no documento em vez de sumirem ou virarem tag.
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------------------------------------------------------------- editor ----

// Edição de texto com negrito, itálico e marcadores — que é tudo o que o modelo
// usa. Sem biblioteca: são três comandos do próprio navegador.
//
// Colar vira TEXTO PURO, e isso não é preciosismo de formatação. Um Ctrl+V de
// print de tela entra como data:base64 dentro do HTML: um print vira até 2 MB
// numa coluna de texto. Aqui a imagem nem chega a existir; o servidor ainda
// limpa de novo, porque a rota aceita qualquer corpo.
function EditorMini({ value, onChange, placeholder }) {
  const corpo = React.useRef(null)
  const [vazio, setVazio] = React.useState(!temTexto(value))

  // contentEditable não é campo controlado: reescrever o HTML a cada tecla
  // jogaria o cursor para o começo. Só sincroniza quando o texto vem de fora.
  React.useEffect(() => {
    const el = corpo.current
    if (el && el.innerHTML !== (value || '')) el.innerHTML = value || ''
    setVazio(!temTexto(value))
  }, [value])

  const emitir = () => {
    const html = corpo.current?.innerHTML || ''
    setVazio(!temTexto(html))
    onChange(html)
  }

  const aplicar = (comando) => {
    corpo.current?.focus()
    document.execCommand(comando, false, null)
    emitir()
  }

  const colar = (e) => {
    e.preventDefault()
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
    emitir()
  }

  // onMouseDown com preventDefault: sem isso, clicar no botão tira o foco do
  // texto e o comando cai no vazio, sem seleção para formatar.
  const botao = (comando, titulo, conteudo) => (
    <button type="button" className="ed-btn" title={titulo} aria-label={titulo}
      onMouseDown={(e) => e.preventDefault()} onClick={() => aplicar(comando)}>
      {conteudo}
    </button>
  )

  return (
    <div className="ed">
      <div className="ed-barra">
        {botao('bold', 'Negrito (Ctrl+B)', <b>N</b>)}
        {botao('italic', 'Itálico (Ctrl+I)', <i>I</i>)}
        {botao('insertUnorderedList', 'Lista com marcadores', <Icon name="list" size={15} stroke={2.2} />)}
      </div>
      <div ref={corpo} className={'ed-corpo' + (vazio ? ' ed-vazio' : '')} contentEditable
        data-vazio={placeholder} onInput={emitir} onBlur={emitir} onPaste={colar}
        suppressContentEditableWarning />
    </div>
  )
}

// ------------------------------------------------------------- documento ----

// O documento impresso. Fica escondido na tela e só aparece no @media print —
// é isto que o navegador transforma em PDF.
//
// dangerouslySetInnerHTML aqui é deliberado e tem contrato: o servidor aceita
// uma lista fechada de tags e apaga TODO atributo antes de gravar (limparHtml
// em server/index.js). O que chega aqui não tem como carregar script, href nem
// src. Se aquela limpeza mudar, esta linha passa a ser um buraco.
export function RelatorioDoc({ report, user, projects }) {
  const nomeDe = (id) => projects.find(p => p.id === id)?.name || 'Projeto removido'
  const works = report.works || {}

  // Relatório enviado antes desta tela: um texto único para a semana inteira e
  // status escrito à mão. Continua sendo impresso como foi escrito — reimprimir
  // um relatório já entregue com outro formato seria reescrever o passado.
  const legado = !Object.keys(works).length && !!String(report.developed || '').replace(/<[^>]*>/g, '').trim()

  return (
    <article className="rel-doc">
      <header className="rel-doc-marca">
        <span className="rel-doc-logo"><b>PRO</b><em>MAV</em></span>
        <span className="rel-doc-eng">ENGENHARIA</span>
      </header>

      <h1 className="rel-doc-h1">RELATÓRIO SEMANAL</h1>
      <p className="rel-doc-data">{porExtenso(report.week)}</p>

      {/* Só período e nome. A lista de projetos saiu daqui: os nomes voltariam
          logo abaixo como título de cada bloco, e o leitor leria tudo duas
          vezes antes de chegar ao conteúdo. */}
      <table className="rel-doc-tabela">
        <tbody>
          <tr><th>Período</th><td>Semana encerrada em {fmtFull(report.week)}</td></tr>
          <tr><th>Nome</th><td>{user?.name || '—'}</td></tr>
        </tbody>
      </table>

      {legado ? (
        <>
          <h2 className="rel-doc-h2">O QUE FOI DESENVOLVIDO DURANTE A SEMANA</h2>
          <div className="rel-doc-rico" dangerouslySetInnerHTML={{ __html: report.developed }} />
          <h2 className="rel-doc-h2">STATUS</h2>
          <ul className="rel-doc-lista">
            {report.projectIds.map(id => (
              <li key={id}>
                <strong>{nomeDe(id).toLocaleUpperCase('pt-BR')}:</strong>{' '}
                <span className="rel-doc-rico-inline" dangerouslySetInnerHTML={{ __html: report.statuses?.[id] || '—' }} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        report.projectIds.map(id => {
          const st = PROJECT_STATUS_MAP[report.statuses?.[id]]
          return (
            <section key={id} className="rel-doc-proj">
              <h2 className="rel-doc-h2">{nomeDe(id).toLocaleUpperCase('pt-BR')}</h2>
              {st && (
                <p className="rel-doc-status">
                  Status: <strong style={{ color: st.color }}>{st.label}</strong>
                </p>
              )}
              <div className="rel-doc-rico" dangerouslySetInnerHTML={{ __html: works[id] || '' }} />
            </section>
          )
        })
      )}
    </article>
  )
}

// Abre a impressão do navegador com um título — o título vira o nome sugerido
// do arquivo ao salvar em PDF, então "Relatório Semanal 18-09-2026" já sai
// pronto. Devolver o título antigo importa: ele é o nome da aba.
function useImpressao() {
  const [fila, setFila] = React.useState(null)

  React.useEffect(() => {
    if (!fila) return
    const antes = document.title
    document.title = fila.titulo
    window.print()
    document.title = antes
    setFila(null)
  }, [fila])

  return [fila, (titulo, itens) => setFila({ titulo, itens })]
}

const nomeArquivo = (semana) => `Relatório Semanal ${fmtFull(semana).replace(/\//g, '-')}`

// --------------------------------------------------- tela do colaborador ----

function SeletorSemana({ semana, onChange, ocupado }) {
  const hojeSexta = sextaDe(todayISO())
  return (
    <div className="rel-semana">
      <button className="btn-icon" onClick={() => onChange(addDays(semana, -7))} disabled={ocupado}
        aria-label="Semana anterior"><Icon name="chevronLeft" size={18} /></button>
      <span className="rel-semana-txt">
        Semana encerrada em <strong>{fmtFull(semana)}</strong>
      </span>
      <button className="btn-icon" onClick={() => onChange(addDays(semana, 7))}
        disabled={ocupado || semana >= hojeSexta} aria-label="Próxima semana">
        <Icon name="chevronRight" size={18} />
      </button>
    </div>
  )
}

// Um painel por projeto marcado, todos abertos. O texto é por projeto porque um
// campo único para a semana obrigava a pessoa a repetir o nome do projeto dentro
// da frase para se fazer entender.
function AbaDoProjeto({ projeto, status, texto, atividades, onStatus, onTexto, onTirar, onUsarSugestao }) {
  return (
    <div className="rel-aba">
      <div className="rel-aba-topo">
        <h3>{projeto.name}</h3>
        <button type="button" className="btn-icon rel-aba-tirar" onClick={onTirar}
          title="Tirar do relatório" aria-label={`Tirar ${projeto.name} do relatório`}>
          <Icon name="trash" size={16} />
        </button>
      </div>

      <Field label="Status do projeto">
        <select className="control rel-status" value={status || ''}
          style={status ? {
            color: PROJECT_STATUS_MAP[status]?.color,
            background: PROJECT_STATUS_MAP[status]?.color + '1f',
            borderColor: PROJECT_STATUS_MAP[status]?.color + '55',
          } : null}
          onChange={e => onStatus(e.target.value)}>
          <option value="">Selecione o status</option>
          {PROJECT_STATUSES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="O que foi feito neste projeto">
        <EditorMini value={texto || ''} onChange={onTexto}
          placeholder="Um item por linha. Use a lista com marcadores." />
        {!!atividades.length && (
          <button type="button" className="btn btn-ghost btn-sm rel-sugestao" onClick={onUsarSugestao}>
            <Icon name="sparkles" size={15} />
            Inserir as {atividades.length} atividades que você tocou neste projeto
          </button>
        )}
      </Field>
    </div>
  )
}

export function MyWeeklyReport({ authUser, projects, onFlash, onFail }) {
  const [semana, setSemana] = React.useState(() => sextaDe(todayISO()))
  const [carregando, setCarregando] = React.useState(true)
  const [salvando, setSalvando] = React.useState('')
  const [projectIds, setProjectIds] = React.useState([])
  const [works, setWorks] = React.useState({})
  const [statuses, setStatuses] = React.useState({})
  const [sentAt, setSentAt] = React.useState(null)
  const [sugestao, setSugestao] = React.useState({ projectIds: [], disponiveis: [], atividades: [] })
  const [erro, setErro] = React.useState(null)
  const [tentativa, setTentativa] = React.useState(0)
  const [trocaPendente, setTrocaPendente] = React.useState(null)
  const [fila, imprimir] = useImpressao()

  // Assinatura do que o servidor devolveu (ou do último salvamento).
  // Comparar o conteúdo com ela é mais confiável que uma marca de "mexeu": o
  // blur do EditorMini reemite o mesmo HTML sem nada ter mudado.
  const base = React.useRef('')
  const serializar = () => JSON.stringify({ projectIds, works, statuses })

  React.useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    api.weeklyReportMine(semana)
      .then(r => {
        if (!vivo) return
        const s = r.sugestao || { projectIds: [], disponiveis: [], atividades: [] }
        setSugestao(s)
        // Sem relatório salvo, já vêm marcados os projetos em que a pessoa mexeu
        // nesta semana — não todos os que ela tem. Quem está em 26 projetos não
        // entrega um relatório que fala de 26.
        const ids = r.report ? r.report.projectIds : (s.projectIds || [])
        const w = r.report?.works || {}
        const st = r.report?.statuses || {}
        setProjectIds(ids)
        setWorks(w)
        setStatuses(st)
        setSentAt(r.report?.sentAt || null)
        base.current = JSON.stringify({ projectIds: ids, works: w, statuses: st })
      })
      .catch(e => { if (vivo) setErro(e.message || 'Erro ao carregar o relatório.') })
      .finally(() => vivo && setCarregando(false))
    return () => { vivo = false }
  }, [semana, tentativa])

  const daSemana = React.useMemo(() => new Set(sugestao.projectIds), [sugestao])

  // Os projetos da pessoa, com os que ela tocou nesta semana em cima.
  const meusProjetos = React.useMemo(() => {
    const ids = new Set([...sugestao.projectIds, ...sugestao.disponiveis, ...projectIds])
    return projects.filter(p => ids.has(p.id))
      .sort((a, b) => (daSemana.has(b.id) - daSemana.has(a.id)) || a.name.localeCompare(b.name, 'pt-BR'))
  }, [projects, sugestao, projectIds, daSemana])

  // Os painéis seguem a ordem da lista, não a ordem em que foram marcados: o
  // relatório impresso sai sempre na mesma sequência.
  const marcados = meusProjetos.filter(p => projectIds.includes(p.id))

  // Desmarcar não apaga o que foi escrito — some da tela e do documento, e um
  // clique errado se desfaz com outro. O que sai daqui é o que for salvo: o
  // servidor só grava texto de projeto declarado.
  const alternar = (id) => setProjectIds(ids =>
    ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  const usarSugestao = (id) => {
    const itens = sugestao.atividades.filter(a => a.projectId === id)
      .map(a => `<li>${escHtml(a.title)}</li>`).join('')
    setWorks(w => ({ ...w, [id]: `${w[id] || ''}<ul>${itens}</ul>` }))
  }

  const gravar = async (enviar) => {
    setSalvando(enviar ? 'enviar' : 'rascunho')
    try {
      const r = await api.saveWeeklyReport({ week: semana, projectIds, works, statuses, send: enviar })
      setSentAt(r.sentAt || null)
      base.current = JSON.stringify({ projectIds, works, statuses })
      onFlash(enviar ? 'Relatório enviado.' : 'Rascunho salvo.')
    } catch (e) {
      onFail(e.message || 'Erro ao salvar o relatório.')
    } finally {
      setSalvando('')
    }
  }

  if (carregando) {
    return <div className="page"><div className="rel-carregando"><span className="spin" />Carregando o relatório…</div></div>
  }

  // Sem a resposta da semana pedida, o formulário renderizaria o texto da
  // semana anterior — e "Salvar rascunho" gravaria esse texto na semana nova.
  if (erro) {
    return (
      <div className="page rel-tela">
        <div className="sec-head">
          <div><h2>Meu relatório</h2></div>
          <SeletorSemana semana={semana} onChange={setSemana} ocupado={false} />
        </div>
        <EmptyState icon="file" title="Não foi possível carregar o relatório" text={erro}
          action={<button className="btn btn-secondary" onClick={() => setTentativa(t => t + 1)}>Tentar de novo</button>} />
      </div>
    )
  }

  const relatorio = { week: semana, projectIds: marcados.map(p => p.id), works, statuses }
  const podeEnviar = marcados.some(p => temTexto(works[p.id]))
  const sujo = serializar() !== base.current

  return (
    <>
      <div className="page rel-tela">
        <div className="sec-head">
          <div>
            <h2>Meu relatório</h2>
            <div className="sub">
              {sentAt
                ? `Enviado em ${new Date(sentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`
                : 'Ainda não enviado. Salve quantas vezes quiser antes.'}
            </div>
          </div>
          <SeletorSemana semana={semana} ocupado={!!salvando}
            onChange={(nova) => sujo ? setTrocaPendente(nova) : setSemana(nova)} />
        </div>

        <div className="card rel-form">
          {meusProjetos.length ? (<>
            <Field label="Projetos da semana">
              <SelecaoMultipla
                itens={meusProjetos.map(p => ({
                  id: p.id,
                  nome: p.name,
                  marcado: projectIds.includes(p.id),
                  // Marca quem teve tempo cronometrado ou atividade mexida na
                  // semana: é a dica de quem provavelmente precisa ser relatado.
                  etiqueta: daSemana.has(p.id) ? 'mexeu nesta semana' : null,
                }))}
                onAlternar={alternar}
                ariaLabel="Projetos da semana"
                rotulo={(n) => n ? `${n} projeto${n === 1 ? '' : 's'} neste relatório` : 'Escolha os projetos da semana'} />
            </Field>

            {marcados.map(p => (
              <AbaDoProjeto key={p.id} projeto={p}
                status={statuses[p.id]} texto={works[p.id]}
                atividades={sugestao.atividades.filter(a => a.projectId === p.id)}
                onStatus={(v) => setStatuses(st => ({ ...st, [p.id]: v }))}
                onTexto={(html) => setWorks(w => ({ ...w, [p.id]: html }))}
                onTirar={() => alternar(p.id)}
                onUsarSugestao={() => usarSugestao(p.id)} />
            ))}

            {!marcados.length && (
              <p className="rel-vazio-txt">Nenhum projeto escolhido. Abra a lista acima e marque em quais você trabalhou.</p>
            )}
          </>) : (
            <p className="rel-vazio-txt">Você ainda não está em nenhum projeto — fale com a coordenação.</p>
          )}

          <div className="rel-acoes">
            <button className="btn btn-secondary" onClick={() => gravar(false)} disabled={!!salvando}>
              {salvando === 'rascunho' ? <><span className="spin" />Salvando…</> : 'Salvar rascunho'}
            </button>
            <button className="btn btn-primary" onClick={() => gravar(true)} disabled={!!salvando || !podeEnviar}>
              {salvando === 'enviar'
                ? <><span className="spin" />Enviando…</>
                : <><Icon name="check" size={16} stroke={2.4} />{sentAt ? 'Reenviar com correções' : 'Enviar relatório'}</>}
            </button>
            <button className="btn btn-ghost" onClick={() => imprimir(nomeArquivo(semana), [relatorio])} disabled={!!salvando}>
              <Icon name="printer" size={16} />Baixar o meu
            </button>
          </div>

          {!podeEnviar && (
            <p className="rel-falta">
              Para enviar, conte o que foi feito em pelo menos um projeto.
            </p>
          )}
        </div>

        <details className="card rel-previa">
          <summary><Icon name="eye" size={15} />Prévia do documento</summary>
          <div className="rel-previa-corpo">
            <RelatorioDoc report={relatorio} user={authUser} projects={projects} />
          </div>
        </details>
      </div>

      <div className="rel-impressao">
        {(fila?.itens || [relatorio]).map((r, i) => (
          <RelatorioDoc key={i} report={r} user={authUser} projects={projects} />
        ))}
      </div>

      {trocaPendente && (
        <ConfirmDialog title="Alterações não salvas"
          message="O que você escreveu nesta semana ainda não foi salvo. Trocar de semana descarta essas alterações."
          confirmLabel="Trocar mesmo assim"
          onConfirm={() => { setSemana(trocaPendente); setTrocaPendente(null) }}
          onClose={() => setTrocaPendente(null)} />
      )}
    </>
  )
}

// ---------------------------------------------------------- tela do admin ----

export function AdminWeeklyReports({ users, projects }) {
  const [semana, setSemana] = React.useState(() => sextaDe(todayISO()))
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState(null)
  const [tentativa, setTentativa] = React.useState(0)
  const [dados, setDados] = React.useState({ reports: [], faltando: [] })
  const [marcados, setMarcados] = React.useState([])
  const [fila, imprimir] = useImpressao()

  React.useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    setMarcados([])
    api.weeklyReports(semana)
      .then(d => vivo && setDados({ reports: d.reports || [], faltando: d.faltando || [] }))
      .catch(e => { if (vivo) setErro(e.message || 'Erro ao carregar os relatórios.') })
      .finally(() => vivo && setCarregando(false))
    return () => { vivo = false }
  }, [semana, tentativa])

  const userOf = (id) => users.find(u => u.id === id)
  const { reports, faltando } = dados
  const todosMarcados = reports.length > 0 && marcados.length === reports.length

  const alternar = (id) => setMarcados(m => m.includes(id) ? m.filter(x => x !== id) : [...m, id])
  const alternarTodos = () => setMarcados(todosMarcados ? [] : reports.map(r => r.id))

  // Um PDF só com vários relatórios: o documento tem quebra de página entre um
  // e outro, então o navegador já pagina sozinho.
  const baixarSelecionados = () => {
    const lista = reports.filter(r => marcados.includes(r.id))
    if (lista.length) imprimir(nomeArquivo(semana), lista)
  }

  return (
    <>
      <div className="page rel-tela">
        <div className="sec-head">
          <div>
            <h2>Relatórios individuais</h2>
            {!erro && (
              <div className="sub">
                {carregando ? 'Carregando…' : `${reports.length} enviado${reports.length === 1 ? '' : 's'}`}
                {!carregando && faltando.length ? ` · ${faltando.length} pendente${faltando.length === 1 ? '' : 's'}` : ''}
              </div>
            )}
          </div>
          <SeletorSemana semana={semana} onChange={setSemana} ocupado={carregando} />
        </div>

        {carregando ? (
          <div className="rel-carregando"><span className="spin" />Carregando os relatórios…</div>
        ) : erro ? (
          <EmptyState icon="file" title="Não foi possível carregar os relatórios" text={erro}
            action={<button className="btn btn-secondary" onClick={() => setTentativa(t => t + 1)}>Tentar de novo</button>} />
        ) : !reports.length ? (
          <EmptyState icon="file" title="Nenhum relatório enviado nesta semana"
            text={faltando.length
              ? `${faltando.length} pessoa${faltando.length === 1 ? '' : 's'} ainda não enviou. Os relatórios aparecem aqui assim que forem enviados.`
              : 'Os relatórios aparecem aqui assim que forem enviados.'} />
        ) : (
          <div className="card rel-lista">
            <div className="rel-lista-topo">
              <label className="rel-todos">
                <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} />
                Selecionar todos
              </label>
              <button className="btn btn-primary btn-sm" onClick={baixarSelecionados} disabled={!marcados.length}>
                <Icon name="file" size={15} />
                Baixar {marcados.length || ''} em um PDF
              </button>
            </div>

            {reports.map(r => {
              const u = userOf(r.userId)
              return (
                <div key={r.id} className="rel-linha">
                  <label className="rel-linha-ck">
                    <input type="checkbox" checked={marcados.includes(r.id)} onChange={() => alternar(r.id)}
                      aria-label={`Selecionar o relatório de ${u?.name || 'pessoa removida'}`} />
                  </label>
                  {u && <Avatar user={u} size={32} />}
                  <div className="rel-linha-info">
                    <span className="rel-linha-nome">{u?.name || 'Pessoa removida'}</span>
                    <span className="rel-linha-meta">
                      {r.projectIds.map(id => projects.find(p => p.id === id)?.name).filter(Boolean).join(' · ') || 'sem projeto'}
                    </span>
                  </div>
                  <span className="rel-linha-hora">
                    {r.sentAt ? new Date(r.sentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                  </span>
                  <button className="btn btn-secondary btn-sm"
                    onClick={() => imprimir(`${nomeArquivo(semana)} — ${u?.name || ''}`.trim(), [r])}>
                    Baixar
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {!carregando && !erro && !!faltando.length && (
          <div className="card rel-faltando">
            <h3>Ainda não enviaram</h3>
            <div className="rel-faltando-lista">
              {faltando.map(id => {
                const u = userOf(id)
                return (
                  <span key={id} className="rel-pendente">
                    {u && <Avatar user={u} size={22} />}
                    {u?.name || 'Pessoa removida'}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="rel-impressao">
        {fila
          ? fila.itens.map(r => (
              <RelatorioDoc key={r.id} report={r} user={userOf(r.userId)} projects={projects} />
            ))
          : <p className="rel-sem-fila">Este PDF é gerado pelo botão "Baixar" da tela Relatórios individuais. Marque os relatórios desejados e use o botão.</p>}
      </div>
    </>
  )
}
