import React from 'react'
import JSZip from 'jszip'
import { kml as kmlToGeoJSON } from '@tmcw/togeojson'
import { Icon } from '../Icon.jsx'
import { api } from '../../data/api.js'
import {
  extrairKml, montarFeatures, aplicarEdicoes, agruparTrechos, pastasDosPlacemarks, totalizar,
  medeExtensao, percentualExecutado, formatarArea, formatarDistancia,
} from './shared/kmzGeo.js'

// Editor dos trechos de um .kmz: renomear cada trecho (o KML costuma trazer
// nomes como "kml_4" ou "Caminho sem título"), pô-lo num grupo (a rua ou a
// localidade — o Google Earth já sugere pela pasta em que o trecho foi
// desenhado) e registrar quantos metros já foram executados. Fica na aba
// "Tipo de obra" do modal de projeto — quem desenha o traçado no mapa é o
// KmzMapView, na Ficha técnica.
//
// Carrega o próprio arquivo (fetch + JSZip + togeojson) em vez de receber a
// lista pronta: assim o componente só puxa essas duas libs quando a aba
// realmente abre, e o modal de projeto — que não é lazy — não fica pesado.
export function KmzSegmentsEditor({ resource, onChange }) {
  const [status, setStatus] = React.useState('loading') // loading | ok | error
  const [error, setError] = React.useState(null)
  const [features, setFeatures] = React.useState([]) // calculado do arquivo, sem edições
  // Texto do campo "Grupo" enquanto ainda está sendo digitado, por id de
  // trecho — só entra no agrupamento (que decide em que bloco cada trecho
  // aparece) quando o campo perde o foco. Sem essa distinção, cada letra
  // digitada ("M", "Mi", "Mia"…) vira um grupo diferente na hora, o trecho
  // pula de bloco a cada tecla e o campo — que agora mora noutro lugar da
  // árvore — perde o foco no meio da palavra.
  const [grupoDigitando, setGrupoDigitando] = React.useState({})

  React.useEffect(() => {
    let cancelado = false
    setStatus('loading'); setError(null)
    setGrupoDigitando({}) // outro arquivo: os ids não são as mesmas edições em andamento

    async function run() {
      try {
        const res = await fetch(api.fileUrl(resource.fileId))
        if (!res.ok) throw new Error('Não foi possível baixar o arquivo do servidor.')
        const buffer = await res.arrayBuffer()
        const kmlText = await extrairKml(buffer, resource.filename || '', JSZip)
        const doc = new DOMParser().parseFromString(kmlText, 'text/xml')
        if (doc.querySelector('parsererror')) throw new Error('O KML dentro do arquivo está corrompido.')
        const geo = kmlToGeoJSON(doc)
        if (cancelado) return
        if (!geo.features?.length) throw new Error('O arquivo não tem nenhuma geometria.')
        setFeatures(montarFeatures(geo, pastasDosPlacemarks(doc)))
        setStatus('ok')
      } catch (e) {
        if (!cancelado) { setError(e.message || 'Falha ao ler o arquivo.'); setStatus('error') }
      }
    }
    run()
    return () => { cancelado = true }
  }, [resource.fileId, resource.filename])

  const segmentosSalvos = resource.segments || []
  const editados = React.useMemo(() => aplicarEdicoes(features, segmentosSalvos), [features, segmentosSalvos])
  const totais = React.useMemo(() => totalizar(editados), [editados])
  const grupos = React.useMemo(() => agruparTrechos(editados), [editados])
  const comGrupos = grupos.some(g => g.nome !== null)
  // Sugestões do campo "Grupo": os grupos que já existem no arquivo. Digitar
  // o mesmo nome em vários trechos é o que os junta — a lista evita variações
  // ("Miami", "miami do brasil") que virariam grupos diferentes.
  const nomesDeGrupo = grupos.map(g => g.nome).filter(Boolean)
  const listaId = `kmz-grupos-${resource.id}`

  // Atualiza (ou cria) a edição de um trecho e devolve o recurso inteiro já
  // com a lista de segments atualizada — quem chama decide onde isso entra
  // no array de resources do projeto.
  const editar = (id, patch) => {
    const atual = segmentosSalvos.find(s => s.id === id) || { id }
    const proximo = { ...atual, ...patch }
    onChange({ ...resource, segments: [...segmentosSalvos.filter(s => s.id !== id), proximo] })
  }

  // Confirma o grupo digitado: só agora ele conta para o agrupamento.
  const confirmarGrupo = (id) => {
    if (!(id in grupoDigitando)) return
    editar(id, { grupo: grupoDigitando[id] })
    setGrupoDigitando(({ [id]: _fora, ...resto }) => resto)
  }

  if (status === 'loading') return <p className="kmz-msg">Lendo os trechos do arquivo…</p>
  if (status === 'error') return <p className="kmz-msg kmz-msg-error"><Icon name="x" size={14} stroke={2.5} />{error}</p>
  if (!editados.length) return null

  const resumoGrupo = (g) => {
    const t = g.totais
    if (t.linhas > 0) {
      return g.pct !== null
        ? `${formatarDistancia(t.extensaoExecutadaM)} de ${formatarDistancia(t.extensaoM)} · ${g.pct}%`
        : formatarDistancia(t.extensaoM)
    }
    return t.poligonos > 0 ? formatarArea(t.areaM2) : ''
  }

  return (
    <div className="kmz-edit">
      <div className="kmz-edit-totais">
        {totais.linhas > 0 && <span><strong>{formatarDistancia(totais.extensaoM)}</strong> planejados</span>}
        {totais.extensaoExecutadaM > 0 && <span><strong>{formatarDistancia(totais.extensaoExecutadaM)}</strong> executados</span>}
        {totais.poligonos > 0 && <span><strong>{formatarArea(totais.areaM2)}</strong> de área</span>}
        <span>{editados.length} {editados.length === 1 ? 'trecho' : 'trechos'}</span>
        {comGrupos && <span>{grupos.filter(g => g.nome).length} {grupos.filter(g => g.nome).length === 1 ? 'grupo' : 'grupos'}</span>}
      </div>

      <datalist id={listaId}>
        {nomesDeGrupo.map(n => <option key={n} value={n} />)}
      </datalist>

      <div className="kmz-edit-list">
        {grupos.map((g) => (
          <React.Fragment key={g.nome ?? '__sem-grupo'}>
            {comGrupos && (
              <div className="kmz-edit-grupo">
                <b>{g.nome || 'Sem grupo'}</b>
                <span>{g.trechos.length} {g.trechos.length === 1 ? 'trecho' : 'trechos'}{resumoGrupo(g) ? ` · ${resumoGrupo(g)}` : ''}</span>
              </div>
            )}
            {g.trechos.map((f) => {
              const pct = percentualExecutado(f)
              // Os campos mostram o que foi digitado, inclusive vazio. Antes o
              // nome mostrava o valor já "aplicado", que cai no nome do arquivo
              // quando a edição está vazia — então não dava para apagar o texto
              // para escrever outro: o último backspace trazia "kml_7" de volta
              // e a próxima letra colava nele. Vazio de verdade volta ao valor
              // do arquivo, que fica de placeholder para avisar.
              const edicao = segmentosSalvos.find(s => s.id === f.id)
              const nomeDigitado = typeof edicao?.nome === 'string' ? edicao.nome : f.nome
              // Enquanto digita, mostra o texto solto (grupoDigitando) sem
              // mexer em qual bloco o trecho ocupa; ao confirmar, some da
              // lista e o valor volta a vir do grupo já aplicado.
              const grupoDigitado = f.id in grupoDigitando
                ? grupoDigitando[f.id]
                : (typeof edicao?.grupo === 'string' ? edicao.grupo : (f.grupo || ''))
              return (
                <div className="kmz-edit-row" key={f.id}>
                  <input className="control kmz-edit-nome" value={nomeDigitado}
                    onChange={e => editar(f.id, { nome: e.target.value })}
                    placeholder={f.nome} />
                  <input className="control kmz-edit-grupo-inp" value={grupoDigitado} list={listaId}
                    onChange={e => setGrupoDigitando(g => ({ ...g, [f.id]: e.target.value }))}
                    onBlur={() => confirmarGrupo(f.id)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    placeholder={f.pasta || 'Grupo (rua, localidade)'}
                    aria-label={`Grupo do trecho ${f.nome}`} />
                  <span className="kmz-edit-calc">{f.areaM2 ? formatarArea(f.areaM2) : formatarDistancia(f.extensaoM)}</span>
                  {medeExtensao(f) && (
                    <label className="kmz-edit-exec">
                      <input type="number" className="control" min={0} step={1} inputMode="numeric"
                        value={f.extensaoExecutadaM ?? ''}
                        placeholder="executados"
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value))
                          editar(f.id, { extensaoExecutadaM: v })
                        }} />
                      <span>m</span>
                    </label>
                  )}
                  {pct !== null && (
                    <span className={'kmz-edit-pct' + (pct >= 100 ? ' done' : '')}>{pct}%</span>
                  )}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
