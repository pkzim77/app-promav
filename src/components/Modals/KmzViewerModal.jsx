import React from 'react'
import L from 'leaflet'
import JSZip from 'jszip'
import { kml as kmlToGeoJSON } from '@tmcw/togeojson'
import 'leaflet/dist/leaflet.css'
import { Icon } from '../Icon.jsx'
import { Modal } from '../primitives/primitives.jsx'
import { api } from '../../data/api.js'
import {
  extrairKml, montarFeatures, aplicarEdicoes, totalizar, percentualExecutado,
  formatarArea, formatarDistancia,
} from './shared/kmzGeo.js'
import { carregarWayback, dataBR } from './shared/wayback.js'

// Visualizador de .kmz/.kml. O navegador não renderiza KMZ nativamente: o
// arquivo é um ZIP com um .kml dentro, então aqui a gente descompacta (JSZip),
// converte o KML em GeoJSON (@tmcw/togeojson), mede cada elemento (kmzGeo.js)
// e desenha num mapa Leaflet.

// ---------- camadas de fundo ----------
// Todas gratuitas e sem chave de API. As do Google usam o endpoint interno
// `mt{s}.google.com` — é o mesmo caminho que os visualizadores de KMZ da
// internet usam, mas não é uma API pública do Google, então pode parar de
// responder sem aviso. Por isso existe o fallback para o Esri mais abaixo.
const FUNDOS = [
  { id: 'ghyb', nome: 'Google Híbrido', url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Google', google: true },
  { id: 'gsat', nome: 'Google Satélite', url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Google', google: true },
  { id: 'esri', nome: 'Esri Satélite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 20, attribution: 'Esri World Imagery' },
  { id: 'esriHib', nome: 'Esri Híbrido', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 20, attribution: 'Esri World Imagery', rotulos: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}' },
  { id: 'osm', nome: 'Ruas (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: '© OpenStreetMap' },
  { id: 'topo', nome: 'Relevo (OpenTopoMap)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17, attribution: '© OpenTopoMap' },
]
const FUNDO_PADRAO = 'ghyb'
const FUNDO_RESERVA = 'esri' // para onde caímos se o Google não responder

// Empilhamento dentro do painel de tiles: o histórico cobre o fundo normal.
// Valores inteiros — z-index fracionário é CSS inválido e o navegador descarta.
const Z_FUNDO = 1
const Z_ROTULOS = 2
const Z_HIST = 3

// Cor do traçado: laranja de alto contraste, que se lê tanto sobre imagem de
// satélite quanto sobre o mapa de ruas.
const TRACO = '#ff5722'

// Monta a(s) camada(s) de um fundo. Híbridos são dois tiles empilhados
// (imagem + rótulos), por isso o retorno é sempre uma lista.
function criarFundo(cfg) {
  const base = L.tileLayer(cfg.url, {
    subdomains: cfg.subdomains || 'abc',
    maxZoom: cfg.maxZoom,
    maxNativeZoom: cfg.maxZoom,
    attribution: cfg.attribution,
    zIndex: Z_FUNDO,
  })
  if (!cfg.rotulos) return [base]
  return [base, L.tileLayer(cfg.rotulos, { maxZoom: cfg.maxZoom, zIndex: Z_ROTULOS })]
}

// Como resumir a medida de um elemento numa linha só. Um trecho com progresso
// lançado (editável no modal de projeto, aba "Tipo de obra") mostra quanto já
// foi executado do total planejado.
function medidaResumo(f) {
  if (f.areaM2 > 0) return `${formatarArea(f.areaM2)} · perím. ${formatarDistancia(f.perimetroM)}`
  if (f.extensaoM > 0) {
    const pct = percentualExecutado(f)
    if (pct !== null) return `${formatarDistancia(f.extensaoExecutadaM)} de ${formatarDistancia(f.extensaoM)} · ${pct}%`
    return formatarDistancia(f.extensaoM)
  }
  return 'ponto'
}

// Conteúdo do balão de um elemento. Montado por DOM (e não innerHTML) porque
// nome e descrição vêm de um arquivo de terceiro.
function balao(f) {
  const el = document.createElement('div')
  el.className = 'kmz-popup'
  const h = document.createElement('strong')
  h.textContent = f.nome
  el.appendChild(h)
  const medida = document.createElement('p')
  medida.className = 'kmz-popup-medida'
  medida.textContent = medidaResumo(f)
  el.appendChild(medida)
  if (f.descricao) {
    const p = document.createElement('p')
    p.textContent = f.descricao.slice(0, 400)
    el.appendChild(p)
  }
  return el
}

export function KmzViewerModal({ resource, onClose }) {
  const boxRef = React.useRef(null)
  const mapRef = React.useRef(null)
  const histRef = React.useRef(null)    // camada do histórico, quando ligado
  const layersRef = React.useRef(new Map()) // id da feature → camada do Leaflet
  const geoRef = React.useRef(null)     // grupo com todo o traçado
  const parsedRef = React.useRef(null)  // { geo, lista } prontos, à espera do <div> do mapa

  const [status, setStatus] = React.useState('loading') // loading | ok | error
  const [error, setError] = React.useState(null)
  const [feats, setFeats] = React.useState([])
  const [geoVersion, setGeoVersion] = React.useState(0) // incrementa quando parsedRef tem dado novo
  const [fundoId, setFundoId] = React.useState(FUNDO_PADRAO)
  const [avisoFundo, setAvisoFundo] = React.useState(null)
  const [releases, setReleases] = React.useState([])
  const [histIdx, setHistIdx] = React.useState(null) // null = histórico desligado
  const [selecionado, setSelecionado] = React.useState(null)

  const totais = React.useMemo(() => totalizar(feats), [feats])

  // ---------- carrega e converte o arquivo ----------
  React.useEffect(() => {
    let cancelado = false

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
        if (!geo.features?.length) throw new Error('O arquivo não tem nenhuma geometria para desenhar.')

        // resource.segments guarda os nomes e o progresso lançados na aba
        // "Tipo de obra" do projeto — mescla por cima do que o arquivo traz.
        const lista = aplicarEdicoes(montarFeatures(geo), resource.segments)
        parsedRef.current = { geo, lista }
        setFeats(lista)
        setGeoVersion(v => v + 1)
        setStatus('ok')
      } catch (e) {
        if (!cancelado) { setError(e.message || 'Falha ao ler o arquivo.'); setStatus('error') }
      }
    }
    run()

    return () => { cancelado = true }
  }, [resource.fileId, resource.filename, resource.segments])

  // ---------- monta o mapa ----------
  // Efeito separado do de cima de propósito: um efeito só roda depois que o
  // React já colocou o <div ref={boxRef}> no DOM, então aqui boxRef.current
  // sempre existe — ao contrário de criar o mapa dentro da função assíncrona
  // acima, que dependia de acertar o timing de um rAF e podia desistir
  // silenciosamente se o ref ainda não estivesse pronto.
  React.useEffect(() => {
    if (status !== 'ok' || !parsedRef.current || !boxRef.current) return
    const { geo, lista } = parsedRef.current

    // preferCanvas: com dezenas de trechos o canvas rende bem melhor que SVG.
    const map = L.map(boxRef.current, { zoomControl: true, preferCanvas: true })
    mapRef.current = map
    L.control.scale({ imperial: false, maxWidth: 140 }).addTo(map)

    let i = 0
    const grupo = L.geoJSON(geo, {
      style: () => ({ color: TRACO, weight: 4, opacity: 0.95, fillColor: TRACO, fillOpacity: 0.22 }),
      // Pontos como círculo: o ícone padrão do Leaflet aponta para PNGs
      // que o bundler não resolve, e apareceria quebrado.
      pointToLayer: (_f, latlng) =>
        L.circleMarker(latlng, { radius: 6, color: '#fff', weight: 2, fillColor: TRACO, fillOpacity: 1 }),
      onEachFeature: (_f, layer) => {
        // A ordem de onEachFeature acompanha a de geo.features, que é a
        // mesma de montarFeatures — por isso o índice casa.
        const medida = lista[i++]
        if (!medida) return
        layer.bindPopup(balao(medida))
        layersRef.current.set(medida.id, layer)
      },
    }).addTo(map)
    geoRef.current = grupo

    const bounds = grupo.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] })
    else map.setView([-15.79, -47.88], 4) // fallback: Brasil

    return () => {
      map.remove()
      if (mapRef.current === map) mapRef.current = null
      layersRef.current.clear()
    }
  }, [status, geoVersion])

  // ---------- troca do fundo ----------
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ok') return
    const cfg = FUNDOS.find(f => f.id === fundoId) || FUNDOS[0]
    const camadas = criarFundo(cfg)

    // O endpoint do Google pode simplesmente parar de responder. Alguns erros
    // de tile são normais (borda do mundo, zoom sem cobertura); só trocamos de
    // fundo quando falha de forma consistente.
    if (cfg.google) {
      let falhas = 0
      camadas[0].on('tileerror', () => {
        if (++falhas !== 10) return
        setAvisoFundo('Google indisponível — usando Esri.')
        setFundoId(FUNDO_RESERVA)
      })
    }

    camadas.forEach(l => l.addTo(map))
    // O mapa pode já ter sido destruído quando o modal fecha — daí a checagem.
    return () => { if (mapRef.current) camadas.forEach(l => map.removeLayer(l)) }
  }, [fundoId, status])

  // ---------- acervo histórico (Esri Wayback) ----------
  React.useEffect(() => {
    const ctrl = new AbortController()
    carregarWayback(ctrl.signal)
      .then(setReleases)
      .catch(() => { /* sem internet ou serviço fora: o histórico só não aparece */ })
    return () => ctrl.abort()
  }, [])

  React.useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ok') return
    if (histRef.current) { map.removeLayer(histRef.current); histRef.current = null }
    const rel = histIdx === null ? null : releases[histIdx]
    if (!rel) return
    // maxNativeZoom menor que maxZoom: o Wayback não tem tile em todo zoom, e
    // sem isso o mapa fica em branco ao aproximar demais.
    histRef.current = L.tileLayer(rel.url, {
      maxZoom: 21, maxNativeZoom: 18, zIndex: Z_HIST,
      attribution: `Esri Wayback ${dataBR(rel.data)}`,
    }).addTo(map)
  }, [histIdx, releases, status])

  // ---------- ações ----------
  const irPara = (f) => {
    const map = mapRef.current
    const layer = layersRef.current.get(f.id)
    if (!map || !layer) return
    setSelecionado(f.id)
    const b = layer.getBounds?.()
    if (b?.isValid()) map.fitBounds(b, { padding: [60, 60], maxZoom: 19 })
    else if (layer.getLatLng) map.setView(layer.getLatLng(), 18)
    layer.openPopup?.()
  }

  const enquadrarTudo = () => {
    const map = mapRef.current
    const b = geoRef.current?.getBounds()
    if (map && b?.isValid()) { setSelecionado(null); map.fitBounds(b, { padding: [30, 30] }) }
  }

  const relAtual = histIdx === null ? null : releases[histIdx]
  const titulo = resource.label || resource.filename || 'Mapa'

  return (
    <Modal title={titulo} onClose={onClose} className="kmz-modal"
      footer={<>
        <a className="btn btn-secondary" href={api.fileUrl(resource.fileId)} download={resource.filename || 'mapa.kmz'}>
          <Icon name="download" size={16} />Baixar .kmz
        </a>
        <button className="btn btn-primary" onClick={onClose}>Fechar</button>
      </>}>

      {status === 'error' ? (
        <p className="kmz-msg kmz-msg-error"><Icon name="x" size={15} stroke={2.5} />{error}</p>
      ) : status === 'loading' ? (
        <p className="kmz-msg">Lendo o arquivo…</p>
      ) : (
        <>
          <div className="kmz-toolbar">
            <label className="kmz-tool">
              <Icon name="layers" size={15} />
              <select className="control kmz-select" value={fundoId}
                onChange={e => { setAvisoFundo(null); setFundoId(e.target.value) }}>
                {FUNDOS.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>

            {releases.length > 0 && (
              <label className="kmz-tool">
                <input type="checkbox" checked={histIdx !== null}
                  onChange={e => setHistIdx(e.target.checked ? releases.length - 1 : null)} />
                <Icon name="history" size={15} />Imagens históricas
              </label>
            )}

            <button type="button" className="kmz-tool-btn" onClick={enquadrarTudo}>
              <Icon name="map" size={15} />Enquadrar tudo
            </button>
          </div>

          {avisoFundo && <p className="kmz-msg kmz-msg-error"><Icon name="x" size={14} stroke={2.5} />{avisoFundo}</p>}

          {histIdx !== null && relAtual && (
            <div className="kmz-hist">
              <button type="button" className="kmz-hist-nav" aria-label="Data anterior"
                disabled={histIdx === 0} onClick={() => setHistIdx(i => Math.max(0, i - 1))}>
                <Icon name="chevronLeft" size={16} />
              </button>
              <input type="range" className="kmz-hist-range" min={0} max={releases.length - 1} value={histIdx}
                onChange={e => setHistIdx(Number(e.target.value))} aria-label="Data da imagem de satélite" />
              <button type="button" className="kmz-hist-nav" aria-label="Próxima data"
                disabled={histIdx === releases.length - 1} onClick={() => setHistIdx(i => Math.min(releases.length - 1, i + 1))}>
                <Icon name="chevronRight" size={16} />
              </button>
              <span className="kmz-hist-data">
                <strong>{dataBR(relAtual.data)}</strong>
                <span>{histIdx + 1} de {releases.length}</span>
              </span>
            </div>
          )}

          <div className="kmz-layout">
            <div className="kmz-mapwrap">
              <div className="kmz-map" ref={boxRef} />
              {relAtual && <span className="kmz-selo">Imagem de {dataBR(relAtual.data)}</span>}
            </div>

            <aside className="kmz-side">
              <div className="kmz-totais">
                {totais.linhas > 0 && (
                  <div className="kmz-total">
                    <span className="kmz-total-num">{formatarDistancia(totais.extensaoM)}</span>
                    <span className="kmz-total-rot">extensão · {totais.linhas} {totais.linhas === 1 ? 'trecho' : 'trechos'}</span>
                  </div>
                )}
                {totais.extensaoExecutadaM > 0 && (
                  <div className="kmz-total">
                    <span className="kmz-total-num">{formatarDistancia(totais.extensaoExecutadaM)}</span>
                    <span className="kmz-total-rot">
                      executado{totais.extensaoM > 0 ? ` · ${Math.round((totais.extensaoExecutadaM / totais.extensaoM) * 100)}%` : ''}
                    </span>
                  </div>
                )}
                {totais.poligonos > 0 && (
                  <div className="kmz-total">
                    <span className="kmz-total-num">{formatarArea(totais.areaM2)}</span>
                    <span className="kmz-total-rot">área · {totais.poligonos} {totais.poligonos === 1 ? 'polígono' : 'polígonos'}</span>
                  </div>
                )}
              </div>

              <ul className="kmz-feats">
                {feats.map(f => (
                  <li key={f.id}>
                    <button type="button" className={'kmz-feat' + (selecionado === f.id ? ' on' : '')}
                      onClick={() => irPara(f)}>
                      <span className="kmz-feat-nome">{f.nome}</span>
                      <span className="kmz-feat-medida">{medidaResumo(f)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </>
      )}
    </Modal>
  )
}
