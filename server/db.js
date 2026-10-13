// Pool de conexão Postgres (Neon). Lê DATABASE_URL do .env.
import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

// Sem a URL o Pool nasceria apontando para lugar nenhum e a API subiria
// respondendo 500 em tudo — melhor parar aqui, em qualquer ambiente.
if (!process.env.DATABASE_URL) {
  console.error('\n[promav] DATABASE_URL não definida. Crie um arquivo .env (veja .env.example).\n')
  process.exit(1)
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
})

// Erros em clientes ociosos são emitidos pelo pool fora de uma chamada q().
// Sem listener, o EventEmitter do Node encerra o processo da API.
pool.on('error', (err) => {
  console.error('[promav] erro na conexão PostgreSQL:', err.message)
})

// Helper: query simples retornando as linhas.
export async function q(text, params) {
  const res = await pool.query(text, params)
  return res.rows
}

// Helper: executa uma função dentro de uma transação.
export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
