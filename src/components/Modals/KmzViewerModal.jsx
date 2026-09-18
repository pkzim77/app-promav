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
  return (
    <Modal title={titulo} onClose={onClose} className="kmz-modal"
      footer={<>
        <a className="btn btn-secondary" href={api.fileUrl(resource.fileId)} download={resource.filename || 'mapa.kmz'}>
          <Icon name="download" size={16} />Baixar .kmz
        </a>
        <button className="btn btn-primary" onClick={onClose}>Fechar</button>
      </>}>
      <KmzMapView resource={resource} equipe />
    </Modal>
  )
}
