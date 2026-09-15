// Acervo histórico de satélite da Esri ("World Imagery Wayback"): imagens
// datadas de 2014 até hoje, o equivalente gratuito ao "imagens antigas" do
// Google Earth. A configuração é pública e não pede chave de API.
//
// Sem DOM nem Leaflet aqui de propósito — só a leitura da configuração, que é
// a parte com regra de negócio e dá para testar.

export const WAYBACK_CFG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'

// A configuração vem como um objeto { numeroDaVersao: { itemTitle, itemURL } }.
// O título carrega a data ("World Imagery (Wayback 2014-02-20)") e a URL usa
// os curingas do WMTS ({level}/{row}/{col}), que o Leaflet não entende — daí a
// tradução para {z}/{y}/{x}.
export function lerConfigWayback(cfg) {
  if (!cfg || typeof cfg !== 'object') return []
  const versoes = Object.entries(cfg)
    .map(([num, item]) => {
      const url = String(item?.itemURL || '')
        .replace('{level}', '{z}').replace('{row}', '{y}').replace('{col}', '{x}')
      const data = String(item?.itemTitle || '').match(/\d{4}-\d{2}-\d{2}/)
      // Sem URL ou sem data a versão é inútil para a linha do tempo.
      return url && data ? { num, data: data[0], url } : null
    })
    .filter(Boolean)

  // Uma mesma data pode aparecer em mais de uma entrada; a linha do tempo fica
  // confusa com repetição, então fica só a primeira de cada data.
  const porData = new Map()
  for (const v of versoes) if (!porData.has(v.data)) porData.set(v.data, v)

  // Ordem cronológica: o controle começa na ponta mais recente.
  return [...porData.values()].sort((a, b) => a.data.localeCompare(b.data))
}

// "2019-03-14" → "14/03/2019"
export function dataBR(iso) {
  return String(iso).split('-').reverse().join('/')
}

// Busca a configuração. Falha em silêncio para quem chama decidir: sem
// internet ou com o serviço fora, o histórico simplesmente não aparece.
// Sem timeout, uma resposta que nunca chega (rede lenta, S3 truncando a
// conexão) deixava o fetch pendurado pra sempre — nem sucesso, nem erro.
export async function carregarWayback(signal, timeoutMs = 8000) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combinado = signal ? AbortSignal.any([signal, timeout]) : timeout
  const res = await fetch(WAYBACK_CFG, { signal: combinado })
  if (!res.ok) throw new Error(`Wayback indisponível (${res.status}).`)
  return lerConfigWayback(await res.json())
}
