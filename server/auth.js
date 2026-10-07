// Autenticação: hash de senha (bcrypt) + tokens JWT + middleware de proteção.
import 'dotenv/config'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

// Sem segredo em produção, qualquer um assinaria tokens com o valor padrão
// abaixo, que é público — melhor não subir. Em desenvolvimento o padrão serve.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[promav] JWT_SECRET obrigatório em produção. Defina a variável no serviço promav-api (render.yaml já gera com generateValue).')
    process.exit(1)
  }
  console.warn('[promav] JWT_SECRET não definido — usando segredo de desenvolvimento.')
}
const SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao'
const EXPIRES_IN = '7d'

export const hashPassword = (plain) => bcrypt.hash(plain, 10)
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash)

// Hash de sacrifício: o login o compara quando a conta não existe ou está sem
// senha, para gastar o mesmo tempo de bcrypt dos outros casos. Sem isso a
// resposta instantânea revelava, pelo relógio, quais e-mails estão cadastrados.
export const DUMMY_HASH = bcrypt.hashSync('promav-dummy-nao-autentica', 10)

export const signToken = (user) => jwt.sign({ sub: user.id }, SECRET, { expiresIn: EXPIRES_IN })

// Middleware: exige um Bearer token válido; injeta req.userId.
// Aceita o token no header Authorization ou, SÓ no download de arquivo
// (GET /files/:id), em ?token= — <img>/<a> não conseguem enviar headers. Nas
// demais rotas a query é ignorada: token na URL vai parar em histórico, logs e
// área de transferência, e lá o header funciona.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  // req.path já vem sem o /api: o Express recorta o caminho de montagem.
  const tokenDaQuery = req.path.startsWith('/files/') ? req.query.token : null
  const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || tokenDaQuery || null
  if (!token) return res.status(401).json({ error: 'Não autenticado.' })
  try {
    const payload = jwt.verify(token, SECRET)
    req.userId = payload.sub
    next()
  } catch {
    res.status(401).json({ error: 'Sessão expirada ou inválida.' })
  }
}
