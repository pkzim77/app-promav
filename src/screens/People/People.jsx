import './People.css'
import React from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, ClientSideRowModelModule, TextFilterModule, RenderApiModule, ValidationModule, themeQuartz } from 'ag-grid-community'
import { Avatar } from '../../components/primitives/primitives.jsx'
import { Icon } from '../../components/Icon.jsx'
import { taskMembers, sectorLabel } from '../../data/store.js'

// Só os módulos que esta tela usa. AllCommunityModule agrega 44 — trazia
// paginação, exportação CSV, todos os editores de célula, os filtros de data
// e número, row model infinito... nada disso aparece aqui, e o pedaço da tela
// ficava maior que o app inteiro.
//
//   ClientSideRowModel → rowData local; já traz a ordenação (sortable/sort)
//   TextFilter         → agTextColumnFilter + o floating filter do cabeçalho,
//                        e o FilterValue de que o filterValueGetter depende
//
// Redimensionar e fixar coluna (resizable, pinned) não são módulos: vêm no
// núcleo.
//   RenderApi → api.refreshCells(), usado para forçar o redesenho do avatar
//               quando só a cor/iniciais mudam (o campo da coluna, `name`,
//               continua igual e o grid não percebe sozinho).
const modulos = [ClientSideRowModelModule, TextFilterModule, RenderApiModule]

// Em desenvolvimento, o ValidationModule troca falhas silenciosas por uma
// mensagem dizendo qual módulo falta. Em produção ele sai no build.
if (import.meta.env.DEV) modulos.push(ValidationModule)

ModuleRegistry.registerModules(modulos)

// Cores espelhadas de src/styles/tokens.css — a Theming API do AG Grid não lê
// custom properties, então os valores precisam ser mantidos em sincronia à mão.
const peopleGridTheme = themeQuartz.withParams({
  accentColor: '#8C7B58',
  backgroundColor: '#FFFFFF',
  foregroundColor: '#16150F',
  borderColor: '#E4DED1',
  headerBackgroundColor: '#FFFFFF',
  headerTextColor: '#A79E89',
  headerFontWeight: 700,
  oddRowBackgroundColor: 'transparent',
  rowHoverColor: '#F6F4EF',
  fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: 14,
  headerFontSize: 11,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowBorder: true,
  columnBorder: false,
  cellHorizontalPadding: 14,
  spacing: 8,
})

// O AG Grid tem UM só overlay de lista vazia. Havia aqui um segundo
// componente ligado em `noMatchingRowsOverlayComponent`, propriedade que não
// existe — era descartada em silêncio, e filtrar até zerar mostrava "Nenhum
// profissional cadastrado · Cadastre um profissional" numa lista que tinha
// dezenas de cadastros. Quem separa os dois casos agora é o componente: se a
// grade TEM linhas e mesmo assim está vazia, quem esvaziou foi o filtro.
function NoRowsOverlay({ total }) {
  const semCadastro = !total
  return (
    <div className="empty">
      <div className="ic"><Icon name="users" size={26} stroke={1.9} /></div>
      <h3>{semCadastro ? 'Nenhum profissional cadastrado' : 'Nenhum profissional encontrado'}</h3>
      <p>{semCadastro
        ? 'Cadastre um profissional para vê-lo listado aqui.'
        : 'Não há profissionais que combinem com os filtros aplicados.'}</p>
    </div>
  )
}

function formatStatus(active) {
  return active === false ? 'Inativo' : 'Ativo'
}

function PersonCell({ data }) {
  return (
    <div className="people-person">
      <Avatar user={data} size={34} />
      <div className="people-person-meta">
        <span className="people-name">{data.shortName || data.name}</span>
      </div>
    </div>
  )
}

// Telefone é salvo mascarado — "(88) 99958-6683" — e sem código de país. O
// wa.me precisa só de dígitos com o 55 na frente (DDD já vem nos primeiros 2).
function linkWhatsApp(phone) {
  const digitos = String(phone || '').replace(/\D/g, '')
  if (!digitos) return null
  return `https://wa.me/55${digitos}`
}

function WhatsAppIcon({ size = 15 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.79.47 3.47 1.29 4.93L2 22l5.28-1.38a9.87 9.87 0 0 0 4.76 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m0 1.67c2.24 0 4.35.87 5.94 2.46a8.24 8.24 0 0 1 2.43 5.87c0 4.57-3.72 8.3-8.31 8.3a8.3 8.3 0 0 1-4.2-1.15l-.3-.18-3.13.82.84-3.05-.2-.31a8.23 8.23 0 0 1-1.27-4.42c0-4.58 3.72-8.34 8.2-8.34M8.53 6.7c-.16 0-.42.06-.64.31-.22.25-.85.83-.85 2.03 0 1.19.87 2.35 1 2.51.13.17 1.7 2.71 4.2 3.7 2.08.83 2.5.66 2.95.62.45-.04 1.45-.59 1.66-1.16.2-.57.2-1.06.14-1.16-.06-.1-.23-.16-.48-.28-.25-.13-1.45-.72-1.68-.8-.22-.08-.39-.13-.55.13-.16.25-.63.8-.77.97-.14.16-.29.18-.53.06-.25-.13-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.39-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.44.12-.14.16-.25.24-.41.08-.17.04-.31-.02-.44-.06-.13-.55-1.36-.76-1.86-.2-.48-.4-.42-.55-.42Z" />
    </svg>
  )
}

function LinkCell({ data }) {
  return (
    <div className="people-summary">
      <strong>{data.projectCount}</strong> projeto{data.projectCount === 1 ? '' : 's'}
      <span> · </span>
      <strong>{data.openActivities}</strong> em aberto
    </div>
  )
}

// Vínculo é o laço de trabalho — interno ou terceirizado. Antes esta coluna
// se chamava "Terceirizado" e respondia Sim/Não; "Vínculo" estava em cima do
// número de projetos, que é alocação, não vínculo.
function VinculoCell({ value }) {
  return value ? (
    <span className="people-badge terc">Terceirizado</span>
  ) : (
    <span className="people-badge neutral">Interno</span>
  )
}

function StatusCell({ value }) {
  return (
    <span className={'people-status ' + (value === false ? 'inactive' : 'active')}>
      <span className="dot" />
      {formatStatus(value)}
    </span>
  )
}

function ActionsCell({ data, context }) {
  const { onEditPerson, onDeletePerson, currentUserId } = context
  const isSelf = data.id === currentUserId
  const whatsapp = linkWhatsApp(data.phone)
  // A linha inteira já abre a edição ao clicar (onRowClicked, mais abaixo);
  // stopPropagation aqui evita que um clique nesses botões dispare o clique
  // da linha por baixo — sobretudo o de excluir, que senão abriria os dois
  // modais em sequência.
  return (
    <div className="people-actions">
      {whatsapp && (
        <a className="btn-icon whatsapp" href={whatsapp} target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()} aria-label={`Chamar ${data.name} no WhatsApp`} title="Abrir no WhatsApp">
          <WhatsAppIcon />
        </a>
      )}
      {onEditPerson && (
        <button type="button" className="btn-icon" onClick={(e) => { e.stopPropagation(); onEditPerson(data) }} aria-label={`Editar ${data.name}`} title="Editar profissional">
          <Icon name="pencil" size={15} />
        </button>
      )}
      {onDeletePerson && !isSelf && (
        <button type="button" className="btn-icon danger" onClick={(e) => { e.stopPropagation(); onDeletePerson(data) }} aria-label={`Excluir ${data.name}`} title="Excluir profissional">
          <Icon name="trash" size={15} />
        </button>
      )}
    </div>
  )
}

export function People({ users = [], projects = [], tasks = [], currentUserId = null, onNewPerson, onOpenPerson, onEditPerson, onDeletePerson }) {
  const gridRef = React.useRef(null)
  const gridWrapRef = React.useRef(null)
  // A coluna "Profissional" mostra o Avatar (cor/iniciais), mas o campo dela é
  // `name` — o AG Grid só re-renderiza uma célula quando o VALOR do campo
  // muda, então trocar só a cor não disparava o refresh sozinho. Força aqui.
  React.useEffect(() => {
    gridRef.current?.api?.refreshCells({ columns: ['name'], force: true })
  }, [users])

  // A tabela tem mais colunas do que cabem na tela; em vez de exigir a barra
  // de rolagem horizontal (ou shift+scroll), o giro vertical do mouse sobre
  // a grade rola ela pro lado. `.ag-body-horizontal-scroll-viewport` é o
  // elemento com a scrollbar horizontal de verdade — o AG Grid sincroniza
  // cabeçalho e corpo a partir dela.
  React.useEffect(() => {
    const wrap = gridWrapRef.current
    if (!wrap) return
    const onWheel = (e) => {
      const scroller = wrap.querySelector('.ag-body-horizontal-scroll-viewport')
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // já é gesto horizontal (trackpad) — deixa passar
      e.preventDefault()
      scroller.scrollLeft += e.deltaY
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  const getUserSummary = (user) => {
    const projectIds = new Set()
    const openActivities = tasks.filter((task) => {
      const involved = taskMembers(task).includes(user.id)
      const open = task.status !== 'done'
      if (involved && open) {
        projectIds.add(task.projectId)
        return true
      }
      return false
    }).length

    projects.forEach((project) => {
      const memberMatch = (project.members || []).some((member) => member.userId === user.id)
      const responsibleMatch = (project.responsibleIds || []).includes(user.id)
      if (memberMatch || responsibleMatch) {
        projectIds.add(project.id)
      }
    })

    return {
      projectCount: projectIds.size,
      openActivities,
    }
  }

  const people = users.map((user) => ({ ...user, ...getUserSummary(user) }))

  // As referências de onEditPerson/onDeletePerson podem mudar a cada render do
  // componente pai. Colocá-las em `context` (em vez de como dependência do
  // useMemo abaixo) mantém `columnDefs` estável — se o array de colunas
  // mudasse de referência a cada render, o AG Grid reaplicaria os defaults e
  // desfaria qualquer reordenação/redimensionamento manual feito pelo usuário.
  const gridContext = React.useMemo(
    () => ({ onEditPerson, onDeletePerson, currentUserId }),
    [onEditPerson, onDeletePerson, currentUserId],
  )

  const columnDefs = React.useMemo(() => {
    const cols = [
      {
        field: 'name',
        headerName: 'Profissional',
        cellRenderer: PersonCell,
        pinned: 'left',
        flex: 1.4,
        minWidth: 220,
        sort: 'asc',
      },
      {
        field: 'projectCount',
        headerName: 'Alocação',
        cellRenderer: LinkCell,
        filter: false,
        floatingFilter: false,
        minWidth: 120,
        flex: 0.9,
      },
      {
        field: 'isOutsourced',
        headerName: 'Vínculo',
        cellDataType: 'text',
        cellRenderer: VinculoCell,
        filterValueGetter: (p) => (p.data.isOutsourced ? 'Terceirizado' : 'Interno'),
        minWidth: 130,
        maxWidth: 150,
      },
      // E-mail, telefone, registro e administrador saíram daqui para a ficha:
      // eram dez colunas numa tabela que já precisava de um truque de rolagem
      // horizontal para caber na tela.
      {
        field: 'sector',
        headerName: 'Setor',
        valueFormatter: (p) => sectorLabel(p.value) || '—',
        minWidth: 145,
        flex: 1.2,
      },
      {
        field: 'jobTitle',
        headerName: 'Cargo',
        valueFormatter: (p) => p.value || '—',
        minWidth: 130,
        flex: 0.7,
      },
      {
        field: 'isActive',
        headerName: 'Situação',
        cellDataType: 'text',
        cellRenderer: StatusCell,
        filterValueGetter: (p) => (p.data.isActive === false ? 'Inativo' : 'Ativo'),
        minWidth: 120,
        maxWidth: 140,
      },
    ]

    if (onEditPerson || onDeletePerson) {
      cols.push({
        colId: 'actions',
        headerName: '',
        sortable: false,
        resizable: false,
        suppressMovable: true,
        filter: false,
        floatingFilter: false,
        pinned: 'right',
        width: 128,
        maxWidth: 128,
        cellRenderer: ActionsCell,
      })
    }

    return cols
  }, [Boolean(onEditPerson), Boolean(onDeletePerson)])

  const defaultColDef = React.useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    filterParams: { buttons: ['reset'] },
  }), [])

  // O overlay precisa saber quantos profissionais existem para distinguir
  // "não há cadastro" de "o filtro não achou nada".
  const noRowsParams = React.useMemo(() => ({ total: people.length }), [people.length])

  const handleRowClicked = React.useCallback((event) => {
    // Os botões de editar/excluir ficam dentro da própria linha; um clique
    // neles não deve também contar como "clique na linha" — senão excluir
    // abriria a edição por baixo do modal de confirmação.
    if (event.event?.target?.closest('button')) return
    onOpenPerson?.(event.data)
  }, [onOpenPerson])

  return (
    <div className="page">
      <div className="sec-head">
        <div>
          <h2>Profissionais</h2>
          <div className="sub">Lista de profissionais cadastrados no sistema.</div>
        </div>
        {onNewPerson && (
          <button className="btn btn-primary" onClick={onNewPerson}>
            <Icon name="plus" size={17} stroke={2.2} />Novo profissional
          </button>
        )}
      </div>

      <div className="card people-card">
        <div className="people-grid-wrap" ref={gridWrapRef}>
          <AgGridReact
            ref={gridRef}
            theme={peopleGridTheme}
            rowData={people}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            context={gridContext}
            onRowClicked={handleRowClicked}
            getRowId={(params) => params.data.id}
            domLayout="autoHeight"
            rowHeight={58}
            headerHeight={40}
            noRowsOverlayComponent={NoRowsOverlay}
            noRowsOverlayComponentParams={noRowsParams}
          />
        </div>
      </div>
    </div>
  )
}
