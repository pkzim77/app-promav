import React from 'react'
import JSZip from 'jszip'
import { kml as kmlToGeoJSON } from '@tmcw/togeojson'
import { Icon } from '../Icon.jsx'
import { api } from '../../data/api.js'
import {
  extrairKml, montarFeatures, aplicarEdicoes, totalizar, medeExtensao, percentualExecutado,
  formatarArea, formatarDistancia,
} from './shared/kmzGeo.js'

// Editor dos trechos de um .kmz: renomear cada trecho (o KML costuma trazer
// nomes como "kml_4" ou "Caminho sem título") e registrar quantos metros já
// foram executados. Fica na aba "Tipo de obra" do modal de projeto — quem
// desenha o traçado no mapa é o KmzViewerModal, aberto pela Ficha técnica.
//
// Carrega o próprio arquivo (fetch + JSZip + togeojson) em vez de receber a
// lista pronta: assim o componente só puxa essas duas libs quando a aba
// realmente abre, e o modal de projeto — que não é lazy — não fica pesado.
export function KmzSegmentsEditor({ resource, onChange }) {
  const [status, setStatus] = React.useState('loading') // loading | ok | error
  const [error, setError] = React.useState(null)
  const [features, setFeatures] = React.useState([]) // calculado do arquivo, sem edições

  React.useEffect(() => {
    let cancelado = false
    setStatus('loading'); setError(null)

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
        setFeatures(montarFeatures(geo))
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

  // Atualiza (ou cria) a edição de um trecho e devolve o recurso inteiro já
  // com a lista de segments atualizada — quem chama decide onde isso entra
  // no array de resources do projeto.
  const editar = (id, patch) => {
    const atual = segmentosSalvos.find(s => s.id === id) || { id }
    const proximo = { ...atual, ...patch }
    onChange({ ...resource, segments: [...segmentosSalvos.filter(s => s.id !== id), proximo] })
  }

  if (status === 'loading') return <p className="kmz-msg">Lendo os trechos do arquivo…</p>
  if (status === 'error') return <p className="kmz-msg kmz-msg-error"><Icon name="x" size={14} stroke={2.5} />{error}</p>
  if (!editados.length) return null

  return (
    <div className="kmz-edit">
      <div className="kmz-edit-totais">
        {totais.linhas > 0 && <span><strong>{formatarDistancia(totais.extensaoM)}</strong> planejados</span>}
        {totais.extensaoExecutadaM > 0 && <span><strong>{formatarDistancia(totais.extensaoExecutadaM)}</strong> executados</span>}
        {totais.poligonos > 0 && <span><strong>{formatarArea(totais.areaM2)}</strong> de área</span>}
        <span>{editados.length} {editados.length === 1 ? 'trecho' : 'trechos'}</span>
      </div>

      <div className="kmz-edit-list">
        {editados.map((f) => {
          const pct = percentualExecutado(f)
          return (
            <div className="kmz-edit-row" key={f.id}>
              <input className="control kmz-edit-nome" value={f.nome}
                onChange={e => editar(f.id, { nome: e.target.value })}
                placeholder="Nome do trecho" />
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
      </div>
    </div>
  )
}
