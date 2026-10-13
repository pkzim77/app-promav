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
// Link de arquivo: mesma validade da sessão, para o link copiado continuar
// servindo a semana como antes — mas o token abre UM arquivo e mais nada.
// Era o JWT de sessão inteiro que ia na URL: quem recebesse um link copiado
// entrava como quem copiou, admin inclusive, em qualquer rota, por 7 dias.
const FILE_EXPIRES_IN = '7d'

export const hashPassword = (plain) => bcrypt.hash(plain, 10)
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash)

// Hash de sacrifício: o login o compara quando a conta não existe ou está sem
// senha, para gastar o mesmo tempo de bcrypt dos outros casos. Sem isso a
// resposta instantânea revelava, pelo relógio, quais e-mails estão cadastrados.
export const DUMMY_HASH = bcrypt.hashSync('promav-dummy-nao-autentica', 10)

export const signToken = (user) => jwt.sign({ sub: user.id }, SECRET, { expiresIn: EXPIRES_IN })

// `sub` continua sendo quem pediu o link: o middleware que carrega o usuário
// roda igual, então o link morre junto com a conta que o gerou (inativada,
// terceirizada ou excluída) sem precisar de lista de revogação.
export const signFileToken = (userId, fileId) =>
  jwt.sign({ sub: userId, typ: 'file', fid: fileId }, SECRET, { expiresIn: FILE_EXPIRES_IN })

// Middleware: exige um Bearer token válido; injeta req.userId.
// O header serve a tudo. A query (?t=) é lida SÓ no download de arquivo, onde
// <img>/<a> não conseguem enviar header — e lá só vale token de arquivo:
// token na URL vai parar em histórico, Referer, logs e área de transferência,
// e o de sessão daria a conta inteira a quem recebesse o link.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  // req.path já vem sem o /api: o Express recorta o caminho de montagem.
  const doHeader = header.startsWith('Bearer ') ? header.slice(7) : null
  const daQuery = req.path.startsWith('/files/') ? req.query.t : null
  const token = doHeader || daQuery || null
  if (!token) return res.status(401).json({ error: 'Não autenticado.' })

  let payload
  try { payload = jwt.verify(token, SECRET) }
  catch { return res.status(401).json({ error: 'Sessão expirada ou inválida.' }) }

  // Token sem `sub` passava e deixava req.userId undefined, que depois virava
  // consulta com parâmetro vazio em vez de 401.
  if (typeof payload.sub !== 'string') return res.status(401).json({ error: 'Sessão inválida.' })

  if (payload.typ === 'file') {
    // Token de arquivo abre um arquivo, por GET, e nada mais. Sem esta linha
    // ele valeria em qualquer rota /api — que é justamente o que ele veio
    // resolver. A checagem fica aqui porque requireAuth roda antes das rotas.
    if (req.method !== 'GET' || req.path !== '/files/' + payload.fid) {
      return res.status(401).json({ error: 'Este link abre apenas o arquivo dele.' })
    }
  } else if (payload.typ || !doHeader) {
    // Tipo desconhecido, ou token de sessão vindo pela URL: recusa. É o fim do
    // `?token=<sessão>` que o front montava para <img>/<a>.
    return res.status(401).json({ error: 'Sessão inválida.' })
  }

  req.userId = payload.sub
  next()
}
