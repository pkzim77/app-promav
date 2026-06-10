// Pool de conexão Postgres (Neon). Lê DATABASE_URL do .env.
import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  console.error('\n[promav] DATABASE_URL não definida. Crie um arquivo .env (veja .env.example).\n')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
