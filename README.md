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

## Deploy grátis no Render (recomendado, sem cartão)

Forma mais simples e **sem custo** de colocar no ar: **backend** (Express) como _Web Service_ e **frontend** (build do Vite) como _Static Site_, os dois no [Render](https://render.com). O banco continua no **Neon** (o mesmo `DATABASE_URL` que você já usa). O arquivo [`render.yaml`](render.yaml) na raiz já descreve os dois serviços.

> **Antes de tudo:** faça `git push` do projeto para o GitHub — o Render faz deploy a partir do repositório.

### Passo a passo

1. **Suba para o GitHub** (se ainda não subiu): `git push origin main`.
2. Em [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint** → conecte o repositório `app-promav`. O Render lê o `render.yaml` e cria os dois serviços.
3. Quando pedir os valores secretos, preencha:
   - **`DATABASE_URL`** (no serviço `promav-api`): a connection string do Neon (a mesma do seu `.env`).
   - **`VITE_API_URL`** (no serviço `promav-web`): `https://promav-api.onrender.com` (a URL que o backend terá; confira no passo 4 e ajuste se o Render tiver mudado o nome).
4. Aguarde o deploy do **`promav-api`**. Abra-o e confirme a URL pública (algo como `https://promav-api.onrender.com`). Teste `…/api/health` → deve responder `{ "ok": true }`.
5. Se a URL real do backend for diferente da que você colocou em `VITE_API_URL`, ajuste no `promav-web` (**Environment**) e clique em **Manual Deploy → Clear build cache & deploy**.
6. Abra a URL do **`promav-web`** e faça login. Pronto. 🎉

> **Login:** use um usuário que já existe no seu banco Neon. O usuário com e-mail `ADMIN_EMAIL` (padrão `engenharia.promav@gmail.com`) vira administrador automaticamente; se ele não existir, o primeiro usuário do banco é promovido.

> **CORS:** por padrão o backend libera todas as origens (seguro aqui, pois a autenticação é por token, não por cookie). Para restringir, adicione a env `CORS_ORIGIN` no `promav-api` com a URL do site (`https://promav-web.onrender.com`).

### Pontos de atenção (plano grátis)

- O **backend grátis dorme** após ~15 min sem uso; a primeira visita depois disso leva ~50s para acordar. O frontend (estático) fica sempre no ar.
- O **`VITE_API_URL` é embutido no build** do frontend. Se trocar a URL do backend, refaça o deploy do `promav-web` (**Clear build cache & deploy**).
- O banco Neon grátis também hiberna; a primeira consulta o acorda em ~1s.

---

## Deploy alternativo (Firebase Hosting + Cloud Run)

> Requer uma conta Google Cloud com **faturamento ativado** (cartão na conta, embora o uso baixo caiba no nível gratuito). Se quer evitar cartão, use o Render acima.

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
| POST | `/projects/:id/files` | upload de documento/imagem (corpo = arquivo cru; `?kind`, `?filename`, `?label`, `?mime`) → guarda no banco e devolve o projeto |
| GET | `/files/:id` | baixa/serve um arquivo (aceita `?token=` para `<img>`/`<a>`) |

### Banco (Neon / Postgres)

Tabelas: `users`, `projects`, `tasks`, `task_members` (N:N), `checklist_items`, `time_sessions`, `files`.
Enums: `task_status` (todo/progress/done), `task_priority` (low/medium/high), `project_color`.
Excluir um projeto remove em cascata suas tarefas → checklist, membros, sessões e arquivos. Há índice único parcial garantindo **um cronômetro ativo por usuário**.

**Arquivos (`files`):** documentos e imagens enviados pela tela do projeto são guardados como `bytea` no Postgres (até **25 MB**, qualquer tipo). A tabela é criada automaticamente na subida do backend (`ensureSchema`, idempotente). Cada upload também adiciona um item em `projects.resources` no formato `{ id, type, fileId, filename, mime, size, label }`; **links** continuam como `{ id, type, url, label }` (URL externa). Ao remover um documento/imagem, o arquivo órfão é apagado do banco.

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
