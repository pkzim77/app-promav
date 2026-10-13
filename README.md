# Promav

App de gestão de projetos em **pt-BR** (inspirado no ClickUp): projetos, atividades, **Kanban** com arrastar-e-soltar, **Gantt**, **cronômetro por atividade** e **relatórios** — uma atividade criada dentro de um projeto aparece automaticamente no Kanban e no Gantt.

Estruturado como **React + Vite** no frontend e um backend **Express + PostgreSQL (Neon)** que persiste os dados.

## Como rodar

Requer **Node 24.x** — a versão fica fixada em `engines` no `package.json`, e o Render usa a mesma no deploy.

```bash
npm install      # instala dependências (uma vez)
cp .env.example .env   # e preencha DATABASE_URL com sua connection string do Neon
npm run dev      # sobe FRONT (Vite) + BACK (Express) juntos
```

Outros scripts:

```bash
npm run dev:web  # só o frontend (Vite)
npm run server   # só o backend (Express, porta 3001)
npm run build    # build de produção do frontend em dist/
npm run preview  # serve a build de produção localmente
```

Testes (`*.test.js(x)`, `*.spec.js(x)`) são locais e não versionados — ver a seção "Testes locais" do `.gitignore`; por isso `npm test` passa mesmo sem arquivos de teste no clone.

O Vite faz proxy de `/api` → `http://localhost:3001`, então o front e o back rodam no mesmo `npm run dev`.

## Deploy grátis no Render (recomendado, sem cartão)

Forma mais simples e **sem custo** de colocar no ar: **backend** (Express) como _Web Service_ e **frontend** (build do Vite) como _Static Site_, os dois no [Render](https://render.com). O banco continua no **Neon** (o mesmo `DATABASE_URL` que você já usa). O arquivo [`render.yaml`](render.yaml) na raiz já descreve os dois serviços.

> **Antes de tudo:** faça `git push` do projeto para o GitHub — o Render faz deploy a partir do repositório.

### Passo a passo

1. **Suba para o GitHub** (se ainda não subiu): `git push origin main`.
2. Em [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint** → conecte o repositório `app-promav`. O Render lê o `render.yaml` e cria os dois serviços.
3. Quando pedir os valores secretos, preencha:
   - **`DATABASE_URL`** (no serviço `promav-api`): a connection string do Neon (a mesma do seu `.env`).
   - **`DEV_EMAILS`** (no serviço `promav-api`): e-mails da equipe que mantém o app, separados por vírgula — pode deixar vazio para usar a lista fixa do código.
   - **`VITE_API_URL`** (no serviço `promav-web`): `https://promav-api.onrender.com` (a URL que o backend terá; confira no passo 4 e ajuste se o Render tiver mudado o nome).
4. Aguarde o deploy do **`promav-api`**. Abra-o e confirme a URL pública (algo como `https://promav-api.onrender.com`). Teste `…/api/health` → deve responder `{ "ok": true }`.
5. Se a URL real do backend for diferente da que você colocou em `VITE_API_URL`, ajuste no `promav-web` (**Environment**) e clique em **Manual Deploy → Clear build cache & deploy**.
6. Abra a URL do **`promav-web`** e faça login. Pronto. 🎉

> **Login:** use um usuário que já existe no seu banco Neon. O usuário com e-mail `ADMIN_EMAIL` (padrão `engenharia.promav@gmail.com`) vira administrador automaticamente; se não houver **nenhum** administrador no banco, o primeiro usuário é promovido.

> **CORS:** por padrão o backend libera todas as origens (seguro aqui, pois a autenticação é por token, não por cookie). Para restringir, adicione a env `CORS_ORIGIN` no `promav-api` com a URL do site (`https://promav-web.onrender.com`).

### Pontos de atenção (plano grátis)

- O **backend grátis dorme** após ~15 min sem uso; a primeira visita depois disso leva ~50s para acordar. O frontend (estático) fica sempre no ar.
- O **`VITE_API_URL` é embutido no build** do frontend. Se trocar a URL do backend, refaça o deploy do `promav-web` (**Clear build cache & deploy**).
- O banco Neon grátis também hiberna; a primeira consulta o acorda em ~1s.

---

## Estrutura

```
.
├── index.html                # entry do Vite + <link> das fontes do Google
├── vite.config.js            # proxy /api → backend (dev)
├── package.json
├── render.yaml               # Blueprint do deploy no Render (API + site)
├── .env.example              # modelo da DATABASE_URL (Neon) + JWT_SECRET
├── .env.production           # VITE_API_URL usado no build do frontend
├── server/                   # BACKEND (Express + Neon)
│   ├── index.js              # rotas REST /api/*, gates de permissão e ensureSchema
│   ├── auth.js               # bcrypt + JWT + middleware requireAuth
│   ├── db.js                 # pool do Postgres (pg) + helpers q()/tx()
│   └── schema.sql            # tabelas-base, enums e índices (aplicar uma vez num banco novo)
└── src/
    ├── main.jsx              # ponto de entrada React (createRoot) + imports de CSS
    ├── App.jsx               # raiz: telas, estado global e handlers de CRUD/cronômetro
    ├── data/
    │   ├── api.js            # cliente HTTP do backend (/api/*)
    │   ├── store.js          # paletas, enums, cargos e helpers de data
    │   ├── progresso.js      # regra única de "item feito" e progresso da etapa
    │   ├── avisos.js         # avisos do Panorama (relatório da semana, ciências pendentes)
    │   └── usePersistido.js  # estado espelhado no localStorage, por usuário
    ├── components/
    │   ├── ErrorBoundary.jsx # captura erro de render e mostra tela de recuperação
    │   ├── Icon.jsx          # ícones de linha (derivados do Lucide), inline
    │   ├── primitives/       # Avatar, StatusTag, PriorityTag, ProgressBar, Modal, Field, Toast…
    │   ├── Chrome/           # Sidebar + TopBar + busca de projeto
    │   ├── Logo/             # logo desenhada em texto (não é imagem)
    │   ├── TimeTracker/      # cronômetro por atividade
    │   ├── KmzMap/           # traçado do projeto (KMZ) sobre o mapa
    │   └── Modals/           # um modal por arquivo (projeto, etapa, pessoa, mudança…)
    │       └── shared/       # pedaços usados por vários modais (validação, KMZ, dinheiro)
    ├── screens/              # uma pasta por tela, com o CSS ao lado
    │   ├── Hub/              # Panorama
    │   ├── Projects/         # lista (ProjectList/) e detalhe (ProjectDetail/) do projeto
    │   ├── Kanban/           # board com arrastar-e-soltar
    │   ├── Gantt/            # linha do tempo
    │   ├── List/             # tabela de atividades
    │   ├── People/           # profissionais
    │   ├── Login/
    │   ├── Reports/          # seleção de atividades para o relatório
    │   ├── ReportView/       # documento gerado (donut, rollup, impressão)
    │   ├── TeamReport/       # tempo por pessoa/atividade (dia/semana/mês)
    │   └── WeeklyReport/     # relatório semanal da pessoa + painel do admin
    └── styles/
        ├── tokens.css        # FONTE DOS TOKENS (cor, tipografia, espaçamento, elevação)
        └── kit.css           # layout e estilo compartilhados (leem os tokens)
```

## API (backend)

Base: `/api` (proxy do Vite para a porta 3001).

> **Autenticação:** todas as rotas, exceto `/health` e `/auth/login`, exigem o header `Authorization: Bearer <token>`. O token é um JWT obtido no login e guardado no `localStorage` do navegador. Quem foi inativado, virou terceirizado ou foi excluído cai em 401 na requisição seguinte, mesmo com o token ainda válido.

A coluna **Quem pode** resume o gate de cada rota: **público** (sem token), **logado** (qualquer pessoa da equipe), **admin** (`requireAdmin`) e **projeto: …** (papel da pessoa naquele projeto — _leve_ mexe no dia a dia, _editar_ cria e exclui, _publicar_ publica mudanças, _admin_ é só do administrador).

| Método | Rota | Quem pode | O que faz |
|--------|------|-----------|-----------|
| GET | `/health` | público | ping do banco → `{ ok: true, now }` |
| POST | `/auth/login` | público | email + senha → `{ token, user }` (com limite de tentativas por IP) |
| GET | `/pulse` | logado | carimbo do estado do banco (~100 bytes); o front só refaz o `/bootstrap` quando ele muda |
| GET | `/auth/me` | logado | dados do usuário do token (restaura a sessão) |
| POST | `/auth/change-password` | logado | troca a própria senha |
| GET | `/bootstrap` | logado | carga inicial: `{ users, projects, tasks, sessions, folders, changes, relatorioSemana }` — só o que a pessoa enxerga |
| POST | `/users` | admin | cadastra profissional (o admin define a senha inicial) |
| PUT | `/users/:id` | admin | edita profissional (dados, papel, ativo/terceirizado) |
| DELETE | `/users/:id` | admin | exclui profissional |
| POST | `/projects` | admin | cria projeto |
| PUT | `/projects/reorder` | admin | move e reordena projetos entre pastas |
| PUT | `/projects/:id` | projeto: editar | edita o projeto |
| DELETE | `/projects/:id` | projeto: admin | exclui o projeto (cascata nas atividades) |
| POST | `/projects/:id/resources` | projeto: leve | adiciona um material (link) |
| DELETE | `/projects/:id/resources/:rid` | projeto: editar | remove um material |
| POST | `/folders` | admin | cria pasta da sidebar |
| PUT | `/folders/reorder` | admin | move e reordena pastas |
| PUT | `/folders/:id` | admin | renomeia pasta |
| DELETE | `/folders/:id` | admin | exclui pasta |
| POST | `/projects/:id/files` | projeto: leve | upload de documento/imagem/KMZ (corpo = arquivo cru; `?kind`, `?filename`, `?label`, `?mime`) → devolve o projeto |
| GET | `/files/:id` | projeto: leve | baixa/serve um arquivo; aceita `?token=` (só aqui) para `<img>`/`<a>` |
| POST | `/tasks` | projeto: editar | cria atividade (com checklist + membros) |
| PUT | `/tasks/:id` | projeto: editar | edita a atividade |
| PATCH | `/tasks/:id/status` | projeto: leve | move no Kanban |
| PATCH | `/tasks/:id/checklist` | projeto: leve | marca, move o estado ou atribui itens que já existem |
| POST | `/tasks/:id/membership` | projeto: leve | a pessoa entra ou sai da atividade |
| POST | `/projects/:id/stages` | projeto: admin | cria as etapas do template que ainda faltam |
| POST | `/tasks/:id/checklist` | projeto: editar | acrescenta um ou vários itens ao checklist |
| POST | `/tasks/:id/view` | projeto: leve | registra que a pessoa abriu a atividade |
| DELETE | `/tasks/:id/checklist/:itemId` | projeto: editar | remove item do checklist |
| POST | `/tasks/bulk-delete` | projeto: editar | exclui várias etapas; falta de permissão em uma derruba a operação inteira |
| DELETE | `/tasks/:id` | projeto: editar | exclui a atividade |
| POST | `/sessions/start` | projeto: leve | inicia o cronômetro (fecha a ativa e abre nova) → `{ fechadas, aberta }` |
| POST | `/sessions/stop` | logado | para a própria sessão ativa → `{ fechadas, aberta: null }` |
| POST | `/projects/:id/changes` | projeto: publicar | publica uma mudança: grava, cria o item na etapa e abre a ciência da equipe |
| PUT | `/changes/:id` | projeto: editar | edita a mudança e reabre a ciência de todo mundo |
| POST | `/changes/:id/decide` | projeto: leve | aceita ou recusa uma sugestão — só o destinatário (recusar exige motivo) |
| PUT | `/users/:id/sector` | admin | define o setor de uma pessoa |
| POST | `/auth/sector` | logado | a própria pessoa declara seu setor |
| POST | `/changes/:id/ack` | projeto: leve | confirma a ciência ("eu vi") da própria pessoa |
| GET | `/checklist-suggestions` | logado | textos de checklist já usados, agrupados pelo número da etapa |
| GET | `/weekly-reports/me` | logado | o próprio relatório da semana + sugestão a partir das atividades |
| PUT | `/weekly-reports/me` | logado | salva o rascunho ou envia |
| GET | `/weekly-reports` | admin | painel do admin: o que foi enviado na semana e quem falta |

### Banco (Neon / Postgres)

São **13 tabelas**. As seis **base** ficam versionadas em [`server/schema.sql`](server/schema.sql) e precisam ser aplicadas **uma vez** num banco novo (psql ou console do Neon): `users`, `projects`, `tasks`, `task_members` (N:N), `checklist_items` e `time_sessions` — junto com os enums `task_status` (todo/progress/review/diligence/done), `task_priority` (low/medium/high) e `project_color`.

As outras sete são criadas pelo `ensureSchema`, na subida do backend: `files`, `folders`, `changes`, `change_acks`, `task_views`, `project_members` e `weekly_reports`. Ele é idempotente e, além dessas tabelas, aplica os `ALTER TABLE … IF NOT EXISTS` das colunas novas, normaliza dados legados (setor, estado do checklist, responsáveis órfãos) e garante que exista ao menos um administrador (`ADMIN_EMAIL`).

Excluir um projeto remove em cascata suas tarefas → checklist, membros, sessões e arquivos. O índice único parcial `idx_sessions_one_active_per_user` garante **um cronômetro ativo por usuário**.

**Arquivos (`files`):** documentos e imagens enviados pela tela do projeto são guardados como `bytea` no Postgres (até **25 MB**, qualquer tipo). A tabela é criada automaticamente na subida do backend (`ensureSchema`, idempotente). Cada upload também adiciona um item em `projects.resources` no formato `{ id, type, fileId, filename, mime, size, label }`; **links** continuam como `{ id, type, url, label }` (URL externa). Ao remover um documento/imagem, o arquivo órfão é apagado do banco.

### Login

Senhas são guardadas com **bcrypt**; a sessão usa **JWT** assinado com `JWT_SECRET` (definido no `.env`).

Usuários são cadastrados pelo administrador na tela **Profissionais**, que define a senha inicial; cada pessoa troca a senha em **Trocar senha**, no menu do usuário.

## Notas

- Os dados agora são persistidos no **Neon**; a `DATABASE_URL` fica no `.env` (não versionado).
- Fontes (Plus Jakarta Sans, JetBrains Mono e Poppins) carregam do Google Fonts por `<link>` no `index.html`; as famílias ficam em tokens no `tokens.css`.
