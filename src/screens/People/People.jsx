import './People.css'
import React from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, ClientSideRowModelModule, TextFilterModule, ValidationModule, themeQuartz } from 'ag-grid-community'
import { Avatar } from '../../components/primitives/primitives.jsx'
import { Icon } from '../../components/Icon.jsx'
import { taskMembers } from '../../data/store.js'

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
// núcleo. Nem a API da grade é registrada, porque a tela não chama nenhuma.
const modulos = [ClientSideRowModelModule, TextFilterModule]

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

function NoRowsOverlay() {
  return (
    <div className="empty">
      <div className="ic"><Icon name="users" size={26} stroke={1.9} /></div>
      <h3>Nenhum profissional cadastrado</h3>
      <p>Cadastre um profissional para vê-lo listado aqui.</p>
    </div>
  )
}

function NoMatchingRowsOverlay() {
  return (
    <div className="empty">
      <div className="ic"><Icon name="users" size={26} stroke={1.9} /></div>
      <h3>Nenhum profissional encontrado</h3>
      <p>Não há profissionais que combinem com os filtros aplicados.</p>
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
        <span className="people-name">{data.name}</span>
      </div>
    </div>
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

function AdminCell({ value }) {
  return value ? (
    <span className="people-badge admin">Admin</span>
  ) : (
    <span className="people-badge neutral">Não</span>
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
  // A linha inteira já abre a edição ao clicar (onRowClicked, mais abaixo);
  // stopPropagation aqui evita que um clique nesses botões dispare o clique
  // da linha por baixo — sobretudo o de excluir, que senão abriria os dois
  // modais em sequência.
  return (
    <div className="people-actions">
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

export function People({ users = [], projects = [], tasks = [], currentUserId = null, onNewPerson, onEditPerson, onDeletePerson }) {
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
        flex: 1.4,
        minWidth: 220,
        sort: 'asc',
      },
      {
        field: 'projectCount',
        headerName: 'Vínculo',
        cellRenderer: LinkCell,
        filter: false,
        floatingFilter: false,
        minWidth: 170,
        flex: 0.9,
      },
      {
        field: 'email',
        headerName: 'E-mail',
        valueFormatter: (p) => p.value || '—',
        flex: 1.2,
        minWidth: 200,
      },
      {
        field: 'sector',
        headerName: 'Setor',
        valueFormatter: (p) => p.value || '—',
        minWidth: 140,
        flex: 0.8,
      },
      {
        field: 'jobTitle',
        headerName: 'Cargo',
        valueFormatter: (p) => p.value || '—',
        minWidth: 140,
        flex: 0.9,
      },
      {
        field: 'isAdmin',
        headerName: 'Admin',
        cellDataType: 'text',
        cellRenderer: AdminCell,
        filterValueGetter: (p) => (p.data.isAdmin ? 'Admin' : 'Não'),
        minWidth: 100,
        maxWidth: 110,
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
        width: 88,
        maxWidth: 88,
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

  const handleRowClicked = React.useCallback((event) => {
    // Os botões de editar/excluir ficam dentro da própria linha; um clique
    // neles não deve também contar como "clique na linha" — senão excluir
    // abriria a edição por baixo do modal de confirmação.
    if (event.event?.target?.closest('button')) return
    onEditPerson?.(event.data)
  }, [onEditPerson])

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
        <div className="people-grid-wrap">
          <AgGridReact
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
            noMatchingRowsOverlayComponent={NoMatchingRowsOverlay}
          />
        </div>
      </div>
    </div>
  )
}
