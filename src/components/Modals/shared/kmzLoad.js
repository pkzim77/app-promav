// Leitura de um .kmz/.kml anexado ao projeto: baixa, descompacta (JSZip),
// converte em GeoJSON (togeojson) e mede os trechos. Vive à parte do kmzGeo.js
// (só matemática, sem DOM) porque depende da API, do DOMParser e do JSZip.
// Usado pelo KmzMapView e pelo KmzSegmentsEditor — os dois são chunks lazy que
// já compartilham o chunk de togeojson/JSZip, então o bundle não muda.
import JSZip from 'jszip'
import { kml as kmlToGeoJSON } from '@tmcw/togeojson'
import { api } from '../../../data/api.js'
import { extrairKml, montarFeatures, pastasDosPlacemarks } from './kmzGeo.js'

export async function lerKmz(resource) {
  const res = await api.fetchFile(resource.fileId)
  const buffer = await res.arrayBuffer()
  const kmlText = await extrairKml(buffer, resource.filename || '', JSZip)
  const doc = new DOMParser().parseFromString(kmlText, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('O KML dentro do arquivo está corrompido.')
  const geo = kmlToGeoJSON(doc)
  if (!geo.features?.length) throw new Error('O arquivo não tem nenhuma geometria.')
  return { geo, features: montarFeatures(geo, pastasDosPlacemarks(doc)) }
}
