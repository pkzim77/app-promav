import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/kit.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

// Última rede: o "Tentar de novo" daqui só remonta o App — o token continua no
// localStorage, então a sessão não cai e o bootstrap é refeito sozinho.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
