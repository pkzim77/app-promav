import './WeeklyReport.css'
import React from 'react'
import { Icon } from '../../components/Icon.jsx'
import { Avatar, Field } from '../../components/primitives/primitives.jsx'
import { EmptyState } from '../Projects/shared/EmptyState.jsx'
import { api } from '../../data/api.js'
import { fmtFull, parseDate, todayISO, addDays } from '../../data/store.js'

// Relatório semanal: a tela de quem escreve ("Meu relatório") e a de quem
// recebe ("Relatórios individuais"), mais o documento impresso que as duas
// compartilham — é ele que vira PDF, e ele segue o modelo em uso na empresa.
//
// O que NÃO existe aqui de propósito: gravação de PDF. O documento é montado a
// partir do texto toda vez que alguém imprime. Guardar o arquivo custaria uns
// 40 MB por ano para armazenar o que já está no banco em 1,5 MB.

// O papel escreve a data por extenso; MONTHS_PT do store é abreviado e serve
// para as telas, não para o documento que vai ao cliente.
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

function porExtenso(iso) {
  const d = parseDate(iso)
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
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
  const nomes = report.projectIds.map(nomeDe)

  return (
    <article className="rel-doc">
      <header className="rel-doc-marca">
        <span className="rel-doc-logo"><b>PRO</b><em>MAV</em></span>
        <span className="rel-doc-eng">ENGENHARIA</span>
      </header>

      <h1 className="rel-doc-h1">RELATÓRIO SEMANAL</h1>
      <p className="rel-doc-data">{porExtenso(report.week)}</p>

      <table className="rel-doc-tabela">
        <tbody>
          <tr><th>Período</th><td>Semana encerrada em {fmtFull(report.week)}</td></tr>
          <tr><th>Nome</th><td>{user?.name || '—'}</td></tr>
          <tr><th>Projetos</th><td>{nomes.join(' · ') || '—'}</td></tr>
        </tbody>
      </table>

      <h2 className="rel-doc-h2">PROJETOS</h2>
      <ul className="rel-doc-lista">
        {nomes.map((n, i) => <li key={report.projectIds[i]}>{n.toLocaleUpperCase('pt-BR')}</li>)}
      </ul>

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

export function MyWeeklyReport({ authUser, projects, onFlash, onFail }) {
  const [semana, setSemana] = React.useState(() => sextaDe(todayISO()))
  const [carregando, setCarregando] = React.useState(true)
  const [salvando, setSalvando] = React.useState('')
  const [projectIds, setProjectIds] = React.useState([])
  const [developed, setDeveloped] = React.useState('')
  const [statuses, setStatuses] = React.useState({})
  const [sentAt, setSentAt] = React.useState(null)
  const [sugestao, setSugestao] = React.useState({ projectIds: [], disponiveis: [], atividades: [] })
  const [filtro, setFiltro] = React.useState('')
  const [fila, imprimir] = useImpressao()

  React.useEffect(() => {
    let vivo = true
    setCarregando(true)
    api.weeklyReportMine(semana)
      .then(r => {
        if (!vivo) return
        setSugestao(r.sugestao || { projectIds: [], disponiveis: [], atividades: [] })
        // Sem relatório salvo, vêm marcados só os projetos em que a pessoa mexeu
        // na semana — não todos os que ela tem. Quem está em 26 projetos não
        // entrega um relatório que lista 26.
        setProjectIds(r.report ? r.report.projectIds : (r.sugestao?.projectIds || []))
        setDeveloped(r.report?.developed || '')
        setStatuses(r.report?.statuses || {})
        setSentAt(r.report?.sentAt || null)
      })
      .catch(e => onFail(e.message || 'Erro ao carregar o relatório.'))
      .finally(() => vivo && setCarregando(false))
    return () => { vivo = false }
  }, [semana])

  // Marcados primeiro: com 26 projetos na lista, o que a pessoa já escolheu não
  // pode ficar escondido no meio.
  const busca = filtro.trim().toLocaleLowerCase('pt-BR')
  const meusProjetos = projects
    .filter(p => projectIds.includes(p.id) || sugestao.disponiveis.includes(p.id))
    .filter(p => !busca || p.name.toLocaleLowerCase('pt-BR').includes(busca) || projectIds.includes(p.id))
    .sort((a, b) => (projectIds.includes(b.id) - projectIds.includes(a.id)) || a.name.localeCompare(b.name, 'pt-BR'))

  const alternar = (id) => setProjectIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  const gravar = async (enviar) => {
    setSalvando(enviar ? 'enviar' : 'rascunho')
    try {
      const r = await api.saveWeeklyReport({ week: semana, projectIds, developed, statuses, send: enviar })
      setSentAt(r.sentAt || null)
      onFlash(enviar ? 'Relatório enviado.' : 'Rascunho salvo.')
    } catch (e) {
      onFail(e.message || 'Erro ao salvar o relatório.')
    } finally {
      setSalvando('')
    }
  }

  // Joga as atividades da semana como marcadores no texto. Não substitui o que
  // já está escrito: acrescenta no fim, e a pessoa apaga o que não serve.
  const usarSugestao = () => {
    const itens = sugestao.atividades.map(a => `<li>${a.title.replace(/[<>&]/g, '')}</li>`).join('')
    setDeveloped(html => `${html || ''}<ul>${itens}</ul>`)
  }

  if (carregando) {
    return <div className="page"><div className="rel-carregando"><span className="spin" />Carregando o relatório…</div></div>
  }

  const relatorio = { week: semana, projectIds, developed, statuses }
  const podeEnviar = temTexto(developed) && projectIds.length > 0

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
          <SeletorSemana semana={semana} onChange={setSemana} ocupado={!!salvando} />
        </div>

        <div className="card rel-form">
          <Field label="Projetos da semana">
            {meusProjetos.length ? (<>
              {sugestao.disponiveis.length > 8 && (
                <input className="control rel-busca" value={filtro} placeholder="Filtrar projetos pelo nome"
                  onChange={e => setFiltro(e.target.value)} />
              )}
              <div className="rel-projs">
                {meusProjetos.map(p => (
                  <label key={p.id} className={'rel-proj' + (projectIds.includes(p.id) ? ' on' : '')}>
                    <input type="checkbox" checked={projectIds.includes(p.id)} onChange={() => alternar(p.id)} />
                    {p.name}
                  </label>
                ))}
              </div>
              {!projectIds.length && (
                <p className="rel-vazio-txt">Nenhum projeto marcado. Marque os que você tocou nesta semana.</p>
              )}
            </>) : (
              <p className="rel-vazio-txt">Você ainda não está em nenhum projeto — fale com a coordenação.</p>
            )}
          </Field>

          <Field label="O que foi desenvolvido durante a semana">
            <EditorMini value={developed} onChange={setDeveloped}
              placeholder="Um item por linha. Use a lista com marcadores." />
            {!!sugestao.atividades.length && (
              <button type="button" className="btn btn-ghost btn-sm rel-sugestao" onClick={usarSugestao}>
                <Icon name="sparkles" size={15} />
                Inserir as {sugestao.atividades.length} atividades que você tocou nesta semana
              </button>
            )}
          </Field>

          {projectIds.map(id => (
            <Field key={id} label={`Status — ${projects.find(p => p.id === id)?.name || 'projeto'}`}>
              <EditorMini value={statuses[id] || ''}
                onChange={(html) => setStatuses(s => ({ ...s, [id]: html }))}
                placeholder="Ex.: em andamento; orçamento aguardando análise." />
            </Field>
          ))}

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
              <Icon name="file" size={16} />Baixar o meu
            </button>
          </div>

          {!podeEnviar && (
            <p className="rel-falta">
              Para enviar, escolha ao menos um projeto e escreva o que foi desenvolvido.
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
        {(fila?.itens || []).map((r, i) => (
          <RelatorioDoc key={i} report={r} user={authUser} projects={projects} />
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------- tela do admin ----

export function AdminWeeklyReports({ users, projects, onFail }) {
  const [semana, setSemana] = React.useState(() => sextaDe(todayISO()))
  const [carregando, setCarregando] = React.useState(true)
  const [dados, setDados] = React.useState({ reports: [], faltando: [] })
  const [marcados, setMarcados] = React.useState([])
  const [fila, imprimir] = useImpressao()

  React.useEffect(() => {
    let vivo = true
    setCarregando(true)
    setMarcados([])
    api.weeklyReports(semana)
      .then(d => vivo && setDados({ reports: d.reports || [], faltando: d.faltando || [] }))
      .catch(e => onFail(e.message || 'Erro ao carregar os relatórios.'))
      .finally(() => vivo && setCarregando(false))
    return () => { vivo = false }
  }, [semana])

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
            <div className="sub">
              {carregando ? 'Carregando…' : `${reports.length} enviado${reports.length === 1 ? '' : 's'}`}
              {!carregando && faltando.length ? ` · ${faltando.length} pendente${faltando.length === 1 ? '' : 's'}` : ''}
            </div>
          </div>
          <SeletorSemana semana={semana} onChange={setSemana} ocupado={carregando} />
        </div>

        {carregando ? (
          <div className="rel-carregando"><span className="spin" />Carregando os relatórios…</div>
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

        {!carregando && !!faltando.length && (
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
        {(fila?.itens || []).map(r => (
          <RelatorioDoc key={r.id} report={r} user={userOf(r.userId)} projects={projects} />
        ))}
      </div>
    </>
  )
}
