-- ============================================================
-- Promav — tabelas-base do banco (Postgres/Neon)
--
-- Aplicar UMA vez num banco novo (psql ou console do Neon). ensureSchema em
-- server/index.js cria o resto (files, folders, changes, change_acks,
-- task_views, project_members, weekly_reports) e aplica os ALTERs
-- idempotentes.
--
-- O que está aqui NÃO entra no ensureSchema de propósito: CREATE TYPE não tem
-- IF NOT EXISTS, a ordem das FKs importa, e seriam ~9 idas a mais ao Neon
-- (~234 ms cada) em todo cold start para conferir o que nunca muda.
-- ============================================================

-- ----- enums -----
-- A ordem declarada é a que qualquer ORDER BY status usa, e valor de enum não
-- pode ser removido depois: os cinco entram já com o nome definitivo e na
-- ordem do fluxo de trabalho. Espelham STATUSES/PRIORITIES/PROJECT_COLORS de
-- src/data/store.js.
CREATE TYPE task_status AS ENUM ('todo', 'progress', 'review', 'diligence', 'done');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE project_color AS ENUM ('indigo', 'blue', 'teal', 'green', 'amber', 'coral', 'pink', 'purple');

-- ----- tabelas, na ordem em que cada FK encontra o que referencia -----

-- email e password_hash aceitam NULL por causa do terceirizado: ele não entra
-- no sistema, então não tem senha, e para ele o e-mail é contato — e contato
-- pode não existir.
CREATE TABLE users (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  initials      text NOT NULL,
  color         text NOT NULL,
  email         text,
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Prazo aceita NULL: o cadastro grava o que a pessoa tem na mão e cobra as
-- datas depois, pelo aviso de pendência — enquanto as colunas eram NOT NULL o
-- formulário deixava salvar em branco e a gravação morria no banco.
CREATE TABLE projects (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  color       project_color NOT NULL DEFAULT 'indigo',
  start_date  date,
  end_date    date,
  notes       text NOT NULL DEFAULT '',
  -- Materiais do projeto: links colados e arquivos enviados, no formato que
  -- normalizeResources (server/index.js) grava.
  resources   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_dates_chk CHECK (end_date >= start_date)
);

CREATE TABLE tasks (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  assignee_id text REFERENCES users(id) ON DELETE SET NULL,
  -- Subatividade: NULL = atividade de primeiro nível.
  parent_id   text REFERENCES tasks(id) ON DELETE CASCADE,
  status      task_status NOT NULL DEFAULT 'todo',
  priority    task_priority NOT NULL DEFAULT 'medium',
  start_date  date,
  end_date    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_dates_chk CHECK (end_date >= start_date)
);

-- Quem participa da atividade além do responsável (tasks.assignee_id).
CREATE TABLE task_members (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE checklist_items (
  id       text PRIMARY KEY,
  task_id  text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text     text NOT NULL,
  done     boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0
);

-- Cronômetro. end_at NULL = sessão em andamento.
CREATE TABLE time_sessions (
  id       text PRIMARY KEY,
  user_id  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id  text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at   timestamptz
);

-- ----- índices -----
-- O lado REFERENCIADOR de uma FK não ganha índice sozinho, e é justamente ele
-- que o Postgres varre a cada DELETE do lado referenciado.
CREATE INDEX idx_tasks_project ON tasks (project_id);
CREATE INDEX idx_tasks_assignee ON tasks (assignee_id);
CREATE INDEX idx_task_members_user ON task_members (user_id);
CREATE INDEX idx_checklist_task ON checklist_items (task_id);
CREATE INDEX idx_sessions_task ON time_sessions (task_id);
CREATE INDEX idx_sessions_user ON time_sessions (user_id);

-- Um cronômetro ativo por pessoa, garantido pelo banco: /api/sessions/start
-- conta com ele para absorver dois cliques no "play" que chegam juntos (23505)
-- em vez de deixar o tempo da pessoa contar dobrado.
CREATE UNIQUE INDEX idx_sessions_one_active_per_user ON time_sessions (user_id) WHERE end_at IS NULL;

-- O login compara lower(email): sem o índice, "Ana@x" e "ana@x" viravam duas
-- contas e a mesma credencial abriria qualquer uma das duas.
CREATE UNIQUE INDEX idx_users_email ON users (lower(email));
