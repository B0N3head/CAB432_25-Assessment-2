import jwt from 'jsonwebtoken'


// Hardcoded users for assignment 1 going to have to change to AWS solution
export const users = [
  { id:'u-admin', username:'admin', password:'admin123', role:'admin' },
  { id:'u-alice', username:'alice', password:'alice123', role:'editor' },
  { id:'u-bob',   username:'bob',   password:'bob123',   role:'viewer' },
]

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret'
const JWT_EXPIRES = '1h'

export function signToken(payload){
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

export function authMiddleware(req,res,next){
  const header = req.headers['authorization'] || ''
  let token = header.startsWith('Bearer ') ? header.slice(7) : header
  if (!token) {
    const q = req.query?.token || ''
    if (typeof q === 'string' && q.length > 0) {
      token = q.startsWith('Bearer ') ? q.slice(7) : q
    }
  }
  if (!token) return res.status(401).json({ error:'missing token' })
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch (e) {
    return res.status(401).json({ error:'invalid token' })
  }
}

export function requireRole(role){
  return (req,res,next)=> {
    if (req.user?.role === role) return next()
    return res.status(403).json({ error:'forbidden' })
  }
}
