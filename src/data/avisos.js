// Avisos de novidade: som curto + notificação do sistema operacional.
// Os dois são acessórios — se o navegador barrar, o sino do app continua
// sendo a fonte da verdade. Por isso tudo aqui falha em silêncio.

// ----- som -----
// Sintetizado no WebAudio em vez de um arquivo: são duas senoides curtas, o
// que evita carregar um binário e não depende de a rede estar de pé.
let ctx = null

const contexto = () => {
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  return ctx
}

// O navegador cria o AudioContext suspenso até a primeira interação. Chamar
// isto de dentro de um clique o destrava para os avisos seguintes, que vêm
// do polling e portanto não têm gesto nenhum por trás.
export function destravarSom() {
  const c = contexto()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
}

export function tocarAviso() {
  try {
    const c = contexto()
    if (!c) return
    if (c.state === 'suspended') c.resume().catch(() => {})
    const t0 = c.currentTime
    // Duas notas ascendentes (lá5 → ré6), 110 ms de intervalo.
    for (const [hz, atraso] of [[880, 0], [1174.7, 0.11]]) {
      const osc = c.createOscillator()
      const vol = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      // Rampa exponencial não aceita zero — daí o 0.0001 nas pontas.
      vol.gain.setValueAtTime(0.0001, t0 + atraso)
      vol.gain.exponentialRampToValueAtTime(0.14, t0 + atraso + 0.02)
      vol.gain.exponentialRampToValueAtTime(0.0001, t0 + atraso + 0.22)
      osc.connect(vol).connect(c.destination)
      osc.start(t0 + atraso)
      osc.stop(t0 + atraso + 0.24)
    }
  } catch { /* som é acessório */ }
}

// ----- notificação do sistema -----
export const suportaNotificacao = () => typeof window !== 'undefined' && 'Notification' in window

export const permissaoNotificacao = () => (suportaNotificacao() ? Notification.permission : 'unsupported')

// Precisa sair de um gesto do usuário: alguns navegadores ignoram o pedido
// feito fora de um clique.
export async function pedirPermissao() {
  if (!suportaNotificacao()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try { return await Notification.requestPermission() } catch { return 'denied' }
}

// Mostra UMA notificação para o lote que chegou — várias de uma vez viram
// spam. A 'tag' faz o sistema substituir a anterior em vez de empilhar.
export function avisarNoNavegador(novas, aoClicar) {
  if (!suportaNotificacao() || Notification.permission !== 'granted') return
  if (!novas.length) return
  try {
    const [primeira] = novas
    const titulo = novas.length === 1
      ? `${primeira.tag}: ${primeira.title}`
      : `${novas.length} novidades no Promav`
    const corpo = novas.length === 1
      ? primeira.text
      : novas.slice(0, 3).map(i => `• ${i.title}`).join('\n')
    const n = new Notification(titulo, { body: corpo, tag: 'promav-novidades', renotify: true })
    n.onclick = () => {
      window.focus()
      n.close()
      if (novas.length === 1) aoClicar?.(primeira)
    }
  } catch { /* notificação é acessória */ }
}
