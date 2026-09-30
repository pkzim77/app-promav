import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal } from '../primitives/primitives.jsx'
import { taskMembers, conselhoDe, sectorLabel, formacaoLabel } from '../../data/store.js'

// Ficha do profissional — leitura, no formato de uma carteira de identificação.
//
// Clicar numa linha da lista abria direto o formulário de edição. Quem só
// queria o telefone de alguém caía num formulário de doze campos, com risco de
// salvar uma alteração sem querer. Agora o clique abre isto, e editar é um
// botão explícito.
//
// A carteirinha cobre a IDENTIFICAÇÃO: quem é, o que faz, como falar com a
// pessoa. O que é do sistema — vínculo, situação, quantos projetos — fica fora
// dela, embaixo: não é o que se confere numa identidade.

const traco = (v) => (v && String(v).trim() ? String(v).trim() : '—')

// Campo da carteirinha: rótulo em cima, valor numa caixa clara — como no
// modelo impresso, onde a caixa é a linha que se preenche à mão.
function Campo({ rotulo, valor, largo = false, vazio = false }) {
  return (
    <div className={'cart-campo' + (largo ? ' largo' : '')}>
      <span className="cart-rotulo">{rotulo}</span>
      <span className={'cart-caixa' + (vazio ? ' vazia' : '')}>{valor}</span>
    </div>
  )
}

export function PersonCard({ user, projects = [], tasks = [], onEdit, onClose }) {
  if (!user) return null

  // Os mesmos números da coluna "Alocação" da lista: projetos em que a pessoa
  // está (por equipe, responsabilidade ou atividade) e atividades em aberto.
  const { projetos, emAberto } = React.useMemo(() => {
    const ids = new Set()
    let abertas = 0
    for (const t of tasks) {
      if (!taskMembers(t).includes(user.id)) continue
      ids.add(t.projectId)
      if (t.status !== 'done') abertas++
    }
    for (const p of projects) {
      if ((p.members || []).some(m => m.userId === user.id) || (p.responsibleIds || []).includes(user.id)) ids.add(p.id)
    }
    return { projetos: ids.size, emAberto: abertas }
  }, [user.id, projects, tasks])

  const conselho = conselhoDe(user)
  const inativo = user.isActive === false

  return (
    <Modal title="Profissional" onClose={onClose} className="modal-ficha"
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Fechar</button>
        {onEdit && (
          <button className="btn btn-primary" onClick={() => onEdit(user)}>
            <Icon name="pencil" size={16} />Editar
          </button>
        )}
      </>}>

      <article className="cart">
        <header className="cart-topo">
          <span className="cart-marca">
            <span className="cart-logo"><b>PRO</b><em>MAV</em></span>
            <span className="cart-eng">ENGENHARIA</span>
          </span>
          <span className="cart-org">
            Identificação interna
            {user.sector && <em>{sectorLabel(user.sector) || user.sector}</em>}
          </span>
        </header>

        {/* Sem foto, sem moldura: as iniciais já aparecem na lista e no avatar de
            todo o app, e repeti-las aqui gastaria um quarto da largura para não
            dizer nada novo. Quando a foto existir, o retrato volta a esta coluna,
            à esquerda dos campos. */}
        <div className="cart-corpo">
          <div className="cart-campos">
            <Campo rotulo="Nome completo" valor={user.name} largo />
            <Campo rotulo="Cargo" valor={traco(user.jobTitle)} vazio={!user.jobTitle} />
            <Campo rotulo="Setor" valor={user.sector ? (sectorLabel(user.sector) || user.sector) : '—'} vazio={!user.sector} />
            <Campo rotulo="Formação" valor={formacaoLabel(user.formation) || '—'} vazio={!user.formation} />
            <Campo rotulo={conselho || 'Registro'}
              valor={conselho ? traco(user.professionalRegister) : 'não se aplica'}
              vazio={!conselho || !user.professionalRegister} />
            <Campo rotulo="Telefone" valor={traco(user.phone)} vazio={!user.phone} />
            <Campo rotulo="E-mail" largo vazio={!user.email}
              valor={user.email || (user.isOutsourced ? 'sem e-mail de contato' : '—')} />
          </div>
        </div>

        {user.shortName && user.shortName !== user.name && (
          <p className="cart-rodape">Chamada por <strong>{user.shortName}</strong></p>
        )}
      </article>

      {/* Fora da carteirinha: o que é do sistema, não da identidade. */}
      <div className="pc-sistema">
        <div className="pc-selos">
          <span className={'pc-selo ' + (user.isOutsourced ? 'terc' : 'neutro')}>
            {user.isOutsourced ? 'Terceirizado' : 'Interno'}
          </span>
          {user.isAdmin && <span className="pc-selo admin">Administrador</span>}
          <span className={'pc-selo ' + (inativo ? 'inativo' : 'ativo')}>{inativo ? 'Inativo' : 'Ativo'}</span>
        </div>
        <p className="pc-alocacao">
          <strong>{projetos}</strong> projeto{projetos === 1 ? '' : 's'}
          <span className="pc-sep">·</span>
          <strong>{emAberto}</strong> atividade{emAberto === 1 ? '' : 's'} em aberto
        </p>
      </div>

      {user.isOutsourced && (
        <p className="pc-nota">
          <Icon name="lock" size={14} />
          Terceirizado não acessa o sistema. O e-mail, quando existe, é contato.
        </p>
      )}
    </Modal>
  )
}
