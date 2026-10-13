import React from 'react'
import { Icon } from '../Icon.jsx'
import { Modal, Field, SelecaoMultipla, PopupPendencias, SegControl } from '../primitives/primitives.jsx'
import { PROJECT_HEX, PROJECT_ROLES, ROLE_LABEL, RESOURCE_ORIGINS, PROJECT_STATUSES, PROJECT_TYPES, TIPOS_COM_KMZ, PREFEITURAS, SECRETARIAS, canonizar, parseBRL, pendenciasDoProjeto, formatBytes } from '../../data/store.js'
import { dateError } from './shared/formHelpers.js'
import { MoneyInput } from './shared/MoneyInput.jsx'
import { FilePicker } from './ResourceModals.jsx'
import { ehArquivoKmz } from './shared/kmzGeo.js'
import { FieldError } from './shared/FieldError.jsx'
import { ErrorBoundary, lazyComAviso } from '../ErrorBoundary.jsx'

// Carregado sob demanda: arrasta JSZip + togeojson (~90 KB) para ler o .kmz, e
// só serve quando a aba "Tipo de obra" de um projeto já salvo é aberta — não
// faz sentido pesar o modal de projeto, que carrega sempre, com isso.
const KmzSegmentsEditor = lazyComAviso(() =>
  import('./KmzSegmentsEditor.jsx').then(m => ({ default: m.KmzSegmentsEditor }))
)

// Nome em pt-BR de cada cor de projeto: sem ele o leitor de tela anuncia a
// chave crua do PROJECT_HEX ('teal', 'amber'), que não nomeia cor nenhuma aqui.
const COLOR_LABEL = {
  indigo: 'Índigo', blue: 'Azul', teal: 'Verde-azulado', green: 'Verde',
  amber: 'Âmbar', coral: 'Coral', pink: 'Rosa', purple: 'Roxo',
}

// Equipe do projeto — lista única que resolve duas coisas de uma vez:
//  • acesso: quem não estiver na lista NÃO enxerga o projeto no sistema
//    (administradores têm acesso total e não ocupam vaga de participante);
//  • responsabilidade: o check da esquerda marca quem responde pelo projeto.
// O seletor de acesso e o "Adicionar" só aparecem para administradores; os
// demais veem o papel como texto (o backend também ignora alterações de
// permissão de não-admins) mas ainda podem marcar os responsáveis, porque
// PUT /api/projects/:id aceita responsibleIds de quem tem Edição total.
function PermissionsEditor({ users, members, responsibleIds, onChangeMembers, onChangeResponsibles, isAdmin }) {
  const roleOf = (userId) => members.find(x => x.userId === userId)?.role || 'none'
  const setRole = (userId, value) => {
    const others = members.filter(x => x.userId !== userId)
    onChangeMembers(value === 'none' ? others : [...others, { userId, role: value }])
  }
  // Marcar põe a pessoa na equipe; desmarcar tira, junto com a
  // responsabilidade — o mesmo efeito do X da linha. Antes era um <select> e um
  // botão "Adicionar" por pessoa: montar uma equipe de cinco custava quinze
  // interações para o mesmo resultado.
  const alternarMembro = (userId) => {
    if (roleOf(userId) !== 'none') return removeMember(userId)
    // Administrador entra como Edição total: ele tem acesso irrestrito de
    // qualquer forma, e gravar 'view' mostraria na tela um limite que não existe.
    const u = users.find(x => x.id === userId)
    onChangeMembers([...members, { userId, role: u?.isAdmin ? 'full' : 'view' }])
  }
  // Tirar alguém do projeto também o tira da responsabilidade: um responsável
  // sem acesso apareceria no Panorama sem conseguir abrir o projeto.
  const removeMember = (userId) => {
    onChangeMembers(members.filter(x => x.userId !== userId))
    onChangeResponsibles(responsibleIds.filter(x => x !== userId))
  }

  // Só quem já é participante aparece na lista, então marcar alguém aqui nunca
  // precisa lhe dar acesso antes — ele já tem.
  const isResp = (userId) => responsibleIds.includes(userId)
  const toggleResp = (u) => {
    onChangeResponsibles(isResp(u.id) ? responsibleIds.filter(x => x !== u.id) : [...responsibleIds, u.id])
  }

  // A equipe de desenvolvimento (users.is_dev) não entra em projeto: mantém o
  // sistema, não toca obra. Fora ela, qualquer pessoa pode ser adicionada e
  // marcada como responsável — administradores inclusive.
  // Ordem alfabética na lista suspensa: com dez nomes em ordem de cadastro,
  // achar alguém já é uma varredura.
  const elegiveis = users.filter(u => !u.isDev).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const teamUsers = elegiveis.filter(u => roleOf(u.id) !== 'none')
  // Administrador vê todo projeto por definição, então não conta como alguém a
  // quem este cadastro deu acesso — a frase do rodapé fala dos demais.
  const comAcesso = teamUsers.filter(u => !u.isAdmin).length
  const nResp = teamUsers.filter(u => isResp(u.id)).length
  return (
    <div className="field">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Equipe do projeto
        <span style={{ fontWeight: 400, color: 'var(--fg-4)', fontSize: 12.5 }}>marque quem responde pelo projeto</span>
      </label>
      {isAdmin && (
        <div className="perm-add">
          <SelecaoMultipla
            itens={elegiveis.map(u => ({
              id: u.id,
              nome: u.name,
              marcado: roleOf(u.id) !== 'none',
              antes: <span className="av" style={{ width: 22, height: 22, background: u.color, fontSize: 9 }}>{u.initials}</span>,
              etiqueta: u.isAdmin ? 'admin' : null,
            }))}
            onAlternar={alternarMembro}
            ariaLabel="Pessoas da equipe do projeto"
            rotulo={(n) => n ? `${n} pessoa${n === 1 ? '' : 's'} na equipe` : 'Escolha quem participa do projeto'} />
        </div>
      )}
      <div className="perm-head">
        <span className="perm-head-resp">Resp.</span>
        <span>Pessoa</span>
        <span className="perm-head-role">Acesso ao projeto</span>
        {isAdmin && <span className="perm-head-spacer" />}
      </div>
      <div className="perm-list">
        {teamUsers.map(u => {
          const resp = isResp(u.id)
          return (
            <div className={'perm-row' + (resp ? ' is-resp' : '')} key={u.id}>
              <button type="button" role="checkbox" aria-checked={resp}
                className={'resp-check' + (resp ? ' on' : '')}
                title={resp ? 'Remover como responsável' : 'Marcar como responsável'}
                onClick={() => toggleResp(u)}>
                {resp && <Icon name="check" size={13} stroke={3} />}
              </button>
              <span className="av" style={{ width: 26, height: 26, background: u.color, fontSize: 10 }}>{u.initials}</span>
              <span className="perm-name">{u.name}{u.isAdmin ? ' · admin' : ''}</span>
              {u.isAdmin ? (
                // Sem seletor de papel: o acesso do admin é total em todo
                // projeto, e um "Só exibição" aqui seria letra morta.
                <>
                  <span className="perm-admin-slot"><span className="perm-admin-tag">Acesso total</span></span>
                  {isAdmin && (
                    <button type="button" className="btn-icon perm-remove" onClick={() => removeMember(u.id)} aria-label={`Remover ${u.name}`} title="Remover da equipe">
                      <Icon name="x" size={15} />
                    </button>
                  )}
                </>
              ) : isAdmin ? (
                <>
                  <select className="control perm-select" value={roleOf(u.id)} onChange={e => setRole(u.id, e.target.value)}>
                    {PROJECT_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                  <button type="button" className="btn-icon perm-remove" onClick={() => removeMember(u.id)} aria-label={`Remover ${u.name}`} title="Remover participante">
                    <Icon name="x" size={15} />
                  </button>
                </>
              ) : (
                <span className="perm-role-static">{ROLE_LABEL[roleOf(u.id)] || 'Sem acesso'}</span>
              )}
            </div>
          )
        })}
      </div>
      {!teamUsers.length && <div className="perm-empty">Nenhum participante adicionado.</div>}
      <div className="perm-default-label" style={{ marginTop: 10 }}>
        {comAcesso === 0
          ? 'Ninguém além dos administradores vê este projeto.'
          : `${comAcesso} ${comAcesso === 1 ? 'pessoa vê' : 'pessoas veem'} este projeto (além dos administradores).`}
        {nResp > 0 && ` · ${nResp} ${nResp === 1 ? 'responsável' : 'responsáveis'}.`}
      </div>
    </div>
  )
}

export function ProjectModal({ project, users = [], folders = [], defaultFolderId = null, isAdmin = false, initialTab = 'geral', onSave, onClose }) {
  const editing = !!project
  const [name, setName] = React.useState(project?.name || '')
  const [desc, setDesc] = React.useState(project?.desc || '')
  const [color, setColor] = React.useState(project?.color || 'indigo')
  const [folderId, setFolderId] = React.useState(project?.folderId || defaultFolderId || '')
  // Sem data padrão: input type=date não tem placeholder, então qualquer valor
  // pré-preenchido seria gravado como se fosse o prazo real. Sem prazo, é o
  // popup de pendências que avisa.
  const [start, setStart] = React.useState(project?.start || '')
  const [end, setEnd] = React.useState(project?.end || '')
  const [notes, setNotes] = React.useState(project?.notes || '')
  const [resources, setResources] = React.useState(project?.resources ? project.resources.map(r => ({ ...r })) : [])
  const [members, setMembers] = React.useState(project?.members ? project.members.map(m => ({ ...m })) : [])
  // ----- ficha do projeto (dados do convênio) -----
  // Prefeitura e secretaria são listas fechadas, mas o que já está gravado
  // manda: canonizar() reconhece "Umari" como o "UMARI" da lista e, se o valor
  // não existir nela, opcoesCom() o mantém como opção para não sumir ao salvar.
  const [prefeitura, setPrefeitura] = React.useState(canonizar(PREFEITURAS, project?.prefeitura))
  const [secretaria, setSecretaria] = React.useState(canonizar(SECRETARIAS, project?.secretaria))
  const opcoesCom = (lista, atual) => (atual && !lista.includes(atual) ? [atual, ...lista] : lista)
  const [responsibleIds, setResponsibleIds] = React.useState(project?.responsibleIds ? [...project.responsibleIds] : [])
  const [origemRecurso, setOrigemRecurso] = React.useState(project?.origemRecurso || 'federal')
  // Valores em R$: mantidos como texto enquanto digita; convertidos ao salvar.
  const moneyText = (v) => (v != null ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
  const [estimadoText, setEstimadoText] = React.useState(moneyText(project?.valorEstimado))
  const [orcadoText, setOrcadoText] = React.useState(moneyText(project?.valorOrcado))
  const [ehConvenio, setEhConvenio] = React.useState(!!project?.ehConvenio)
  const [convenioNumero, setConvenioNumero] = React.useState(project?.convenioNumero || '')
  const [convenioValorText, setConvenioValorText] = React.useState(moneyText(project?.convenioValor))
  const [projStatus, setProjStatus] = React.useState(project?.status || 'planejamento')
  const [tipo, setTipo] = React.useState(project?.tipo || 'construcao')
  const [touched, setTouched] = React.useState(false)
  const [tab, setTab] = React.useState(initialTab || 'geral') // 'geral' | 'tipo'
  // .kmz escolhido agora, ainda no computador do usuário: o arquivo não cabe no
  // corpo JSON do projeto, então sobe num segundo passo (ver saveProject em
  // App.jsx) — inclusive num projeto novo, que só ganha id ao ser criado.
  const [kmzFile, setKmzFile] = React.useState(null)
  const [kmzLabel, setKmzLabel] = React.useState('')
  const [kmzErr, setKmzErr] = React.useState(null)

  // Só piçarramento e pavimentação têm traçado georreferenciado; nos demais
  // tipos o bloco do .kmz não aparece (e um arquivo já anexado segue guardado,
  // listado em Documentos na Ficha técnica).
  const aceitaKmz = TIPOS_COM_KMZ.includes(tipo)
  const kmzResources = resources.filter(ehArquivoKmz)
  // Remover aqui é só tirar da lista: o PUT do projeto grava os recursos que
  // sobraram e o servidor apaga o arquivo órfão. Fechar no Cancelar desfaz.
  const removeKmz = (r) => setResources(rs => rs.filter(x => x.id !== r.id))
  const pickKmz = (f, fileErr) => {
    if (f && !/\.kmz$/i.test(f.name)) { setKmzFile(null); setKmzErr('Selecione um arquivo .kmz.'); return }
    setKmzFile(fileErr ? null : f); setKmzErr(fileErr || null)
  }
  // Aplica uma edição de trecho (nome, extensão executada) dentro do recurso
  // certo, sem mexer nos outros — o KmzSegmentsEditor devolve o recurso já
  // atualizado, então é só substituir pelo id.
  const updateResource = (atualizado) => setResources(rs => rs.map(r => r.id === atualizado.id ? atualizado : r))
  const [avisado, setAvisado] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const dErr = dateError(start, end)
  const nameErr = touched && !name.trim() ? 'Informe um nome.' : null

  // Prefeitura e responsável deixaram de travar o cadastro: viraram pendência,
  // como o resto. Sem isso, o projeto que chega sem esses dados não entrava no
  // sistema — e passava a existir só no papel de alguém.
  const rascunho = {
    prefeitura, secretaria, responsibleIds, start, end, origemRecurso, ehConvenio,
    valorEstimado: parseBRL(estimadoText), valorOrcado: parseBRL(orcadoText),
    convenioNumero, convenioValor: parseBRL(convenioValorText),
  }
  const pendencias = pendenciasDoProjeto(rascunho)

  // O que falta é dito ANTES de gravar, num popup por cima do formulário, com o
  // caminho seguindo em frente ali mesmo. Gravar e avisar depois entregaria o
  // aviso quando já não dá para desistir; travar de vez é o que esta mudança
  // veio desfazer.
  const save = () => {
    setTouched(true)
    if (!name.trim() || dErr) { setTab('geral'); return }
    if (pendencias.length) { setAvisado(true); return }
    gravar()
  }

  // A guarda contra o clique duplo fica aqui, e não em save(): o
  // PopupPendencias chama gravar() direto.
  const gravar = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave({
        ...(project || {}), name: name.trim(), desc: desc.trim(), color, folderId: folderId || null, start: start || null, end: end || null, notes: notes.trim(), resources, members,
        prefeitura: prefeitura.trim(), secretaria: secretaria.trim(), responsibleIds,
        origemRecurso, valorEstimado: parseBRL(estimadoText), valorOrcado: parseBRL(orcadoText), status: projStatus, tipo,
        // Só vai o .kmz de um tipo de obra que tem traçado — se o usuário trocou
        // o tipo depois de escolher o arquivo, ele é descartado.
        kmzUpload: aceitaKmz && kmzFile ? { file: kmzFile, label: kmzLabel.trim() } : null,
        ehConvenio, convenioNumero: ehConvenio ? convenioNumero.trim() : null,
        convenioValor: ehConvenio ? parseBRL(convenioValorText) : null,
      })
    } finally { setSaving(false) }
  }

  return (
    <Modal className="project-modal" title={editing ? 'Editar projeto' : 'Novo projeto'} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar projeto'}</button>
      </>}>
      {avisado && (
        <PopupPendencias itens={pendencias} onCancelar={() => setAvisado(false)}
          onSalvar={() => { setAvisado(false); gravar() }}
          rotulo={editing ? 'Salvar mesmo assim' : 'Criar mesmo assim'}
          acao={'Dá para ' + (editing ? 'salvar' : 'criar') + ' assim e completar depois. Enquanto faltar, um aviso fica ao lado do nome do projeto.'} />
      )}
      <div className="proj-tabs">
        <button type="button" className={'proj-tab' + (tab === 'geral' ? ' on' : '')} onClick={() => setTab('geral')}>
          <Icon name="file" size={15} />Geral
        </button>
        <button type="button" className={'proj-tab' + (tab === 'tipo' ? ' on' : '')} onClick={() => setTab('tipo')}>
          <Icon name="landmark" size={15} />Tipo de obra
        </button>
      </div>

      {tab === 'tipo' ? (
        <>
          <Field label="Tipo de projeto">
            <SegControl options={PROJECT_TYPES} value={tipo} onChange={setTipo} />
          </Field>
          {aceitaKmz && (
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Arquivo .kmz
                <span style={{ fontWeight: 400, color: 'var(--fg-4)', fontSize: 12.5 }}>área/trecho georreferenciado do serviço</span>
              </label>
              {kmzResources.map(r => (
                <div className="kmz-edit-file" key={r.id}>
                  <div className="res-edit-row">
                    <span className="res-edit-ic"><Icon name="map" size={15} /></span>
                    <span className="res-edit-info">
                      <span className="res-edit-label">{r.label || r.filename || r.url}</span>
                      {r.size ? <span className="res-edit-url">{formatBytes(r.size)}</span> : null}
                    </span>
                    <button type="button" className="btn-icon res-del" title="Remover este .kmz"
                      aria-label={`Remover ${r.label || r.filename || 'arquivo .kmz'}`}
                      onClick={() => removeKmz(r)}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                  {/* Só dá pra ler o arquivo depois de salvo (precisa do fileId
                      já gravado no banco) — antes disso não há o que editar aqui.
                      A boundary cerca só o editor: se ele falhar, o resto do
                      formulário continua preenchível e salvável. */}
                  {r.fileId && (
                    <ErrorBoundary fallback={(erro) => <p className="kmz-msg kmz-msg-error">{erro.message || 'Não foi possível abrir o editor de trechos.'}</p>}>
                      <React.Suspense fallback={<p className="kmz-msg">Carregando trechos…</p>}>
                        <KmzSegmentsEditor resource={r} onChange={updateResource} />
                      </React.Suspense>
                    </ErrorBoundary>
                  )}
                </div>
              ))}
              {!kmzResources.length && !kmzFile && <div className="perm-empty">Nenhum arquivo .kmz anexado.</div>}
              <div style={{ marginTop: kmzResources.length ? 10 : 6 }}>
                <FilePicker accept=".kmz" file={kmzFile} onPick={pickKmz} error={kmzErr} />
              </div>
              {kmzFile && (
                <input className="control" style={{ marginTop: 8 }} value={kmzLabel}
                  placeholder="Nome do arquivo — opcional, usa o nome do .kmz se vazio"
                  onChange={e => setKmzLabel(e.target.value)} />
              )}
              <p className="ro-hint" style={{ marginTop: 10, marginBottom: 0 }}>
                <Icon name="flag" size={14} />
                O envio e a remoção do .kmz só acontecem ao {editing ? 'salvar as alterações' : 'criar o projeto'}.
              </p>
            </div>
          )}
        </>
      ) : (
      <>
      <Field label="Nome do projeto">
        <input className="control" value={name?? ''} autoFocus placeholder="Ex.: Rebrand 2026" onChange={e => setName(e.target.value)} />
        <FieldError>{nameErr}</FieldError>
      </Field>
      <Field label="Descrição">
        <textarea className="control" value={desc?? ''} placeholder="Sobre o que é este projeto?" onChange={e => setDesc(e.target.value)} />
      </Field>

      <div className="field-row">
        <Field label="Prefeitura">
          <select className="control" value={prefeitura ?? ''} onChange={e => setPrefeitura(e.target.value)}>
            <option value="">Selecione a prefeitura</option>
            {opcoesCom(PREFEITURAS, prefeitura).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Secretaria">
          <select className="control" value={secretaria ?? ''} onChange={e => setSecretaria(e.target.value)}>
            <option value="">Sem secretaria</option>
            {opcoesCom(SECRETARIAS, secretaria).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <PermissionsEditor users={users} members={members} responsibleIds={responsibleIds}
        onChangeMembers={setMembers} onChangeResponsibles={setResponsibleIds}
        isAdmin={isAdmin} />

      {/* A origem vem ANTES dos valores: é ela que diz de onde vem o dinheiro,
          e o convênio — quando existe — é o que dá nome e tamanho a ele. */}
      <div className="field-row">
        <Field label="Origem do recurso">
          <select className="control" value={origemRecurso?? ''} onChange={e => setOrigemRecurso(e.target.value)}>
            {RESOURCE_ORIGINS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Status do projeto">
          <select className="control" value={projStatus?? ''} onChange={e => setProjStatus(e.target.value)}>
            {PROJECT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Convênio">
        <label className="marca">
          <input type="checkbox" className="ck-nativo" checked={ehConvenio} onChange={e => setEhConvenio(e.target.checked)} />
          O recurso vem de um convênio
        </label>
        {/* Os campos só existem quando a caixa está marcada. Deixá-los visíveis
            e vazios em todo projeto era mais um par de caixas a ignorar. */}
        {!ehConvenio && (
          <span className="marca-nota">
            Hoje o número do convênio é escrito dentro do nome do projeto, o que
            alonga o nome e impede filtrar por ele.
          </span>
        )}
      </Field>

      {ehConvenio && (
        <div className="field-row">
          <Field label="Número do convênio">
            <input className="control" value={convenioNumero}
              placeholder="Ex.: 030979/2026 ou MAPP 6112"
              onChange={e => setConvenioNumero(e.target.value)} />
          </Field>
          <Field label="Valor do convênio">
            <MoneyInput value={convenioValorText?? ''} onChange={setConvenioValorText} placeholder="0,00" />
          </Field>
        </div>
      )}

      <div className="field-row">
        <Field label="Valor estimado">
          <MoneyInput value={estimadoText?? ''} onChange={setEstimadoText} placeholder="0,00" />
        </Field>
        <Field label="Valor orçado">
          <MoneyInput value={orcadoText?? ''} onChange={setOrcadoText} placeholder="0,00" />
        </Field>
      </div>

      <Field label="Pasta">
        <select className="control" value={folderId??''} onChange={e => setFolderId(e.target.value)}>
          <option value="">Sem pasta</option>
          {folders.map(f => {
            // Caminho completo da pasta (ex: "Obras / São Paulo") para distinguir subpastas.
            const byId = new Map(folders.map(x => [x.id, x]))
            const parts = []
            for (let cur = f, guard = 0; cur && guard < 50; cur = byId.get(cur.parentId), guard++) parts.unshift(cur.name)
            return <option key={f.id} value={f.id}>{parts.join(' / ')}</option>
          })}
        </select>
      </Field>
      <Field label="Anotações">
        <textarea className="control" value={notes?? ''} style={{ minHeight: 110 }}
          placeholder="Contexto, objetivos, observações… O que ajuda a entender o projeto. Links colados aqui viram clicáveis."
          onChange={e => setNotes(e.target.value)} />
      </Field>
      <Field label="Cor">
        <div className="color-swatches">
          {Object.keys(PROJECT_HEX).map(k => (
            <button key={k} className={color === k ? 'on' : ''} style={{ background: PROJECT_HEX[k] }}
              onClick={() => setColor(k)} aria-pressed={color === k} aria-label={'Cor ' + (COLOR_LABEL[k] || k)} />
          ))}
        </div>
      </Field>
      <div className="field-row">
        <Field label="Data de início"><input type="date" className="control" value={start??''} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="Data de término"><input type="date" className="control" value={end??''} onChange={e => setEnd(e.target.value)} /></Field>
      </div>
      <FieldError>{dErr}</FieldError>
      </>
      )}
    </Modal>
  )
}
