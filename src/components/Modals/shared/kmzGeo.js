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

// Monta a lista que a tela mostra: um item por feature, já medido.
export function montarFeatures(geojson) {
  return (geojson?.features || []).map((f, i) => {
    const medida = medirGeometria(f.geometry)
    const props = f.properties || {}
    return {
      // O id é a posição no arquivo — estável entre parses porque o KML de um
      // fileId já enviado não muda, e o togeojson percorre o documento sempre
      // na mesma ordem. É essa estabilidade que permite salvar edições
      // (aplicarEdicoes, abaixo) referenciando só o id, sem guardar o resto.
      id: `f${i}`,
      nome: props.name || props.Name || `Elemento ${i + 1}`,
      descricao: limparHtml(props.description || props.Description || ''),
      tipo: f.geometry?.type || 'Desconhecido',
      extensaoExecutadaM: null, // preenchido por aplicarEdicoes quando houver
      ...medida,
    }
  })
}

// Mescla as edições guardadas no projeto (renomear um trecho, registrar
// quantos metros já foram executados) por cima dos valores calculados do
// arquivo. `segmentos` é o que fica salvo no recurso — só o que a equipe
// mexeu, indexado pelo mesmo id que montarFeatures atribui.
export function aplicarEdicoes(features, segmentos) {
  if (!Array.isArray(segmentos) || !segmentos.length) return features
  const porId = new Map(segmentos.map(s => [s.id, s]))
  return features.map((f) => {
    const edicao = porId.get(f.id)
    if (!edicao) return f
    const nome = typeof edicao.nome === 'string' && edicao.nome.trim() ? edicao.nome.trim() : f.nome
    const executada = typeof edicao.extensaoExecutadaM === 'number' && edicao.extensaoExecutadaM >= 0
      ? edicao.extensaoExecutadaM : null
    return { ...f, nome, extensaoExecutadaM: executada }
  })
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
