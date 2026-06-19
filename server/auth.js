// Autenticação: hash de senha (bcrypt) + tokens JWT + middleware de proteção.
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao'
const EXPIRES_IN = '7d'

export const hashPassword = (plain) => bcrypt.hash(plain, 10)
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash)

export const signToken = (user) => jwt.sign({ sub: user.id }, SECRET, { expiresIn: EXPIRES_IN })

// Middleware: exige um Bearer token válido; injeta req.userId.
// Aceita o token no header Authorization OU em ?token= (para <img>/<a>, que
// não conseguem enviar headers ao baixar um arquivo servido pela API).
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token || null
  if (!token) return res.status(401).json({ error: 'Não autenticado.' })
  try {
    const payload = jwt.verify(token, SECRET)
    req.userId = payload.sub
    next()
  } catch {
    res.status(401).json({ error: 'Sessão expirada ou inválida.' })
  }
}
