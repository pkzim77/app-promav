# Promav

App de gestão de projetos em **pt-BR** (inspirado no ClickUp): projetos, atividades, **Kanban** com arrastar-e-soltar, **Gantt**, **cronômetro por atividade** e **relatórios** — uma atividade criada dentro de um projeto aparece automaticamente no Kanban e no Gantt.

Estruturado como **React + Vite** no frontend e um backend **Express + PostgreSQL (Neon)** que persiste os dados.

## Como rodar

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

O Vite faz proxy de `/api` → `http://localhost:3001`, então o front e o back rodam no mesmo `npm run dev`.

## Deploy (Firebase Hosting + Cloud Run)

Dois serviços separados: **frontend** estático no Firebase Hosting, **backend** em container no Cloud Run. O banco continua no Neon.

### 1. Backend → Cloud Run

```bash
cp deploy.env.yaml.example deploy.env.yaml   # preencha DATABASE_URL, JWT_SECRET, CORS_ORIGIN

gcloud run deploy promav-api \
  --source . \
  --region southamerica-east1 \
  --allow-unauthenticated \
  --env-vars-file deploy.env.yaml
```

O `Dockerfile` na raiz é usado automaticamente. Ao terminar, o comando imprime a **URL do serviço** (algo como `https://promav-api-xxxx.run.app`) — copie.

> `CORS_ORIGIN` deve listar os domínios do Firebase (`https://SEU_PROJECT.web.app,https://SEU_PROJECT.firebaseapp.com`). O `PORT` é injetado pelo Cloud Run; não precisa definir.

### 2. Frontend → Firebase Hosting

```bash
# 1. aponte para a URL do backend que o Cloud Run gerou:
#    edite .env.production  ->  VITE_API_URL=https://promav-api-xxxx.run.app
# 2. configure o projeto (uma vez):
#    edite .firebaserc  ->  "default": "SEU_PROJECT_ID"   (ou rode: firebase use --add)

npm run build          # gera dist/ com a URL do backend embutida
firebase deploy --only hosting
```

Como o cliente HTTP usa `VITE_API_URL`, o build de produção fala direto com o Cloud Run; em desenvolvimento esse valor fica vazio e o proxy do Vite assume.

> **Importante:** o `VITE_API_URL` é embutido **no momento do `npm run build`** — se trocar a URL do backend, refaça o build e o deploy.

## Estrutura

```
.
├── index.html                # entry do Vite
├── vite.config.js            # inclui proxy /api → backend (dev)
├── package.json
├── .env.example              # modelo da DATABASE_URL (Neon) + JWT_SECRET
├── .env.production           # VITE_API_URL p/ o build do frontend (Cloud Run)
├── Dockerfile                # imagem do backend (Cloud Run)
├── .dockerignore / .gcloudignore
├── firebase.json / .firebaserc  # config do Firebase Hosting
├── deploy.env.yaml.example   # modelo das envs do backend no Cloud Run
├── server/                   # BACKEND (Express + Neon)
│   ├── index.js              # rotas REST /api/* + auth + CORS
│   ├── auth.js               # bcrypt + JWT + middleware requireAuth
│   └── db.js                 # pool de conexão Postgres (pg) + helpers q()/tx()
├── public/
│   └── assets/                # logos servidos em /assets/*
├── src/
│   ├── main.jsx               # ponto de entrada React (createRoot) + imports de CSS
│   ├── App.jsx                # raiz: rotas e handlers de CRUD/cronômetro (chamam a API)
│   ├── data/
│   │   ├── api.js             # cliente HTTP do backend (/api/*)
│   │   └── store.js           # paletas, enums e helpers de data/progresso
│   ├── components/            # blocos reutilizáveis
│   │   ├── Icon.jsx           # ícones de linha (derivados do Lucide), inline
│   │   ├── primitives.jsx     # Avatar, StatusTag, PriorityTag, ProgressBar, Modal, Field, Toast…
│   │   ├── TimeTracker.jsx    # cronômetro por atividade (widget + botão + helpers de tempo)
│   │   ├── Chrome.jsx         # Sidebar + TopBar + UserSelect
│   │   └── Modals.jsx         # TaskModal, ProjectModal, ConfirmDialog (com validação)
│   ├── screens/               # uma tela por arquivo
│   │   ├── Hub.jsx            # Visão geral
│   │   ├── Projects.jsx       # lista + detalhe do projeto (tabela de atividades)
│   │   ├── Kanban.jsx         # board com drag-and-drop
│   │   ├── Gantt.jsx          # linha do tempo
│   │   ├── Reports.jsx        # seleção de atividades para o relatório
│   │   ├── ReportView.jsx     # documento de relatório gerado (donut, rollup, impressão)
│   │   └── TeamReport.jsx     # tempo por pessoa/atividade (dia/semana/mês)
│   └── styles/
│       ├── tokens.css         # FONTE DOS TOKENS (cor, tipografia, espaçamento, elevação)
│       └── kit.css            # layout e estilo dos componentes (lê os tokens)
```

## API (backend)

Base: `/api` (proxy do Vite para a porta 3001).

> **Autenticação:** todas as rotas (exceto `/health` e `/auth/login`) exigem o header `Authorization: Bearer <token>`. O token é um JWT obtido no login e guardado no `localStorage` do navegador.

| Método | Rota | Descrição |
|--------|------|-----------|
| GET    | `/health` | ping do banco (público) |
| POST   | `/auth/login` | login por email+senha → `{ token, user }` (público) |
| GET    | `/auth/me` | dados do usuário do token (restaura a sessão) |
| POST   | `/auth/change-password` | troca a própria senha |
| GET    | `/bootstrap` | carga inicial: `{ users, projects, tasks, sessions }` |
| GET    | `/users` | lista usuários |
| GET/POST | `/projects` | listar / criar projeto |
| PUT/DELETE | `/projects/:id` | editar / excluir (cascata nas tarefas) |
| GET/POST | `/tasks` | listar / criar tarefa (com checklist + membros) |
| PUT/DELETE | `/tasks/:id` | editar / excluir tarefa |
| PATCH | `/tasks/:id/status` | mover no Kanban |
| GET | `/sessions` | sessões do cronômetro |
| POST | `/sessions/start` | inicia (fecha a ativa e abre nova) |
| POST | `/sessions/stop` | para a sessão ativa do usuário |

### Banco (Neon / Postgres)

Tabelas: `users`, `projects`, `tasks`, `task_members` (N:N), `checklist_items`, `time_sessions`.
Enums: `task_status` (todo/progress/done), `task_priority` (low/medium/high), `project_color`.
Excluir um projeto remove em cascata suas tarefas → checklist, membros e sessões. Há índice único parcial garantindo **um cronômetro ativo por usuário**.

### Login (usuários de exemplo)

Todos os usuários começam com a senha **`promav123`** (troque pela opção "Trocar senha" no menu do usuário):

| Email | Nome |
|-------|------|
| `marina@promav.app` | Marina Souza |
| `lucas@promav.app`  | Lucas Rocha |
| `camila@promav.app` | Camila Alves |
| `joao@promav.app`   | João Pereira |
| `rafael@promav.app` | Rafael Brito |

Senhas são guardadas com **bcrypt**; a sessão usa **JWT** assinado com `JWT_SECRET` (definido no `.env`).

## Notas

- Os dados agora são persistidos no **Neon**; a `DATABASE_URL` fica no `.env` (não versionado).
- "Hoje" é fixo (`2026-05-26` em `store.js`) para manter os exemplos estáveis nas telas.
- Fontes (Plus Jakarta Sans + JetBrains Mono) carregam via Google Fonts (`@import` no topo de `tokens.css`).
