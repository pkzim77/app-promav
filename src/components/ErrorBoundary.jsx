import React from 'react'

// Rede de segurança: sem boundary, qualquer exceção de render ou de efeito faz
// o React 18 desmontar a raiz (renderiza null) e a página fica em branco.
export class ErrorBoundary extends React.Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('[promav] erro de render', err, info?.componentStack) }
  // Zera o erro quando a chave de contexto muda (trocar de tela/projeto/modal),
  // sem remontar nada enquanto está tudo bem.
  componentDidUpdate(prev) {
    if (this.state.err && prev.resetKey !== this.props.resetKey) this.setState({ err: null })
  }
  reset = () => { this.setState({ err: null }); this.props.onReset?.() }
  render() {
    if (!this.state.err) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.state.err, this.reset)
    return (
      <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <h2>Algo deu errado</h2>
          <p style={{ color: 'var(--fg-3)' }}>{String(this.state.err?.message || this.state.err)}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn btn-secondary" onClick={this.reset}>Tentar de novo</button>
            <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Recarregar a página</button>
          </div>
        </div>
      </div>
    )
  }
}

// Import dinâmico de tela/modal carregado sob demanda. Numa aba aberta durante
// um deploy, o chunk com o hash antigo dá 404 e o React.lazy cru propaga um
// erro de rede que não diz nada a quem está usando o app. Sem retry: o
// navegador guarda a falha daquela URL no module map, e só recarregar resolve.
export const lazyComAviso = (factory) => React.lazy(() => factory().catch(err => {
  throw new Error('Há uma nova versão do app. Recarregue a página para continuar.', { cause: err })
}))
