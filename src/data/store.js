// ============================================================
// Promav — shared store (single source of truth)
// Seed data for users, projects, tasks + helpers. Imported by
// every screen so they read/write the same data shape.
// ============================================================

import { progressoExecutado } from './progresso.js'

export const PROJECT_COLORS = {
  indigo: 'var(--proj-indigo)', blue: 'var(--proj-blue)', teal: 'var(--proj-teal)',
  green: 'var(--proj-green)', amber: 'var(--proj-amber)', coral: 'var(--proj-coral)',
  pink: 'var(--proj-pink)', purple: 'var(--proj-purple)',
}
// Espelha os tokens --proj-* (tons terrosos da paleta "Taupe & Ink").
export const PROJECT_HEX = {
  indigo: '#6E6A9B', blue: '#5A7695', teal: '#4C7F78', green: '#7E8A4C',
  amber: '#C0912E', coral: '#B0603F', pink: '#B0757F', purple: '#8A6690',
}

// Paleta de cores do avatar das pessoas: mais ampla que a de projetos e sem
// chave — o que se salva é o hex puro (ver PeopleModal), não um id de mapa.
export const AVATAR_COLORS = [
  ...Object.values(PROJECT_HEX),
  '#A98B3E', // mostarda
]

export const STATUSES = [
  { id: 'todo',     label: 'A fazer',      color: 'var(--status-todo)',     soft: 'var(--status-todo-soft)',     text: '#5c5c78' },
  { id: 'progress', label: 'Em andamento', color: 'var(--status-progress)', soft: 'var(--status-progress-soft)', text: '#1f64cc' },
  { id: 'review',    label: 'Em revisão',    color: 'var(--status-review)',    soft: 'var(--status-review-soft)',    text: '#6b4a73' },
  { id: 'diligence', label: 'Em diligência', color: 'var(--status-diligence)', soft: 'var(--status-diligence-soft)', text: '#8a4a2e' },
  { id: 'done',     label: 'Concluído',    color: 'var(--status-done)',     soft: 'var(--status-done-soft)',     text: '#157a49' },
]
export const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]))

// Estado de um ITEM do checklist. Os mesmos da etapa, menos 'Em andamento':
// o item é a menor unidade de trabalho e não se divide em meio-feito — quem
// está no meio do serviço deixa pendente. As cores vêm de STATUS_MAP, para o
// mesmo estado nunca ter duas cores na mesma tela.
export const CHECK_STATES = [
  { id: 'todo',      label: 'Pendente' },
  { id: 'review',    label: 'Em revisão' },
  { id: 'diligence', label: 'Em diligência' },
  { id: 'done',      label: 'Concluído' },
]

// O estado de um item aceitando o formato antigo, que só tinha `done`.
export const estadoDoItem = (item) => item?.state || (item?.done ? 'done' : 'todo')

export const PRIORITIES = [
  { id: 'low',    label: 'Baixa', color: 'var(--prio-low)',    hex: '#7B8794', soft: 'var(--prio-low-soft)',    text: '#5a6470' },
  { id: 'medium', label: 'Média', color: 'var(--prio-medium)', hex: '#E8920C', soft: 'var(--prio-medium-soft)', text: '#a8680a' },
  { id: 'high',   label: 'Alta',  color: 'var(--prio-high)',   hex: '#E5484D', soft: 'var(--prio-high-soft)',   text: '#c5333a' },
]
export const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map(p => [p.id, p]))

// ---------- ficha do projeto (dados do convênio) ----------
// Origem do recurso do convênio (espelha o backend).
export const RESOURCE_ORIGINS = [
  { id: 'federal',   label: 'Governo Federal' },
  { id: 'estadual',  label: 'Governo Estadual' },
  { id: 'municipal', label: 'Prefeitura (recurso próprio)' },
  { id: 'emenda',    label: 'Emenda parlamentar' },
  { id: 'outro',     label: 'Outro' },
]
export const RESOURCE_ORIGIN_MAP = Object.fromEntries(RESOURCE_ORIGINS.map(o => [o.id, o]))

// Prefeituras atendidas e secretarias que aparecem no cadastro do projeto.
// São o texto gravado, não um id: a coluna do banco é text livre e continua
// aceitando qualquer valor, então nada do que já foi digitado se perde — o
// modal reaproveita o valor antigo como opção do seletor (ver canonizar()).
export const PREFEITURAS = ['UMARI', 'MOMBAÇA']

// Órgãos da prefeitura, com o nome INTEIRO como eles se chamam — inclusive os
// que não são secretaria (Controladoria, Procuradoria). A lista anterior usava
// nomes curtos e a tela completava com "Secretaria de " na frente, o que agora
// produziria "Secretaria de Controladoria Geral do Município".
//
// O que já está gravado num projeto continua aparecendo no seletor mesmo fora
// desta lista (opcoesCom, no ProjectModal), então trocar a lista não apaga o
// valor de projeto nenhum.
export const SECRETARIAS = [
  'Controladoria Geral do Município',
  'Procuradoria Geral do Município',
  'Sec. de Orçamento e Finanças',
  'Sec. de Saúde',
  'Sec. Municipal da Cultura e Turismo',
  'Sec. Municipal da Mulher',
  'Sec. Municipal de Administração',
  'Sec. Municipal de Agricultura e Pecuária',
  'Sec. Municipal de Desenvolvimento Social',
  'Sec. Municipal de Desenvolvimento Econômico, Tecnologia e Inovações',
  'Sec. Municipal de Educação',
  'Sec. Municipal de Esporte e Juventude',
  'Sec. Municipal de Governo',
  'Sec. Municipal de Meio Ambiente e Sustentabilidade',
  'Sec. Municipal de Obras e Infraestrutura',
  'Sec. Municipal de Segurança e Ordem Púbica',
]

// Contas de manutenção do sistema (users.is_dev) e profissionais inativos
// (users.isActive === false) ficam fora de toda lista onde se escolhe gente
// para trabalhar. Continuam visíveis onde só se EXIBE quem já está num
// registro — o avatar de um responsável antigo não pode virar "?" porque a
// conta saiu das listas.
//
// Passe em `jaVinculados` quem o registro aberto já aponta (responsável atual,
// membros, destinatários). Sem isso, o seletor abriria sem a opção que está
// gravada e o próximo "salvar" trocaria a pessoa sem ninguém pedir.
export const paraAtribuir = (users = [], ...jaVinculados) => {
  const manter = new Set(jaVinculados.flat().filter(Boolean))
  return users.filter(u => (!u.isDev && u.isActive !== false) || manter.has(u.id))
}

// Compara ignorando caixa e acento, para "Umari" (digitado quando o campo era
// texto) reconhecer o "UMARI" da lista em vez de virar uma opção duplicada.
const chaveTexto = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
export const canonizar = (lista, valor) => lista.find(o => chaveTexto(o) === chaveTexto(valor)) || valor || ''

// Status geral do projeto (diferente do status das atividades).
// Tons da identidade PROMAV, escurecidos até passarem 4.5:1 como TEXTO sobre
// fundo claro — o selo pinta a própria cor sobre um véu dela mesma, então o
// dourado #AD8A5C puro (3,12:1) não serviria aqui, só como preenchimento.
//
// A lista está em ordem de criticidade e a cor sobe junto, para o selo ser lido
// pela cor antes da palavra: um matiz por significado, e não sete variações do
// mesmo marrom.
//
// A paleta anterior tinha quatro dos sete tons na família quente e falhava de
// duas maneiras, ambas medidas:
//
//   • "Em andamento" e "Pendente" ficavam a ΔE 19 — a mesma tarja, de relance.
//   • "Em andamento" e "Paralisado" ficavam a ΔE 5 para quem tem deuteranopia,
//     ou seja, indistinguíveis.
//
// E os contrastes anotados eram contra BRANCO PURO, mas o selo pinta a cor como
// texto sobre um véu de 12% dela mesma (ProjectCover: `background: cor + 1f`).
// Contra o fundo real, "Em andamento" dava 4,28:1 — abaixo do mínimo que o
// comentário dizia garantir. Os números abaixo são contra o véu.
//
// Agora: pior par ΔE 37, pior par com deuteranopia ΔE 15, mínimo 4,65:1. L*
// entre 36 e 52 em todos — mais escuro que isso a cor deixa de ser lida como a
// cor dela e vira "quase preto", que é o oposto de evidente.
//
// Cor não carrega o significado sozinha: o selo sempre traz o rótulo escrito.
export const PROJECT_STATUSES = [
  { id: 'planejamento', label: 'Planejamento',  color: '#6A6562' }, // cinza-taupe · 4,88:1 · nada em execução ainda
  { id: 'andamento',    label: 'Em andamento',  color: '#1F6CA3' }, // azul · 4,75:1 · em execução
  { id: 'revisao',      label: 'Em revisão',    color: '#7A44C5' }, // violeta · 5,08:1 · em análise, sem pendência
  { id: 'pendente',     label: 'Pendente',      color: '#6D5212' }, // ouro escuro · 6,10:1 · parado aguardando providência
  { id: 'diligencia',   label: 'Em diligência', color: '#AE4804' }, // laranja · 4,72:1 · exigência do órgão, tem prazo
  { id: 'paralisado',   label: 'Paralisado',    color: '#C52645' }, // carmim · 4,65:1 · execução interrompida
  { id: 'concluido',    label: 'Concluído',     color: '#177242' }, // verde · 5,01:1 · encerrado
]
export const PROJECT_STATUS_MAP = Object.fromEntries(PROJECT_STATUSES.map(s => [s.id, s]))

// ---------- nome do projeto ----------
// A equipe nomeia o projeto como um código: "260103_REF._ESC. JOSÉ MARQUES DE
// SOUSA_NOVA UNIÃO" — data (AAMMNN), tipo de obra, nome e um complemento
// (localidade ou nº do convênio). São até 62 caracteres, que como <h1> cru
// ocupam duas linhas e escondem o que interessa.
//
// Aqui isso vira partes, só para EXIBIR: o nome no banco não muda, a busca
// continua encontrando pelo código, e quem não segue o padrão (11 dos 36)
// aparece inteiro no título, sem chips.
const PADRAO_NOME = /^(\d{6})_(.+)$/

export function partesDoProjeto(nome = '') {
  const m = PADRAO_NOME.exec(String(nome).trim())
  if (!m) return { codigo: null, tipo: null, titulo: nome, complemento: null }
  const [, codigo, resto] = m

  // Sem mais nenhum "_", o que sobra é o nome inteiro — caso de
  // "260502_SINALIZE", que tem código mas nem tipo nem complemento.
  const primeiro = resto.indexOf('_')
  if (primeiro < 0) return { codigo, tipo: null, titulo: resto, complemento: null }

  const tipo = resto.slice(0, primeiro)
  const semTipo = resto.slice(primeiro + 1)
  // O complemento é o ÚLTIMO trecho: o nome do meio pode conter "_", então
  // quebramos pela direita, não pela esquerda.
  const ultimo = semTipo.lastIndexOf('_')
  return {
    codigo,
    tipo: tipo.replace(/\.$/, ''),                     // "REF." → "REF"
    titulo: ultimo > 0 ? semTipo.slice(0, ultimo) : semTipo,
    complemento: ultimo > 0 ? semTipo.slice(ultimo + 1) : null,
  }
}

// "260103" → "01/26". O código é AAMMNN: ano, mês e sequência.
export function dataDoCodigo(codigo) {
  if (!codigo || codigo.length !== 6) return null
  return `${codigo.slice(2, 4)}/${codigo.slice(0, 2)}`
}

// ---------- etapas do processo ----------
// O caminho que todo projeto percorre, do levantamento à licitação. A equipe
// já vinha recriando esta lista à mão em cada projeto — o que gerou etapas
// duplicadas. O título gravado é "<i> · <nome>", e é esse padrão que a aba
// Etapas lê para agrupar. A mesma lista existe em server/index.js, que é quem
// cria as etapas; mexeu aqui, mexa lá.
export const ETAPAS_PADRAO = [
  'Contratação direta', 'Levantamento', 'Projetos', 'Orçamento',
  'Relatório fotográfico', 'ART e documentos', 'Licença ambiental',
  'Projeto básico', 'Protocolos', 'Diligências', 'Licitação',
]
export const tituloDaEtapa = (i) => `${i} · ${ETAPAS_PADRAO[i]}`

// "2 · Projetos" → { n: 2, nome: 'Projetos' }. O separador é o ponto médio.
export const PADRAO_ETAPA = /^(\d+)\s*·\s*(.+)$/

// As etapas de um projeto, em ordem, para os seletores. Etapa duplicada entra
// uma vez só — duas opções idênticas num <select> não ajudam ninguém a
// escolher, e ainda esconderiam qual das cópias receberia o item.
export function etapasDoProjeto(tasks = [], projectId) {
  const vistas = new Map()
  for (const t of tasks) {
    if (t.projectId !== projectId) continue
    const m = PADRAO_ETAPA.exec(t.title || '')
    if (!m) continue
    const n = Number(m[1])
    if (!vistas.has(n)) vistas.set(n, { id: t.id, n, label: t.title, task: t })
  }
  return [...vistas.values()].sort((a, b) => a.n - b.n)
}

//CARGOS
// Sementes para a sugestão do campo de cargo, que é texto livre. Orçamentista,
// Coordenação e Direção eram SETORES até esta versão — e era justamente isso
// que impedia o CREA de aparecer para eles: nenhum é uma área, os três são
// cargos dentro de Engenharia.
//
// Cargo não é formação. "Projetos Prediais" e "Estagiário de TI" são cargos
// reais no cadastro e não cabem em nenhum diploma; a formação, logo abaixo, é
// que diz qual conselho a pessoa tem.
export const CARGOS = [
  {id: 'Arquitetura', label: 'Arquitetura'},
  {id: 'Projetos Prediais', label: 'Projetos Prediais'},
  {id: 'Orçamentista', label: 'Orçamentista'},
  {id: 'Coordenação', label: 'Coordenação'},
  {id: 'Direção', label: 'Direção'},
  {id: 'Estagiário', label: 'Estagiário'},
  {id: 'TI', label: 'TI'}
]

// Formação profissional da pessoa (users.formation). É o diploma, não o que a
// pessoa faz: é daqui que sai o conselho, porque o conselho segue a formação.
export const FORMACOES = [
  { id: 'sistemas-informacao', label: 'Sistemas de Informação' },
  { id: 'arquitetura',         label: 'Arquitetura' },
  { id: 'engenharia-civil',    label: 'Engenharia Civil' },
  { id: 'engenharia-eletrica', label: 'Engenharia Elétrica' },
]
export const FORMACAO_MAP = Object.fromEntries(FORMACOES.map(f => [f.id, f]))
export const formacaoLabel = (id) => FORMACAO_MAP[id]?.label || null

// Conselho profissional: CREA para engenharia, CAU para arquitetura.
//
// Três fontes, da mais precisa para a menos. A FORMAÇÃO manda, porque o
// conselho é dela: o arquiteto que trabalha no setor de Engenharia tem CAU, e
// quem é de Engenharia Elétrica tem CREA sem que o setor precise dizer nada.
// O setor entra quando a formação está em branco (a maioria do cadastro hoje),
// e o cargo é o último recurso.
export const FORMACAO_CONSELHO = {
  'arquitetura': 'CAU',
  'engenharia-civil': 'CREA',
  'engenharia-eletrica': 'CREA',
}

export const SETOR_CONSELHO = {
  'Engenharia': 'CREA',
  'Arquitetura': 'CAU',
}

// O cargo virou texto livre, então a comparação ignora caixa e acento:
// "arquitetura" e "Arquitetura" são o mesmo cargo para quem digitou com pressa.
export const CARGO_CONSELHO = {
  'Arquitetura': 'CAU',
  'Projetos Prediais': 'CREA',
}

export const YES_NO_OPTIONS = [
  {id: 'sim', label: 'Sim'},
  {id: 'não', label: 'Não'}
]

const CARGO_CONSELHO_POR_CHAVE = Object.fromEntries(
  Object.entries(CARGO_CONSELHO).map(([cargo, conselho]) => [chaveTexto(cargo), conselho]))

export const conselhoDaFormacao = (formacao) => FORMACAO_CONSELHO[formacao] || null
export const conselhoDoSetor = (setor) => SETOR_CONSELHO[setor] || null
export const conselhoDoCargo = (cargo) => CARGO_CONSELHO_POR_CHAVE[chaveTexto(cargo)] || null

// A regra completa. Recebe a pessoa (ou o rascunho dela no formulário) em vez
// de três argumentos soltos: na ordem errada eles se trocam sem erro nenhum.
//
// Sistemas de Informação é formação SEM conselho, e isso precisa vencer o setor:
// quem tem esse diploma no setor Engenharia não tem CREA. Por isso a checagem é
// "tem formação conhecida?", não "a formação deu conselho?".
//
// Formação que não está na lista conta como formação em branco, e não como
// "sem conselho": valor estranho vindo do banco cai no setor em vez de sumir
// com o campo de registro. O servidor faz a mesma coisa (normFormacao).
export const conselhoDe = ({ formation = null, sector = null, jobTitle = null } = {}) =>
  (FORMACAO_MAP[formation] ? conselhoDaFormacao(formation) : conselhoDoSetor(sector) || conselhoDoCargo(jobTitle))


// ---------- mudanças do projeto (orientações) ----------
// Setores da PROMAV: as três ÁREAS que existem na empresa. Cada usuário
// pertence a uma (users.sector); é isso que faz "destinatário: Engenharia"
// resolver para pessoas de verdade. O conselho sai da FORMAÇÃO; o setor só
// responde por ele em quem ainda não tem formação preenchida.
//
// A lista tinha seis e quatro deles eram cargo, não área — Orçamento,
// Coordenação, Direção e Estágio. Com isso o orçamentista, que é engenheiro,
// ficava num "setor" sem conselho e nunca via o campo de CREA. Quem diferencia
// as pessoas dentro da área é o CARGO.
export const SECTORS = [
  { id: 'Engenharia',  label: 'Engenharia' },
  { id: 'Arquitetura', label: 'Arquitetura' },
  { id: 'TI',          label: 'TI' },
]
export const SECTOR_MAP = Object.fromEntries(SECTORS.map(s => [s.id, s]))
export const sectorLabel = (id) => SECTOR_MAP[id]?.label || null

// Tipo da mudança. Requisição obriga; sugestão é proposta e só vira trabalho
// depois de aceita — por isso ela nasce sem atividade no quadro.
export const CHANGE_KINDS = [
  { id: 'requisicao', label: 'Requisição', hint: 'Precisa ser feito' },
  { id: 'sugestao',   label: 'Sugestão',   hint: 'Proposta, pode ser recusada' },
]
export const CHANGE_KIND_MAP = Object.fromEntries(CHANGE_KINDS.map(k => [k.id, k]))

// Tipos de notificação do sino. A cor é a identidade do tipo: aparece no chip
// do filtro e na borda/selo do card, sempre o mesmo valor nos dois lugares.
// Em hex, e não em var(), porque o código monta o fundo suave concatenando
// alpha ('1a') — mexeu aqui, mexa no token correspondente em tokens.css.
//
// Requisição e Sugestão espelham --kind-* : quem manda é o selo do cartão da
// mudança, para o mesmo tipo não ter duas cores no app.
//
// Os outros três são os --proj-* correspondentes escurecidos: o texto do chip
// tem 11px sobre o próprio fundo a 10% de alpha, e nos tons originais o
// contraste ficava em 4,0–4,2:1, abaixo do mínimo AA (4,5:1). Assim o conjunto
// fica entre 4,9 e 5,8:1. O teal ainda ganhou saturação, senão escurecer o
// aproximava demais do cinza da Sugestão.
//
// Se mexer numa cor, refaça DUAS contas: o contraste (o fundo do chip
// acompanha a cor do texto) e a distância para as outras quatro.
export const NOTIF_KINDS = [
  { id: 'requisicao', label: 'Requisição', color: '#276B46' }, // verde  (--kind-requisicao)
  { id: 'sugestao',   label: 'Sugestão',   color: '#5F5C56' }, // cinza  (--kind-sugestao)
  { id: 'ciencia',    label: 'Ciência',    color: '#3C6F68' }, // verde-azulado (--proj-teal   escurecido)
  { id: 'atividade',  label: 'Atividade',  color: '#506985' }, // azul-ardósia  (--proj-blue   escurecido)
  { id: 'projeto',    label: 'Projeto',    color: '#7C5C82' }, // ameixa        (--proj-purple escurecido)
]
export const NOTIF_KIND_MAP = Object.fromEntries(NOTIF_KINDS.map(k => [k.id, k]))

// Urgência. Os ids são os mesmos de PRIORITIES de propósito: a urgência da
// mudança vira, sem tradução, a prioridade da atividade criada.
export const URGENCIES = [
  { id: 'low',    label: 'Baixa',   color: '#5F5C56' },
  { id: 'medium', label: 'Normal',  color: '#8A6A3F' },
  { id: 'high',   label: 'Urgente', color: '#9A4F32' },
]
export const URGENCY_MAP = Object.fromEntries(URGENCIES.map(u => [u.id, u]))

// Um lado da mudança (emissor ou destinatário): pessoa OU setor.
// Devolve { tipo: 'pessoa'|'setor'|null, nome }.
export function ladoDaMudanca({ userId, sector }, users = []) {
  if (userId) {
    const u = users.find(x => x.id === userId)
    return { tipo: 'pessoa', nome: u?.name || 'Alguém', user: u || null }
  }
  if (sector) return { tipo: 'setor', nome: sectorLabel(sector) || sector, user: null }
  return { tipo: null, nome: '—', user: null }
}

// Formata um número como moeda brasileira (R$ 250.000,00). null/undefined → '—'.
export function formatBRL(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
// Máscara de digitação: os dígitos entram pela direita, como numa calculadora.
// "2" → 0,02 · "250" → 2,50 · "25000000" → 250.000,00. Sempre devolve um texto
// válido (descarta o que não for dígito), então nunca cria estado inconsistente.
export function maskBRL(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13)
  if (!digits) return ''
  return (Number(digits) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Converte texto digitado ("250000,00", "R$ 250.000,00") em número. Vazio/inválido → null.
export function parseBRL(text) {
  const s = String(text || '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const SEED_USERS = [
  { id: 'u1', name: 'Marina Souza',  initials: 'MS', color: 'var(--proj-blue)' },
  { id: 'u2', name: 'Lucas Rocha',   initials: 'LR', color: 'var(--proj-purple)' },
  { id: 'u3', name: 'Camila Alves',  initials: 'CA', color: 'var(--proj-green)' },
  { id: 'u4', name: 'João Pereira',  initials: 'JP', color: 'var(--proj-coral)' },
  { id: 'u5', name: 'Rafael Brito',  initials: 'RB', color: 'var(--proj-teal)' },
]

export const SEED_PROJECTS = [
  { id: 'p1', name: 'Rebrand 2026',       desc: 'Nova identidade visual e site institucional.', color: 'coral', start: '2026-05-04', end: '2026-06-19' },
  { id: 'p2', name: 'App mobile',         desc: 'Lançamento do app iOS e Android.',             color: 'teal',  start: '2026-05-11', end: '2026-07-03' },
  { id: 'p3', name: 'Marketing Q2',       desc: 'Campanhas e conteúdo do segundo trimestre.',   color: 'amber', start: '2026-05-01', end: '2026-06-12' },
  { id: 'p4', name: 'Onboarding clientes',desc: 'Melhorar a ativação de novos clientes.',       color: 'blue',  start: '2026-05-18', end: '2026-06-30' },
]

export const SEED_TASKS = [
  { id: 't1',  projectId: 'p1', title: 'Finalizar manual de marca', assigneeId: 'u1', status: 'progress', priority: 'high',   start: '2026-05-14', end: '2026-05-28' },
  { id: 't2',  projectId: 'p1', title: 'Aprovar nova paleta',       assigneeId: 'u3', status: 'done',     priority: 'high',   start: '2026-05-04', end: '2026-05-12' },
  { id: 't3',  projectId: 'p1', title: 'Wireframes do site',        assigneeId: 'u2', status: 'progress', priority: 'medium', start: '2026-05-18', end: '2026-05-30' },
  { id: 't4',  projectId: 'p1', title: 'Sessão de fotos',           assigneeId: 'u4', status: 'todo',     priority: 'low',    start: '2026-06-01', end: '2026-06-08' },
  { id: 't5',  projectId: 'p1', title: 'Publicar site institucional', assigneeId: 'u1', status: 'todo',  priority: 'high',   start: '2026-06-10', end: '2026-06-19' },
  { id: 't6',  projectId: 'p2', title: 'Telas de onboarding',       assigneeId: 'u2', status: 'progress', priority: 'medium', start: '2026-05-20', end: '2026-05-30' },
  { id: 't7',  projectId: 'p2', title: 'Integração de login',       assigneeId: 'u5', status: 'todo',     priority: 'high',   start: '2026-05-25', end: '2026-06-05' },
  { id: 't8',  projectId: 'p2', title: 'Design system mobile',      assigneeId: 'u3', status: 'done',     priority: 'medium', start: '2026-05-11', end: '2026-05-22' },
  { id: 't9',  projectId: 'p2', title: 'Testes beta',               assigneeId: 'u4', status: 'todo',     priority: 'medium', start: '2026-06-08', end: '2026-06-20' },
  { id: 't10', projectId: 'p2', title: 'Publicar nas lojas',        assigneeId: 'u1', status: 'todo',     priority: 'high',   start: '2026-06-25', end: '2026-07-03' },
  { id: 't11', projectId: 'p3', title: 'Calendário editorial',      assigneeId: 'u3', status: 'done',     priority: 'low',    start: '2026-05-01', end: '2026-05-08' },
  { id: 't12', projectId: 'p3', title: 'Campanha de lançamento',    assigneeId: 'u4', status: 'progress', priority: 'high',   start: '2026-05-12', end: '2026-05-30' },
  { id: 't13', projectId: 'p3', title: 'Newsletter de maio',        assigneeId: 'u1', status: 'done',     priority: 'medium', start: '2026-05-05', end: '2026-05-15' },
  { id: 't14', projectId: 'p3', title: 'Anúncios pagos',            assigneeId: 'u5', status: 'todo',     priority: 'medium', start: '2026-05-28', end: '2026-06-12' },
  { id: 't15', projectId: 'p4', title: 'Fluxo de ativação',         assigneeId: 'u2', status: 'progress', priority: 'high',   start: '2026-05-18', end: '2026-06-02' },
  { id: 't16', projectId: 'p4', title: 'E-mails de boas-vindas',    assigneeId: 'u3', status: 'todo',     priority: 'medium', start: '2026-05-12', end: '2026-05-22' },
  { id: 't17', projectId: 'p4', title: 'Tutorial in-app',           assigneeId: 'u1', status: 'todo',     priority: 'low',    start: '2026-06-05', end: '2026-06-18' },
]

// ---------- checklists (subetapas por atividade) ----------
// Fonte do progresso fino de cada atividade. done=true marca o item concluído.
const CHECKLISTS = {
  t1:  [['Coletar referências',1],['Definir grid e tipografia',1],['Diagramar páginas',0],['Revisão final',0]],
  t2:  [['Testar contraste',1],['Aprovar com o time',1],['Documentar tokens',1]],
  t3:  [['Mapa do site',1],['Wireframe da home',1],['Wireframe internas',0],['Validar com stakeholders',0]],
  t4:  [['Briefing da sessão',0],['Reservar estúdio',0],['Lista de cenas',0]],
  t5:  [['Configurar hospedagem',0],['Migrar conteúdo',0],['Testes de QA',0],['Go live',0]],
  t6:  [['Fluxo de telas',1],['Protótipo navegável',1],['Microcopy',0],['Handoff para dev',0]],
  t7:  [['Tela de login',0],['Integração OAuth',0],['Recuperação de senha',0]],
  t8:  [['Componentes base',1],['Tokens de cor',1],['Documentação',1]],
  t9:  [['Recrutar testers',0],['Roteiro de testes',0],['Coletar feedback',0]],
  t10: [['Assets das lojas',0],['Ficha App Store',0],['Ficha Play Store',0],['Enviar para revisão',0]],
  t11: [['Levantar datas-chave',1],['Montar calendário',1]],
  t12: [['Conceito criativo',1],['Peças gráficas',1],['Plano de mídia',0],['Aprovação final',0]],
  t13: [['Definir pauta',1],['Redigir texto',1],['Disparar',1]],
  t14: [['Definir público',0],['Criar anúncios',0],['Configurar campanha',0]],
  t15: [['Mapear jornada',1],['Definir gatilhos',1],['Implementar fluxo',0],['Medir conversão',0]],
  t16: [['Escrever copy',0],['Montar template',0],['Programar envio',0]],
  t17: [['Roteiro do tour',0],['Telas guiadas',0],['Publicar',0]],
}
SEED_TASKS.forEach(t => {
  t.checklist = (CHECKLISTS[t.id] || []).map(([text, done], i) => ({ id: `${t.id}-c${i}`, text, done: !!done }))
})

// ---------- membros adicionais por atividade (além do responsável) ----------
const MEMBERS = {
  t1:  ['u3','u4'],
  t3:  ['u1'],
  t6:  ['u5'],
  t7:  ['u2','u3'],
  t12: ['u1','u5'],
  t15: ['u3'],
}
SEED_TASKS.forEach(t => { t.memberIds = MEMBERS[t.id] ? [...MEMBERS[t.id]] : [] })

// Todas as pessoas de uma atividade: responsável + membros (sem duplicar).
export function taskMembers(task) {
  const ids = [task.assigneeId, ...(task.memberIds || [])].filter(Boolean)
  return [...new Set(ids)]
}

// ---------- date helpers ----------
export const MONTHS_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
export function parseDate(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d) }
export function fmtShort(s) { const d = parseDate(s); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}` }
export function fmtMed(s) { const d = parseDate(s); return `${d.getDate()} de ${MONTHS_PT[d.getMonth()]}` }
export function fmtFull(s) { const d = parseDate(s); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` }
export function dayDiff(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000) }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
// Data de hoje. Era fixa ('2026-05-26') na época do protótipo — com dados reais
// isso congelava a linha "hoje" do Gantt, o marcador de atraso e o cronograma.
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- permissões ----------
// Papéis por projeto. 'admin' é global (user.isAdmin) e não aparece nesta lista.
export const PROJECT_ROLES = [
  { id: 'full', label: 'Edição total' },
  { id: 'view', label: 'Só exibição' },
]
export const ROLE_LABEL = { admin: 'Administrador', full: 'Edição total', view: 'Só exibição' }

// Papel efetivo de um usuário num projeto (espelha a lógica do backend):
// admin global > pessoa incluída no projeto. Quem não foi incluído não tem
// papel (null) — não enxerga o projeto. O backend nem envia esses projetos.
export function effectiveProjectRole(project, user) {
  if (!user) return null
  if (user.isAdmin) return 'admin'
  const m = (project?.members || []).find(x => x.userId === user.id)
  return m ? (m.role === 'full' ? 'full' : 'view') : null
}
// Pode criar/editar/excluir atividades, editar o projeto, excluir materiais.
export const canEditProject = (role) => role === 'admin' || role === 'full'
// Pode publicar uma mudança/requisição no projeto quando participa dele, mesmo em
// papel de visualização; a edição total do projeto continua restrita a admins/full.
export const canPublishProjectChange = (role) => role === 'admin' || role === 'full' || role === 'view'

// ---------- arquivos ----------
export const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB (igual ao limite do backend)
// Formata bytes em texto legível: 1.2 MB, 340 KB, 18 B…
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ---------- checklist / progress helpers ----------
// O cálculo ponderado por peso vive em progresso.js (função pura, testada).
export { calcularProgresso, progressoExecutado } from './progresso.js'
export function checklistStats(task) {
  const list = task.checklist || []
  const total = list.length
  const done = list.filter(i => i.done).length
  return { total, done, remaining: total - done, pct: total ? Math.round(done / total * 100) : null }
}
// Progresso de uma atividade, em três camadas:
//  1. Concluído vale 100% — o status é a palavra final de quem executou,
//     mesmo que algum item do checklist tenha ficado sem marcar.
//  2. Havendo checklist, ele é a medida: cada item vale 100/total.
//  3. Sem checklist, resta inferir do status (em andamento = metade).
export function taskProgress(task) {
  if (task.status === 'done') return 100
  const { total, pct } = checklistStats(task)
  if (total) return pct
  return task.status === 'progress' ? 50 : 0
}

// Progresso do projeto: percentual executado segundo os PESOS das atividades
// (ver src/data/progresso.js). Antes era a média simples do progresso de cada
// atividade — o que fazia um serviço de 3 dias pesar igual a um de 3 meses.
//
// Recebe JÁ as atividades do projeto. A versão anterior recebia a lista
// inteira mais um projectId e filtrava por conta própria, o que parecia
// cômodo e custava caro: numa tela de cards, cada card varria todas as
// atividades, e o total virava projetos × atividades a cada render — de novo
// a cada tecla digitada na busca, que é o que remonta a lista. Quem tem a
// lista de muitos projetos agrupa uma vez com tasksByProject().
export function projectProgress(tasksDoProjeto) {
  return Math.round(progressoExecutado(tasksDoProjeto))
}

// Atividades agrupadas por projeto, numa passada só: O(atividades) em vez de
// um filter por projeto. Use dentro de um useMemo com [tasks].
export function tasksByProject(tasks) {
  const porProjeto = new Map()
  for (const t of tasks || []) {
    const lista = porProjeto.get(t.projectId)
    if (lista) lista.push(t)
    else porProjeto.set(t.projectId, [t])
  }
  return porProjeto
}

// Projeto sem atividade nenhuma. Referência única e congelada: devolver [] a
// cada chamada criaria um array novo por render, quebrando qualquer memo de
// quem receber isto como prop.
export const SEM_ATIVIDADES = Object.freeze([])
