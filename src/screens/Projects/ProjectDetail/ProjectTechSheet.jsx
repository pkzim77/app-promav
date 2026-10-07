import React from 'react'
import { Icon } from '../../../components/Icon.jsx'
import { useFecharFora } from '../../../components/primitives/primitives.jsx'
import { formatBytes, TIPOS_COM_KMZ, PROJECT_TYPE_MAP } from '../../../data/store.js'
import { api } from '../../../data/api.js'
import { ehArquivoKmz } from '../../../components/Modals/shared/kmzGeo.js'
import { ErrorBoundary, lazyComAviso } from '../../../components/ErrorBoundary.jsx'
// Carregados sob demanda: o visualizador arrasta o Leaflet junto (~150 KB) e
// só serve em projeto com .kmz — não faz sentido pesar a aba Arquivos dos
// demais tipos de obra.
const KmzViewerModal = lazyComAviso(() =>
  import('../../../components/Modals/KmzViewerModal.jsx').then(m => ({ default: m.KmzViewerModal }))
)
const KmzMapView = lazyComAviso(() =>
  import('../../../components/KmzMap/KmzMapView.jsx').then(m => ({ default: m.KmzMapView }))
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

// Separa os materiais do projeto por coluna. Fica fora dos componentes porque
// o mapa embutido (topo da aba) e a coluna "Mapas" (lista de materiais)
// precisam concordar sobre quais recursos são mapa.
//
// Antes da coluna de mapas existir, um .kmz só podia ser anexado como
// documento. ehArquivoKmz reconhece esses pela extensão para que apareçam no
// mapa sem precisar reenviar o arquivo — e, quando o projeto não aceita .kmz,
// eles seguem listados em Documentos para não sumirem da tela.
function separarRecursos(project) {
  const list = project.resources || []
  const aceitaKmz = TIPOS_COM_KMZ.includes(project.tipo)
  return {
    aceitaKmz,
    maps: aceitaKmz ? list.filter(ehArquivoKmz) : [],
    docs: list.filter(r => r.type === 'doc' && !(aceitaKmz && ehArquivoKmz(r))),
    links: list.filter(r => r.type === 'link'),
    images: list.filter(r => r.type === 'image'),
  }
}

// Menu de 3 pontinhos no canto de cada documento/link: copiar link ou excluir.
function ResourceMenu({ resource, onCopy, onDelete, canDelete = true }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  useFecharFora(ref, () => setOpen(false), open)
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

// Moldura comum das colunas de materiais: cabeçalho com ícone, título,
// contador e o "+", e o texto de vazio no lugar da lista quando não há nada.
function ResourceColumn({ icon, title, count, empty, addLabel, onAdd, style, children }) {
  return (
    <div className="res-col card" style={style}>
      <div className="res-col-head">
        {icon && <Icon name={icon} size={16} />}<h3>{title}</h3>
        <span className="rep-count res-col-count">{count}</span>
        <ColAddButton label={addLabel} onClick={onAdd} />
      </div>
      {count === 0 ? <p className="res-col-empty">{empty}</p> : children}
    </div>
  )
}

// Coluna de documentos: cada doc é uma linha com ícone + nome.
function DocsColumn({ docs, onCopy, onDelete, onAdd, canDelete }) {
  return (
    <ResourceColumn icon="file" title="Documentos" count={docs.length}
      empty="Nenhum documento ainda." addLabel="Adicionar documento" onAdd={() => onAdd('doc')}>
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
    </ResourceColumn>
  )
}

// Coluna de links/bookmarks: cada link é um cartão clicável.
function LinksColumn({ links, onCopy, onDelete, onAdd, canDelete }) {
  return (
    <ResourceColumn icon="link" title="Links" count={links.length}
      empty="Nenhum link ainda." addLabel="Adicionar link" onAdd={() => onAdd('link')}>
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
    </ResourceColumn>
  )
}

// Coluna de arquivos .kmz (área/trecho georreferenciado) — só aparece para
// projetos de piçarramento/pavimentação (ver TIPOS_COM_KMZ em store.js).
// Clicar numa linha mostra esse arquivo no mapa do topo da aba.
function MapsColumn({ maps, onCopy, onDelete, onAdd, onView, canDelete }) {
  return (
    <ResourceColumn icon="map" title="Mapas (.kmz)" count={maps.length}
      empty="Nenhum arquivo .kmz ainda." addLabel="Adicionar arquivo .kmz" onAdd={() => onAdd('kmz')}>
      <div className="doc-list">
        {maps.map(r => (
          // Não é link: o navegador não renderiza .kmz — abrir a URL só
          // baixaria o arquivo. Quem desenha o traçado é o mapa lá em cima.
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
    </ResourceColumn>
  )
}

// Materiais do projeto: documentos/links + imagens. Vive na aba Arquivos.
// (As anotações ficam no Panorama — são o texto que se mostra ao cliente.)
function ProjectAbout({ recursos, canDelete, onCopyResource, onDeleteResource, onAddResource, onViewMap }) {
  const { aceitaKmz, maps, docs, links, images } = recursos
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="res-grid">
        <DocsColumn docs={docs} onCopy={onCopyResource} onDelete={onDeleteResource} onAdd={onAddResource} canDelete={canDelete} />
        <LinksColumn links={links} onCopy={onCopyResource} onDelete={onDeleteResource} onAdd={onAddResource} canDelete={canDelete} />
        {aceitaKmz && <MapsColumn maps={maps} onCopy={onCopyResource} onDelete={onDeleteResource} onAdd={onAddResource} onView={onViewMap} canDelete={canDelete} />}
      </div>

      {/* Fora do `.res-grid`: a galeria ocupa a largura toda, então o card
          fica abaixo das colunas em vez de dividir a grade com elas. */}
      <ResourceColumn icon="image" title="Imagens" count={images.length} style={{ marginTop: 16 }}
        empty="Nenhuma imagem ainda." addLabel="Adicionar imagem" onAdd={() => onAddResource('image')}>
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
      </ResourceColumn>
    </div>
  )
}

// Mapa da obra, aberto já na entrada da aba — é a primeira coisa que quem vai
// a campo quer ver num piçarramento ou pavimentação: o traçado, o que já foi
// feito e o que falta. Antes o mapa só existia atrás de um clique na lista de
// materiais, num modal.
function MapaDaObra({ project, maps, ativo, onAtivar, canEdit, onAddResource, onEditSegments, onAmpliar }) {
  const atual = maps.find(m => m.id === ativo) || maps[0] || null
  const tipo = PROJECT_TYPE_MAP[project.tipo]?.label

  return (
    <div className="card tech-section tech-mapa" id="tech-mapa">
      <div className="tech-section-head">
        <span className="fact-ic"><Icon name="map" size={18} /></span>
        <div>
          <h3>Mapa da obra{tipo ? <span className="tech-mapa-tipo">{tipo}</span> : null}</h3>
          <p>Traçado do serviço e execução por trecho. Esta aba é da equipe — o cliente vê o Panorama.</p>
        </div>
        {atual && (
          <div className="tech-mapa-acoes">
            {canEdit && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onEditSegments}
                title="Registrar os metros já executados em cada trecho">
                <Icon name="pencil" size={14} />Lançar execução
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAmpliar(atual)}>
              <Icon name="externalLink" size={14} />Ampliar
            </button>
          </div>
        )}
      </div>

      {!atual ? (
        <div className="tech-empty">
          <Icon name="map" size={18} />
          <div>
            <strong>Nenhum traçado anexado</strong>
            <p>Anexe o .kmz do Google Earth com os trechos do serviço e o mapa aparece aqui,
              com a extensão de cada trecho já medida.</p>
            {/* Sem gate de canEdit, igual ao "+" da coluna Mapas: anexar material
                é CAN.light no servidor, liberado também a quem só visualiza. */}
            <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => onAddResource('kmz')}>
              <Icon name="plus" size={15} stroke={2.2} />Anexar .kmz
            </button>
          </div>
        </div>
      ) : (
        <>
          {maps.length > 1 && (
            <div className="tech-mapa-chips" role="tablist" aria-label="Arquivo exibido no mapa">
              {maps.map(m => (
                <button key={m.id} type="button" role="tab" aria-selected={m.id === atual.id}
                  className={'chip' + (m.id === atual.id ? ' active' : '')}
                  onClick={() => onAtivar(m.id)}>
                  {resourceTitle(m)}
                </button>
              ))}
            </div>
          )}
          <ErrorBoundary fallback={(erro) => <p className="kmz-msg kmz-msg-error">{erro.message || 'Não foi possível abrir o mapa.'}</p>}>
            <React.Suspense fallback={<p className="kmz-msg">Carregando o mapa…</p>}>
              <KmzMapView key={atual.id} resource={atual} equipe />
            </React.Suspense>
          </ErrorBoundary>
        </>
      )}
    </div>
  )
}

// Arquivos do projeto — documentos, links, imagens e, nos tipos com .kmz, o
// mapa da obra. Era a antiga Ficha técnica; os campos do convênio entram
// quando a lista deles for fechada.
export function ProjectTechSheet({ project, canEdit, onCopyResource, onDeleteResource, onAddResource, onEditSegments }) {
  const recursos = React.useMemo(() => separarRecursos(project), [project])
  // Qual .kmz está no mapa do topo (null = o primeiro) e qual está ampliado
  // no modal (null = nenhum).
  const [kmzAtivo, setKmzAtivo] = React.useState(null)
  const [ampliado, setAmpliado] = React.useState(null)

  // Clicar num arquivo na lista de materiais mostra-o no mapa lá em cima.
  const verNoMapa = (r) => {
    setKmzAtivo(r.id)
    document.getElementById('tech-mapa')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="proj-tech">
      {recursos.aceitaKmz && (
        <MapaDaObra project={project} maps={recursos.maps} ativo={kmzAtivo} onAtivar={setKmzAtivo}
          canEdit={canEdit} onAddResource={onAddResource} onEditSegments={onEditSegments} onAmpliar={setAmpliado} />
      )}

      <ProjectAbout recursos={recursos} canDelete={canEdit} onViewMap={verNoMapa}
        onCopyResource={onCopyResource} onDeleteResource={onDeleteResource} onAddResource={onAddResource} />

      {ampliado && (
        // Casca de scrim própria, no padrão dos modais de App.jsx: tanto o aviso
        // de carregamento quanto o erro do chunk aparecem sobre a tela, perto do
        // "Ampliar" (que fica no topo da aba) — como filho solto de .proj-tech o
        // texto nascia no pé da página. E `onReset` limpa `ampliado`, senão o erro
        // ficava sem como fechar, já que o KmzViewerModal (dono do onClose) nem
        // chegou a montar.
        <ErrorBoundary onReset={() => setAmpliado(null)}
          fallback={(erro, reset) => (
            <div className="scrim" onMouseDown={reset}>
              <div className="modal" style={{ padding: 24, textAlign: 'center' }}>
                <p>{erro.message || 'Não foi possível abrir o mapa.'}</p>
                <button type="button" className="btn btn-primary" onClick={reset}>Fechar</button>
              </div>
            </div>
          )}>
          <React.Suspense fallback={(
            <div className="scrim">
              <div className="modal" style={{ padding: 24, textAlign: 'center' }}>
                <p style={{ margin: 0, color: 'var(--fg-3)' }}>Abrindo o mapa…</p>
              </div>
            </div>
          )}>
            <KmzViewerModal resource={ampliado} onClose={() => setAmpliado(null)} />
          </React.Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
