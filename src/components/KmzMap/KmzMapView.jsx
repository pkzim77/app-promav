import React from 'react'
import L from 'leaflet'
import JSZip from 'jszip'
import { kml as kmlToGeoJSON } from '@tmcw/togeojson'
import 'leaflet/dist/leaflet.css'
import { Icon } from '../Icon.jsx'
import { api } from '../../data/api.js'
import {
  extrairKml, montarFeatures, aplicarEdicoes, agruparTrechos, pastasDosPlacemarks, totalizar,
  medeExtensao, percentualExecutado, formatarArea, formatarDistancia,
} from '../Modals/shared/kmzGeo.js'
import { carregarWayback, dataBR } from '../Modals/shared/wayback.js'

// Visualizador de .kmz/.kml: mapa + painel de trechos. O navegador não
// renderiza KMZ nativamente: o arquivo é um ZIP com um .kml dentro, então aqui
// a gente descompacta (JSZip), converte o KML em GeoJSON (@tmcw/togeojson),
// mede cada elemento (kmzGeo.js) e desenha num mapa Leaflet.
//
// É o miolo tanto do modal (KmzViewerModal) quanto do mapa embutido na Ficha
// técnica — um lugar só para o traçado, os fundos e o painel de trechos, para
// os dois não divergirem. Quem embute decide o tamanho pelo CSS do contêiner.

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

// Cores do traçado. O laranja de alto contraste se lê tanto sobre imagem de
// satélite quanto sobre o mapa de ruas. Um trecho com execução lançada muda
// de cor conforme o andamento — assim o mapa sozinho já conta onde a obra
// está: verde é feito, amarelo está em execução, laranja ainda não começou.
const TRACO = '#ff5722'
const TRACO_ANDAMENTO = '#f5c542'
const TRACO_CONCLUIDO = '#2ecc71'

function corDoTrecho(f) {
  const pct = percentualExecutado(f)
  if (pct === null) return TRACO
  if (pct >= 100) return TRACO_CONCLUIDO
  if (pct > 0) return TRACO_ANDAMENTO
  return TRACO
}

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
export function medidaResumo(f) {
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
  if (f.grupo) {
    const g = document.createElement('p')
    g.className = 'kmz-popup-grupo'
    g.textContent = f.grupo
    el.appendChild(g)
  }
  if (f.descricao) {
    const p = document.createElement('p')
    p.textContent = f.descricao.slice(0, 400)
    el.appendChild(p)
  }
  return el
}

// Leitura de equipe sobre a lista de trechos: quantos já fecharam, quantos
// estão sem nenhum metro lançado. Só trechos de extensão entram — polígono e
// ponto não têm "executado" para medir.
export function resumirTrechos(feats) {
  const linhas = feats.filter(medeExtensao)
  const pcts = linhas.map(percentualExecutado)
  return {
    linhas: linhas.length,
    concluidos: pcts.filter(p => p !== null && p >= 100).length,
    emExecucao: pcts.filter(p => p !== null && p > 0 && p < 100).length,
    semLancamento: pcts.filter(p => p === null).length,
  }
}

// `equipe`: liga as leituras que só interessam a quem executa (trechos
// concluídos, aviso de execução não lançada). O modal aberto a partir de
// qualquer lugar não liga; a Ficha técnica liga.
export function KmzMapView({ resource, equipe = false }) {
  const boxRef = React.useRef(null)
  const mapRef = React.useRef(null)
  const histRef = React.useRef(null)    // camada do histórico, quando ligado
  const layersRef = React.useRef(new Map()) // id da feature → camada do Leaflet
  const geoRef = React.useRef(null)     // grupo com todo o traçado
  const parsedRef = React.useRef(null)  // { geo } pronto, à espera do <div> do mapa

  const [status, setStatus] = React.useState('loading') // loading | ok | error
  const [error, setError] = React.useState(null)
  const [base, setBase] = React.useState([]) // features medidas do arquivo, sem edições
  const [geoVersion, setGeoVersion] = React.useState(0) // incrementa quando parsedRef tem dado novo
  const [fundoId, setFundoId] = React.useState(FUNDO_PADRAO)
  const [avisoFundo, setAvisoFundo] = React.useState(null)
  const [releases, setReleases] = React.useState([])
  const [histIdx, setHistIdx] = React.useState(null) // null = histórico desligado
  const [selecionado, setSelecionado] = React.useState(null)

  // As edições (nome, metros executados) entram por cima do arquivo já lido,
  // sem reler nada. A chave serializada é de propósito: o projeto chega como
  // objeto novo a cada recarga do bootstrap (o polling faz isso a cada mudança
  // no banco), e comparar por referência recriaria o mapa — perdendo zoom e
  // enquadramento — mesmo sem nenhum trecho ter mudado.
  const segKey = JSON.stringify(resource.segments || [])
  const feats = React.useMemo(() => aplicarEdicoes(base, JSON.parse(segKey)), [base, segKey])
  const featsRef = React.useRef(feats)
  featsRef.current = feats
  // Quais trechos estão vivos (os apagados no editor saem de `feats`). O mapa é
  // desenhado a partir do GeoJSON inteiro, então precisa ser refeito quando
  // esse conjunto muda — só recolorir não tira o traço apagado da tela.
  const idsVivos = feats.map(f => f.id).join(',')

  const totais = React.useMemo(() => totalizar(feats), [feats])
  const trechos = React.useMemo(() => resumirTrechos(feats), [feats])
  // Trechos por grupo (rua, localidade): vem da pasta do Google Earth ou do
  // campo "Grupo" do editor. Sem nenhum grupo, a lista fica corrida como antes.
  const grupos = React.useMemo(() => agruparTrechos(feats), [feats])
  const comGrupos = grupos.some(g => g.nome !== null)

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

        // Só o que vem do arquivo. Os nomes e o progresso lançados na aba
        // "Tipo de obra" (resource.segments) entram no useMemo `feats` acima.
        parsedRef.current = { geo }
        setBase(montarFeatures(geo, pastasDosPlacemarks(doc)))
        setGeoVersion(v => v + 1)
        setStatus('ok')
      } catch (e) {
        if (!cancelado) { setError(e.message || 'Falha ao ler o arquivo.'); setStatus('error') }
      }
    }
    run()

    return () => { cancelado = true }
  }, [resource.fileId, resource.filename])

  // ---------- monta o mapa ----------
  // Efeito separado do de cima de propósito: um efeito só roda depois que o
  // React já colocou o <div ref={boxRef}> no DOM, então aqui boxRef.current
  // sempre existe — ao contrário de criar o mapa dentro da função assíncrona
  // acima, que dependia de acertar o timing de um rAF e podia desistir
  // silenciosamente se o ref ainda não estivesse pronto.
  React.useEffect(() => {
    if (status !== 'ok' || !parsedRef.current || !boxRef.current) return
    const lista = featsRef.current
    // Sem os trechos apagados. Mantém a mesma ordem de `lista`, que é o que
    // faz o índice de style/onEachFeature (abaixo) casar com cada trecho.
    const vivos = new Set(lista.map(f => f.id))
    const geoCompleto = parsedRef.current.geo
    const geo = { ...geoCompleto, features: geoCompleto.features.filter((_, i) => vivos.has(`f${i}`)) }

    // preferCanvas: com dezenas de trechos o canvas rende bem melhor que SVG.
    const map = L.map(boxRef.current, { zoomControl: true, preferCanvas: true })
    mapRef.current = map
    L.control.scale({ imperial: false, maxWidth: 140 }).addTo(map)

    // A ordem de style/onEachFeature acompanha a de geo.features, que é a
    // mesma de montarFeatures — por isso o índice casa.
    let iEstilo = 0
    let iBalao = 0
    const grupo = L.geoJSON(geo, {
      style: () => {
        const cor = corDoTrecho(lista[iEstilo++] || {})
        return { color: cor, weight: 4, opacity: 0.95, fillColor: cor, fillOpacity: 0.22 }
      },
      // Pontos como círculo: o ícone padrão do Leaflet aponta para PNGs
      // que o bundler não resolve, e apareceria quebrado.
      pointToLayer: (_f, latlng) =>
        L.circleMarker(latlng, { radius: 6, color: '#fff', weight: 2, fillColor: TRACO, fillOpacity: 1 }),
      onEachFeature: (_f, layer) => {
        const medida = lista[iBalao++]
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
  }, [status, geoVersion, idsVivos])

  // ---------- execução lançada muda: recolore no lugar ----------
  // Depois de "Lançar execução" o projeto volta com segments novos. Em vez de
  // recriar o mapa (e perder o zoom), só troca a cor e o balão de cada trecho.
  React.useEffect(() => {
    for (const f of feats) {
      const layer = layersRef.current.get(f.id)
      if (!layer) continue
      // Ponto fica como está: o círculo tem anel branco de propósito.
      if ((f.extensaoM > 0 || f.areaM2 > 0) && layer.setStyle) {
        const cor = corDoTrecho(f)
        layer.setStyle({ color: cor, fillColor: cor })
      }
      if (layer.getPopup?.()) layer.setPopupContent(balao(f))
    }
  }, [feats])

  // Embutido numa página, o contêiner pode mudar de largura depois que o mapa
  // já existe (aba trocada, janela redimensionada). O Leaflet só mede o <div>
  // na criação — sem isto, sobra faixa cinza ou o traçado sai do enquadramento.
  React.useEffect(() => {
    const el = boxRef.current
    if (!el || status !== 'ok' || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => mapRef.current?.invalidateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [status])

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
    // O mapa pode já ter sido destruído quando o componente sai — daí a checagem.
    return () => { if (mapRef.current) camadas.forEach(l => map.removeLayer(l)) }
    // geoVersion: o mapa é recriado a cada arquivo lido, e o fundo precisa
    // entrar de novo no mapa novo — sem isso ele nascia cinza, sem satélite.
  }, [fundoId, status, geoVersion])

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
  }, [histIdx, releases, status, geoVersion])

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

  // Enquadra todos os trechos de um grupo de uma vez — é a rua inteira.
  const irParaGrupo = (g) => {
    const map = mapRef.current
    if (!map) return
    const b = L.latLngBounds([])
    for (const f of g.trechos) {
      const layer = layersRef.current.get(f.id)
      if (!layer) continue
      if (layer.getBounds) b.extend(layer.getBounds())
      else if (layer.getLatLng) b.extend(layer.getLatLng())
    }
    if (b.isValid()) { setSelecionado(null); map.fitBounds(b, { padding: [40, 40], maxZoom: 18 }) }
  }

  const resumoGrupo = (g) => {
    const t = g.totais
    if (t.linhas > 0) {
      return g.pct !== null
        ? `${formatarDistancia(t.extensaoExecutadaM)} de ${formatarDistancia(t.extensaoM)} · ${g.pct}%`
        : `${formatarDistancia(t.extensaoM)} · ${t.linhas} ${t.linhas === 1 ? 'trecho' : 'trechos'}`
    }
    return t.poligonos > 0 ? formatarArea(t.areaM2) : `${g.trechos.length} ${g.trechos.length === 1 ? 'ponto' : 'pontos'}`
  }

  const relAtual = histIdx === null ? null : releases[histIdx]
  const pctTotal = totais.extensaoM > 0 ? Math.round((totais.extensaoExecutadaM / totais.extensaoM) * 100) : null

  if (status === 'error') {
    return <p className="kmz-msg kmz-msg-error"><Icon name="x" size={15} stroke={2.5} />{error}</p>
  }
  if (status === 'loading') return <p className="kmz-msg">Lendo o arquivo…</p>

  return (
    <div className="kmz-view">
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
          {/* Legenda das cores só quando há execução lançada — sem ela o
              traçado é uma cor só e a legenda não diria nada. */}
          {totais.extensaoExecutadaM > 0 && (
            <span className="kmz-legenda">
              <i style={{ background: TRACO_CONCLUIDO }} />concluído
              <i style={{ background: TRACO_ANDAMENTO }} />em execução
              <i style={{ background: TRACO }} />não iniciado
            </span>
          )}
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
                <span className="kmz-total-rot">executado{pctTotal !== null ? ` · ${pctTotal}%` : ''}</span>
              </div>
            )}
            {equipe && totais.extensaoExecutadaM > 0 && trechos.linhas > 0 && (
              <div className="kmz-total">
                <span className="kmz-total-num">{trechos.concluidos} de {trechos.linhas}</span>
                <span className="kmz-total-rot">
                  trechos concluídos{trechos.emExecucao > 0 ? ` · ${trechos.emExecucao} em execução` : ''}
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

          {/* Só para a equipe: o que ainda não foi medido em campo. O cliente
              não lança execução, então para ele isto seria ruído. */}
          {equipe && trechos.semLancamento > 0 && (
            <p className="kmz-hint">
              {trechos.semLancamento === trechos.linhas
                ? 'Nenhum trecho tem execução lançada ainda.'
                : `${trechos.semLancamento} ${trechos.semLancamento === 1 ? 'trecho ainda sem' : 'trechos ainda sem'} execução lançada.`}
              {' '}Use “Lançar execução” para registrar os metros feitos.
            </p>
          )}

          <ul className="kmz-feats">
            {grupos.map(g => (
              <li key={g.nome ?? '__sem-grupo'} className="kmz-grupo">
                {comGrupos && (
                  <button type="button" className="kmz-grupo-cab" onClick={() => irParaGrupo(g)}
                    title="Enquadrar o grupo no mapa">
                    <span className="kmz-grupo-nome">{g.nome || 'Sem grupo'}</span>
                    <span className="kmz-grupo-medida">{resumoGrupo(g)}</span>
                    {g.pct !== null && (
                      <span className={'kmz-feat-bar' + (g.pct >= 100 ? ' done' : '')} aria-hidden="true">
                        <i style={{ width: `${Math.min(g.pct, 100)}%` }} />
                      </span>
                    )}
                  </button>
                )}
                <ul className={'kmz-grupo-itens' + (comGrupos ? ' recuado' : '')}>
                  {g.trechos.map(f => {
                    const pct = percentualExecutado(f)
                    return (
                      <li key={f.id}>
                        <button type="button" className={'kmz-feat' + (selecionado === f.id ? ' on' : '')}
                          onClick={() => irPara(f)}>
                          <span className="kmz-feat-nome">{f.nome}</span>
                          <span className="kmz-feat-medida">{medidaResumo(f)}</span>
                          {pct !== null && (
                            <span className={'kmz-feat-bar' + (pct >= 100 ? ' done' : '')} aria-hidden="true">
                              <i style={{ width: `${Math.min(pct, 100)}%` }} />
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
