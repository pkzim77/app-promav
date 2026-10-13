import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal } from '../primitives/primitives.jsx'
import { api } from '../../data/api.js'
import { KmzMapView } from '../KmzMap/KmzMapView.jsx'

// Mapa de um .kmz em tela cheia. O visualizador em si (leitura do arquivo,
// fundos, histórico, painel de trechos) mora em KmzMapView — é o mesmo que a
// Ficha técnica embute na página. Aqui só entra a moldura: título, botão de
// baixar e o fechar.
export function KmzViewerModal({ resource, onClose }) {
  const titulo = resource.label || resource.filename || 'Mapa'
  // O link de baixar é pedido ao abrir: ele leva um token do próprio arquivo, e
  // não dá mais para montar a URL no cliente — o que ia nela antes era o token
  // de sessão. Enquanto não chega, o botão fica inerte em vez de levar a um 401.
  const [url, setUrl] = React.useState(null)
  React.useEffect(() => {
    let vivo = true
    api.fileLink(resource.fileId).then(u => { if (vivo) setUrl(u) }).catch(() => {})
    return () => { vivo = false }
  }, [resource.fileId])
  return (
    <Modal title={titulo} onClose={onClose} className="kmz-modal"
      footer={<>
        <a className="btn btn-secondary" href={url || undefined} aria-disabled={!url} download={resource.filename || 'mapa.kmz'}>
          <Icon name="download" size={16} />Baixar .kmz
        </a>
        <button className="btn btn-primary" onClick={onClose}>Fechar</button>
      </>}>
      <KmzMapView resource={resource} equipe />
    </Modal>
  )
}
