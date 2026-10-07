// ============================================================
// Promav — cálculo do progresso do projeto (função pura, sem React).
//
// Todas as atividades de um projeto pesam igual: com N atividades,
// cada uma vale 100/N do total.
//
// ---- Como cada atividade cai numa fatia ----
// Quem classifica é o STATUS do quadro, com uma exceção: checklist 100%
// marcado promove a atividade para Concluído, mesmo que o status não tenha
// sido movido ainda.
//
//   • Concluído    → status Concluído, OU checklist inteiro marcado
//   • Em andamento → status Em andamento (com o checklist ainda incompleto)
//   • A fazer      → status A fazer (com o checklist ainda incompleto)
//
// As três fatias somam 100 e mostram ONDE o projeto está.
//
// ---- Quanto já foi executado ----
// Separadamente, `executado` mede QUANTO foi feito: uma atividade concluída
// entra com peso cheio; as demais entram só com a fração do checklist já
// marcada. É esse número que serve como percentual do projeto — a fatia
// "Em andamento" diz que o serviço começou, não que ele acabou.
// ============================================================

const round1 = (n) => Math.round(n * 10) / 10

// Estado de um ITEM do checklist. `state` manda; `done` é só o fallback de
// dado antigo, que não tinha `state`. É A regra de 'item concluído' no app —
// store.js a re-exporta e todo contador/percentual passa por aqui.
export const estadoDoItem = (item) => item?.state || (item?.done ? 'done' : 'todo')
const itemFeito = (i) => estadoDoItem(i) === 'done'

// Status do quadro (ids do app). Revisão e diligência são serviço começado e
// não entregue — a mesma fatia de 'Em andamento'. Separá-las aqui quebraria a
// soma em 100 das três fatias, e o que o Panorama responde é onde o projeto
// está, não em que subestado.
const ehConcluido = (a) => a?.status === 'done'
const ehAndamento = (a) => a?.status === 'progress' || a?.status === 'review' || a?.status === 'diligence'

// Arredonda as três fatias para 1 casa mantendo a soma exata em 100.
// A sobra do arredondamento vai para a maior fatia, onde pesa menos.
function ajustarPara100(valores) {
  const r = valores.map(round1)
  const sobra = round1(100 - r.reduce((a, b) => a + b, 0))
  if (sobra !== 0) {
    let maior = 0
    for (let i = 1; i < r.length; i++) if (r[i] > r[maior]) maior = i
    r[maior] = round1(r[maior] + sobra)
  }
  return r
}

/**
 * Divide o progresso de um projeto em três fatias que somam 100.
 *
 * @param {Array} atividades  lista de { id, status, checklist: [{ state, done }] }
 * @returns {{
 *   aFazer: number, emAndamento: number, concluido: number,  // percentuais, somam 100
 *   executado: number, // quanto do projeto já foi feito de fato
 *   total: number,     // quantidade de atividades
 *   detalhes: Array    // situação e contribuição de cada atividade
 * }}
 */
export function calcularProgresso(atividades = []) {
  const lista = (Array.isArray(atividades) ? atividades : []).filter(Boolean)
  const total = lista.length

  // Projeto sem atividades: nada foi executado.
  if (total === 0) {
    return { aFazer: 100, emAndamento: 0, concluido: 0, executado: 0, total: 0, detalhes: [] }
  }

  const peso = 100 / total // toda atividade vale o mesmo

  let concluido = 0
  let emAndamento = 0
  let aFazer = 0
  let executado = 0
  const detalhes = []

  for (const a of lista) {
    const itens = Array.isArray(a?.checklist) ? a.checklist : []
    const feitos = itens.filter(itemFeito).length
    const frac = itens.length ? feitos / itens.length : 0

    // Checklist inteiro marcado conclui a atividade, mesmo sem mover o status.
    const completa = (itens.length > 0 && feitos === itens.length) || ehConcluido(a)

    let fatia
    if (completa) {
      fatia = 'concluido'
      concluido += peso
      executado += peso            // peso cheio
    } else if (ehAndamento(a)) {
      fatia = 'emAndamento'
      emAndamento += peso          // a atividade inteira está em execução…
      executado += peso * frac     // …mas só a parte marcada já foi feita
    } else {
      fatia = 'aFazer'
      aFazer += peso
      executado += peso * frac     // normalmente 0
    }

    detalhes.push({ id: a?.id, fatia, peso: round1(peso), executado: round1(completa ? peso : peso * frac) })
  }

  const [pFazer, pAndamento, pConcluido] = ajustarPara100([aFazer, emAndamento, concluido])

  return {
    aFazer: pFazer,
    emAndamento: pAndamento,
    concluido: pConcluido,
    executado: round1(executado),
    total, detalhes,
  }
}

// Percentual do projeto efetivamente executado.
export function progressoExecutado(atividades) {
  return calcularProgresso(atividades).executado
}
