import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { formatBytes, TIPOS_COM_KMZ } from '../../../data/store.js'
import { api } from '../../../data/api.js'
import { ehArquivoKmz } from '../../../components/Modals/shared/kmzGeo.js'
// Carregado sob demanda: o visualizador arrasta o Leaflet junto (~150 KB) e só
// serve quando alguém abre um mapa — não faz sentido pesar a Ficha técnica.
const KmzViewerModal = React.lazy(() =>
  import('../../../components/Modals/KmzViewerModal.jsx').then(m => ({ default: m.KmzViewerModal }))
)

// Mostra a "origem" (domínio) de uma URL — útil como subtítulo do link.
function urlHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// URL para abrir/baixar um recurso: arquivo do banco (via fileId) ou link externo.
function resourceUrl(r) {
  return r.fileId ? api.fileUrl(r.fileId) : r.url
}
// Título e subtítulo a exibir para um documento/imagem (arquivo enviado ou link).
function resourceTitle(r) {
  return r.label || r.filename || urlHost(r.url || '')
}
function resourceSub(r) {
  return r.fileId ? formatBytes(r.size) : urlHost(r.url || '')
}

// Menu de 3 pontinhos no canto de cada documento/link: copiar link ou excluir.
function ResourceMenu({ resource, onCopy, onDelete, canDelete = true }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  // Os itens ficam dentro de um <a>, então impedimos navegação ao interagir com o menu.
  const stop = (e) => { e.preventDefault(); e.stopPropagation() }
  return (
    <div className="res-menu-wrap" ref={ref} onClick={stop}>
      <button className={'res-menu-btn' + (open ? ' on' : '')} onClick={(e) => { stop(e); setOpen(o => !o) }} title="Opções" aria-label="Opções">
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={(e) => { stop(e); setOpen(false); onCopy(resource) }}>
            <Icon name="copy" size={16} />Copiar link
          </button>
          {canDelete && (
            <button className="menu-item danger" onClick={(e) => { stop(e); setOpen(false); onDelete(resource) }}>
              <Icon name="trash" size={16} />Excluir
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Botão "+" no cabeçalho da coluna para adicionar um novo documento/link.
function ColAddButton({ label, onClick }) {
  return (
    <button className="res-col-add" onClick={onClick} title={label} aria-label={label}>
      <Icon name="plus" size={16} stroke={2.4} />
    </button>
  )
}

// Coluna de documentos: cada doc é uma linha com ícone + nome.
function DocsColumn({ docs, onCopy, onDelete, onAdd, canDelete }) {
  return (
    <div className="res-col card">
      <div className="res-col-head">
        <Icon name="file" size={16} /><h3>Documentos</h3>
        <span className="res-col-count">{docs.length}</span>
        <ColAddButton label="Adicionar documento" onClick={() => onAdd('doc')} />
      </div>
      {docs.length === 0 ? (
        <p className="res-col-empty">Nenhum documento ainda.</p>
      ) : (
        <div className="doc-list">
          {docs.map(r => (
            <a key={r.id} className="doc-row" href={resourceUrl(r)} target="_blank" rel="noreferrer">
              <span className="doc-ic"><Icon name="file" size={17} /></span>
              <span className="doc-info">
                <span className="doc-name">{resourceTitle(r)}</span>
                <span className="doc-sub">{resourceSub(r)}</span>
              </span>
              <Icon name="externalLink" size={14} className="doc-open" />
              <ResourceMenu resource={r} onCopy={onCopy} onDelete={onDelete} canDelete={canDelete} />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// Coluna de links/bookmarks: cada link é um cartão clicável.
function LinksColumn({ links, onCopy, onDelete, onAdd, canDelete }) {
  return (
    <div className="res-col card">
      <div className="res-col-head">
        <Icon name="link" size={16} /><h3>Links</h3>
        <span className="res-col-count">{links.length}</span>
        <ColAddButton label="Adicionar link" onClick={() => onAdd('link')} />
      </div>
      {links.length === 0 ? (
        <p className="res-col-empty">Nenhum link ainda.</p>
      ) : (
        <div className="bookmark-list">
          {links.map(r => (
            <a key={r.id} className="bookmark" href={r.url} target="_blank" rel="noreferrer">
              <span className="bookmark-ic"><Icon name="link" size={16} /></span>
              <span className="bookmark-info">
                <span className="bookmark-title">{r.label || urlHost(r.url)}</span>
                <span className="bookmark-url">{r.url}</span>
              </span>
              <ResourceMenu resource={r} onCopy={onCopy} onDelete={onDelete} canDelete={canDelete} />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// Coluna de arquivos .kmz (área/trecho georreferenciado) — só aparece para
// projetos de piçarramento/pavimentação (ver TIPOS_COM_KMZ em store.js).
function MapsColumn({ maps, onCopy, onDelete, onAdd, onView, canDelete }) {
  return (
    <div className="res-col card">
      <div className="res-col-head">
        <Icon name="map" size={16} /><h3>Mapas (.kmz)</h3>
        <span className="res-col-count">{maps.length}</span>
        <ColAddButton label="Adicionar arquivo .kmz" onClick={() => onAdd('kmz')} />
      </div>
      {maps.length === 0 ? (
        <p className="res-col-empty">Nenhum arquivo .kmz ainda.</p>
      ) : (
        <div className="doc-list">
          {maps.map(r => (
            // Não é link: o navegador não renderiza .kmz — abrir a URL só
            // baixaria o arquivo. Quem desenha o traçado é o KmzViewerModal.
            // (div com role=button porque a linha já contém o menu de opções,
            // e <button> dentro de <button> é HTML inválido.)
            <div key={r.id} className="doc-row doc-row-action" role="button" tabIndex={0}
              onClick={() => onView(r)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onView(r) } }}>
              <span className="doc-ic"><Icon name="map" size={17} /></span>
              <span className="doc-info">
                <span className="doc-name">{resourceTitle(r)}</span>
                <span className="doc-sub">{resourceSub(r)}</span>
              </span>
              <Icon name="map" size={14} className="doc-open" />
              <ResourceMenu resource={r} onCopy={onCopy} onDelete={onDelete} canDelete={canDelete} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Materiais do projeto: documentos/links + imagens. Vive na Ficha técnica.
// (As anotações ficam no Panorama — são o texto que se mostra ao cliente.)
function ProjectAbout({ project, resources, canDelete, onCopyResource, onDeleteResource, onAddResource }) {
  const list = resources || []
  const aceitaKmz = TIPOS_COM_KMZ.includes(project.tipo)
  // Antes da coluna de mapas existir, um .kmz só podia ser anexado como
  // documento. ehArquivoKmz reconhece esses pela extensão para que apareçam
  // no mapa sem precisar reenviar o arquivo — e, quando o projeto não aceita
  // .kmz, eles seguem listados em Documentos para não sumirem da tela.
  const maps = aceitaKmz ? list.filter(ehArquivoKmz) : []
  const docs = list.filter(r => r.type === 'doc' && !(aceitaKmz && ehArquivoKmz(r)))
  const links = list.filter(r => r.type === 'link')
  const images = list.filter(r => r.type === 'image')
  // Recurso .kmz aberto no visualizador de mapa (null = fechado).
  const [viewing, setViewing] = React.useState(null)
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="res-grid">
        <DocsColumn docs={docs} onCopy={onCopyResource} onDelete={onDeleteResource} onAdd={onAddResource} canDelete={canDelete} />
        <LinksColumn links={links} onCopy={onCopyResource} onDelete={onDeleteResource} onAdd={onAddResource} canDelete={canDelete} />
        {aceitaKmz && <MapsColumn maps={maps} onCopy={onCopyResource} onDelete={onDeleteResource} onAdd={onAddResource} onView={setViewing} canDelete={canDelete} />}
      </div>
      {viewing && (
        <React.Suspense fallback={null}>
          <KmzViewerModal resource={viewing} onClose={() => setViewing(null)} />
        </React.Suspense>
      )}

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <h3 style={{ font: 'var(--text-h4)', margin: 0, color: 'var(--fg-1)' }}>Imagens</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="res-col-count">{images.length}</span>
            <ColAddButton label="Adicionar imagem" onClick={() => onAddResource('image')} />
          </div>
        </div>
        {images.length === 0 ? (
          <p className="res-col-empty">Nenhuma imagem ainda.</p>
        ) : (
          <div className="res-gallery">
            {images.map(r => (
              <a key={r.id} className="res-thumb" href={resourceUrl(r)} target="_blank" rel="noreferrer" title={r.label || r.filename || ''}>
                <img src={resourceUrl(r)} alt={r.label || r.filename || ''} loading="lazy" />
                {r.label && <span className="res-thumb-cap">{r.label}</span>}
                {canDelete && (
                  <button type="button" className="res-thumb-del"
                    title="Excluir imagem" aria-label="Excluir imagem"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteResource(r) }}>
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Ficha técnica — aba de trabalho da equipe: o detalhamento que sustenta o
// Panorama (identificação da obra, convênio, medições) e todos os materiais.
// A seção de identificação ainda não tem campos definidos; quando existirem,
// entram no mesmo padrão do bloco `tech-grid` abaixo.
export function ProjectTechSheet({ project, canEdit, onCopyResource, onDeleteResource, onAddResource }) {
  return (
    <div className="proj-tech">
      <div className="card tech-section">
        <div className="tech-section-head">
          <span className="fact-ic"><Icon name="file" size={18} /></span>
          <div>
            <h3>Identificação da obra</h3>
            <p>Dados contratuais e técnicos que não aparecem no Panorama.</p>
          </div>
        </div>
        <div className="tech-empty">
          <Icon name="sparkles" size={18} />
          <div>
            <strong>Campos ainda não definidos</strong>
            <p>Aqui entram os dados técnicos do convênio — número, processo, objeto,
              área de intervenção, contrapartida, vigência e responsabilidade técnica.
              Assim que a lista for fechada, eles passam a ser preenchidos no cadastro do projeto.</p>
          </div>
        </div>
      </div>

      <ProjectAbout project={project} resources={project.resources} canDelete={canEdit}
        onCopyResource={onCopyResource} onDeleteResource={onDeleteResource} onAddResource={onAddResource} />
    </div>
  )
}
