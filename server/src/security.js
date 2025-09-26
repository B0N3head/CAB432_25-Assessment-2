import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret'
const JWT_EXPIRES = '1h'

// Simple user store for development (when not using Cognito)
export const users = [
  { id: 'admin', username: 'admin', password: 'admin123', role: 'admin' },
  { id: 'user1', username: 'user', password: 'user123', role: 'user' }
]

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
