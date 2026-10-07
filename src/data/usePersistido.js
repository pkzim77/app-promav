import React from 'react'

// Estado espelhado no localStorage sob uma chave por usuário. Com chave null
// (deslogado) volta ao padrão, para não vazar ids de uma conta para a próxima.
export function usePersistido(key, padrao, normalizar = (v) => v) {
  const ler = (k) => {
    if (!k) return padrao
    try {
      const raw = localStorage.getItem(k)
      if (raw) return normalizar(JSON.parse(raw))
    } catch { /* storage indisponível ou conteúdo corrompido: fica no padrão */ }
    return padrao
  }

  const [estado, setEstado] = React.useState(() => ({ key, valor: ler(key) }))
  // A leitura acontece no render, e não num efeito: por efeito existe um commit
  // entre "a chave já é a nova" e "o valor lido já chegou", e é nele que o
  // efeito de gravar escreve o padrão por cima do que estava salvo.
  if (estado.key !== key) setEstado({ key, valor: ler(key) })
  const valor = estado.key === key ? estado.valor : padrao

  React.useEffect(() => {
    if (!key) return
    try { localStorage.setItem(key, JSON.stringify(valor)) } catch { /* ignore */ }
  }, [key, valor])

  // Aceita valor ou updater, como o useState. Devolver a mesma referência não
  // re-renderiza — é o que faz a poda de ids sair de graça quando nada muda.
  const setValor = React.useCallback((v) => {
    setEstado(prev => {
      const novo = typeof v === 'function' ? v(prev.valor) : v
      return novo === prev.valor ? prev : { key: prev.key, valor: novo }
    })
  }, [])

  return [valor, setValor]
}
