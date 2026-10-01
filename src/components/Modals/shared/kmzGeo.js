// Leitura de .kmz e medições geodésicas. Sem DOM e sem Leaflet de propósito:
// é matemática pura, então dá para testar sem navegador e reaproveitar em
// relatórios depois. Todas as coordenadas aqui seguem a ordem do GeoJSON
// ([lon, lat]) — o Leaflet usa a ordem inversa, a conversão fica na tela.

// Raio equatorial do WGS-84, em metros.
export const RAIO_TERRA = 6378137

const rad = (g) => (g * Math.PI) / 180

// Área de um anel pela fórmula do excesso esférico (a mesma do Turf e, na
// prática, a do Google Earth). Nas escalas de uma obra o erro contra a
// elipsoide fica abaixo de 0,5% — irrelevante perto da precisão do traçado
// desenhado à mão no Google Earth, que é a origem destes arquivos.
export function areaAnelM2(anel) {
  if (!Array.isArray(anel) || anel.length < 3) return 0
  let soma = 0
  for (let i = 0; i < anel.length; i++) {
    const [lon1, lat1] = anel[i]
    const [lon2, lat2] = anel[(i + 1) % anel.length]
    soma += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  return Math.abs((soma * RAIO_TERRA * RAIO_TERRA) / 2)
}

// Área de um polígono GeoJSON: primeiro anel é o contorno, os demais são
// furos (pátio interno, ilha, área excluída do serviço) e são descontados.
export function areaPoligonoM2(aneis) {
  if (!Array.isArray(aneis) || !aneis.length) return 0
  return aneis.reduce((total, anel, i) => total + (i === 0 ? areaAnelM2(anel) : -areaAnelM2(anel)), 0)
}

// Distância entre dois pontos pela haversine.
export function distanciaM([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * RAIO_TERRA * Math.asin(Math.min(1, Math.sqrt(s)))
}

// Comprimento de uma sequência de pontos. `fechar` soma o trecho de volta ao
// início — é o que transforma o comprimento em perímetro.
export function comprimentoM(pontos, fechar = false) {
  if (!Array.isArray(pontos) || pontos.length < 2) return 0
  let d = 0
  for (let i = 0; i < pontos.length - 1; i++) d += distanciaM(pontos[i], pontos[i + 1])
  if (fechar && pontos.length > 2) d += distanciaM(pontos[pontos.length - 1], pontos[0])
  return d
}

// Mede uma geometria GeoJSON. Devolve sempre a mesma forma para simplificar
// quem consome: área e perímetro só são não-zero em polígonos, comprimento só
// em linhas.
export function medirGeometria(geometry) {
  const vazio = { areaM2: 0, perimetroM: 0, extensaoM: 0 }
  if (!geometry) return vazio
  const { type, coordinates, geometries } = geometry

  switch (type) {
    case 'Polygon':
      return {
        areaM2: areaPoligonoM2(coordinates),
        // O perímetro é o do contorno externo; furos não entram na cerca.
        perimetroM: comprimentoM(coordinates[0], true),
        extensaoM: 0,
      }
    case 'MultiPolygon':
      return coordinates.reduce((acc, poligono) => ({
        areaM2: acc.areaM2 + areaPoligonoM2(poligono),
        perimetroM: acc.perimetroM + comprimentoM(poligono[0], true),
        extensaoM: 0,
      }), vazio)
    case 'LineString':
      return { ...vazio, extensaoM: comprimentoM(coordinates) }
    case 'MultiLineString':
      return { ...vazio, extensaoM: coordinates.reduce((s, l) => s + comprimentoM(l), 0) }
    case 'GeometryCollection':
      return (geometries || []).reduce((acc, g) => {
        const m = medirGeometria(g)
        return {
          areaM2: acc.areaM2 + m.areaM2,
          perimetroM: acc.perimetroM + m.perimetroM,
          extensaoM: acc.extensaoM + m.extensaoM,
        }
      }, vazio)
    default: // Point, MultiPoint e o que mais vier
      return vazio
  }
}

// ---------- formatação (pt-BR) ----------

const num = (v, casas) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

// Abaixo de 1 ha o número em hectares vira "0,04" e não diz nada; nesse caso
// metro quadrado comunica melhor.
export function formatarArea(m2) {
  if (!m2) return '—'
  const ha = m2 / 10000
  return ha >= 1 ? `${num(ha, 2)} ha` : `${num(Math.round(m2), 0)} m²`
}

export function formatarDistancia(m) {
  if (!m) return '—'
  return m >= 1000 ? `${num(m / 1000, 2)} km` : `${num(Math.round(m), 0)} m`
}

// ---------- leitura do arquivo ----------

// Um .kmz é um ZIP com um .kml dentro. Devolve o texto do KML — aceitando
// também um .kml solto, que é o que sai do Google Earth em "salvar como".
export async function extrairKml(buffer, nomeArquivo = '', JSZip) {
  if (/\.kml$/i.test(nomeArquivo)) return new TextDecoder().decode(buffer)
  const zip = await JSZip.loadAsync(buffer)
  // O padrão é doc.kml na raiz, mas alguns exportadores usam outro nome.
  const entrada =
    zip.file(/^doc\.kml$/i)[0] ||
    zip.file(/\.kml$/i).sort((a, b) => a.name.length - b.name.length)[0]
  if (!entrada) throw new Error('O .kmz não contém nenhum arquivo .kml dentro.')
  return entrada.async('string')
}

// Pasta do Google Earth em que cada Placemark está, na ordem do documento —
// a mesma em que o togeojson percorre os Placemarks, por isso o índice casa
// com o de montarFeatures. Pasta aninhada: vale a mais próxima. Quem desenha
// no Google Earth costuma separar por rua ou localidade em pastas, e isso é
// o grupo natural dos trechos; o <Document> raiz não conta como pasta.
//
// Só usa getElementsByTagName/parentNode/childNodes para funcionar tanto no
// DOMParser do navegador quanto num DOM mínimo de teste.
export function pastasDosPlacemarks(doc) {
  const nomeDe = (el) => {
    for (const filho of Array.from(el.childNodes || [])) {
      if (filho.nodeType === 1 && filho.tagName === 'name') return String(filho.textContent || '').trim()
    }
    return ''
  }
  return Array.from(doc?.getElementsByTagName?.('Placemark') || []).map((pm) => {
    for (let el = pm.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (el.tagName === 'Folder') return nomeDe(el) || null
    }
    return null
  })
}

// Monta a lista que a tela mostra: um item por feature, já medido. `pastas`
// (de pastasDosPlacemarks) dá o grupo inicial de cada trecho.
export function montarFeatures(geojson, pastas = []) {
  return (geojson?.features || []).map((f, i) => {
    const medida = medirGeometria(f.geometry)
    const props = f.properties || {}
    const pasta = pastas[i] || null
    return {
      // O id é a posição no arquivo — estável entre parses porque o KML de um
      // fileId já enviado não muda, e o togeojson percorre o documento sempre
      // na mesma ordem. É essa estabilidade que permite salvar edições
      // (aplicarEdicoes, abaixo) referenciando só o id, sem guardar o resto.
      id: `f${i}`,
      nome: props.name || props.Name || `Elemento ${i + 1}`,
      descricao: limparHtml(props.description || props.Description || ''),
      tipo: f.geometry?.type || 'Desconhecido',
      pasta,        // como veio do arquivo — não muda
      grupo: pasta, // o que vale na tela — aplicarEdicoes pode trocar
      extensaoExecutadaM: null, // preenchido por aplicarEdicoes quando houver
      ...medida,
    }
  })
}

// Mescla as edições guardadas no projeto (renomear um trecho, pô-lo num
// grupo, registrar quantos metros já foram executados) por cima dos valores
// calculados do arquivo. `segmentos` é o que fica salvo no recurso — só o que
// a equipe mexeu, indexado pelo mesmo id que montarFeatures atribui.
export function aplicarEdicoes(features, segmentos) {
  if (!Array.isArray(segmentos) || !segmentos.length) return features
  const porId = new Map(segmentos.map(s => [s.id, s]))
  return features.filter(f => !porId.get(f.id)?.removido).map((f) => {
    const edicao = porId.get(f.id)
    if (!edicao) return f
    const nome = typeof edicao.nome === 'string' && edicao.nome.trim() ? edicao.nome.trim() : f.nome
    // Grupo em branco volta para a pasta do arquivo, como o nome volta para o
    // nome do arquivo: apagar é "desfazer", não "tirar do grupo".
    const grupo = typeof edicao.grupo === 'string' && edicao.grupo.trim() ? edicao.grupo.trim() : f.grupo
    const executada = typeof edicao.extensaoExecutadaM === 'number' && edicao.extensaoExecutadaM >= 0
      ? edicao.extensaoExecutadaM : null
    return { ...f, nome, grupo, extensaoExecutadaM: executada }
  })
}

// Trechos por grupo, na ordem em que cada grupo aparece no arquivo, com os
// totais do grupo (mesma conta de totalizar) e o percentual executado. Quem
// não tem grupo fica junto no fim, com nome null — a tela decide o rótulo.
export function agruparTrechos(features) {
  const grupos = new Map()
  for (const f of features) {
    const chave = f.grupo || ''
    if (!grupos.has(chave)) grupos.set(chave, { nome: f.grupo || null, trechos: [] })
    grupos.get(chave).trechos.push(f)
  }
  const lista = [...grupos.values()].map((g) => {
    const totais = totalizar(g.trechos)
    const pct = totais.extensaoM > 0 && totais.extensaoExecutadaM > 0
      ? Math.round((totais.extensaoExecutadaM / totais.extensaoM) * 100) : null
    return { ...g, totais, pct }
  })
  // sort é estável: só empurra o "sem grupo" para o fim, sem mexer no resto.
  return lista.sort((a, b) => (a.nome === null) - (b.nome === null))
}

// Um trecho é "de extensão" (rua, linha) quando tem comprimento e não é um
// polígono — é o único caso em que "quantos metros já foram executados" faz
// sentido medir. Compartilhado entre o editor de trechos e o visualizador
// para os dois concordarem sobre quando mostrar o campo/percentual.
export function medeExtensao(f) {
  return f.extensaoM > 0
}

// Percentual executado de um trecho, ou null quando não há valor lançado.
// Pode passar de 100% (o "como construído" veio maior que o desenhado) — quem
// exibe decide se quer sinalizar isso.
export function percentualExecutado(f) {
  if (!medeExtensao(f) || f.extensaoExecutadaM == null) return null
  return Math.round((f.extensaoExecutadaM / f.extensaoM) * 100)
}

// A descrição do KML costuma vir com HTML do Google Earth. Guardamos só o
// texto — nunca injetamos markup vindo de arquivo de terceiro na tela.
export function limparHtml(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// Totais do arquivo inteiro, para o cabeçalho do painel.
export function totalizar(features) {
  return features.reduce((acc, f) => ({
    areaM2: acc.areaM2 + f.areaM2,
    extensaoM: acc.extensaoM + f.extensaoM,
    // Só soma o que foi de fato lançado — projetos sem nenhum trecho medido
    // em campo ainda não têm "executado" para mostrar.
    extensaoExecutadaM: acc.extensaoExecutadaM + (f.extensaoExecutadaM || 0),
    poligonos: acc.poligonos + (f.areaM2 > 0 ? 1 : 0),
    linhas: acc.linhas + (f.extensaoM > 0 ? 1 : 0),
  }), { areaM2: 0, extensaoM: 0, extensaoExecutadaM: 0, poligonos: 0, linhas: 0 })
}

// Detecta um .kmz anexado antes de existir a coluna dedicada de mapas — nessa
// época só dava para subir pela coluna Documentos. Fica aqui (e não só na
// tela) porque tanto a Ficha técnica quanto o modal de edição do projeto
// precisam concordar sobre o que conta como mapa.
export function ehArquivoKmz(recurso) {
  return recurso?.type === 'kmz' || (recurso?.type === 'doc' && /\.kmz$/i.test(recurso?.filename || ''))
}
