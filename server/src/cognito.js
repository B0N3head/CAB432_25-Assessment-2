import jwkToPem from 'jwk-to-pem'
import jwt from 'jsonwebtoken'
import fetch from 'node-fetch'
import config from './config.js'

// Cache JWKS per user pool
const jwksCache = new Map()

async function getJwks(userPoolId) {
  if (jwksCache.has(userPoolId)) return jwksCache.get(userPoolId)
  const url = `https://cognito-idp.${config.region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch JWKS')
  const data = await res.json()
  jwksCache.set(userPoolId, data.keys)
  return data.keys
}

export async function verifyCognitoToken(token) {
  if (!token) throw new Error('missing token')
  
  try {
    const decoded = jwt.decode(token, { complete: true })
    if (!decoded || !decoded.header) {
      console.error('Token decode failed: invalid token structure')
      throw new Error('invalid token')
    }
    
    const kid = decoded.header.kid
    console.log('Token kid:', kid, 'User Pool ID:', config.cognito.userPoolId)
    
    const keys = await getJwks(config.cognito.userPoolId)
    const jwk = keys.find(k => k.kid === kid)
    if (!jwk) {
      console.error('Public key not found for kid:', kid, 'Available kids:', keys.map(k => k.kid))
      throw new Error('public key not found')
    }
    
    const pem = jwkToPem(jwk)
    const verified = jwt.verify(token, pem, { algorithms: ['RS256'] })
    console.log('Token verified successfully for user:', verified.sub)
    return verified
    
  } catch (error) {
    console.error('Token verification failed:', error.message)
    console.error('Token (first 50 chars):', token.substring(0, 50) + '...')
    throw error
  }
}

export function authMiddlewareCognito() {
  return async (req, res, next) => {
    try {
      const header = req.headers['authorization'] || ''
      const raw = header.startsWith('Bearer ') ? header.slice(7) : header
      const token = raw || (typeof req.query?.token === 'string' ? req.query.token.replace(/^Bearer\s+/,'') : '')
      
      console.log('Auth middleware - Authorization header present:', !!header)
      console.log('Auth middleware - Token extracted:', !!token)
      
      if (!token) {
        console.log('Auth middleware - No token found')
        return res.status(401).json({ error: 'missing token' })
      }
      
      const decoded = await verifyCognitoToken(token)
      // Map Cognito groups to your role field for compatibility
      const groups = decoded['cognito:groups'] || []
      const role = groups.includes('Admin') ? 'admin' : groups.includes('Editor') ? 'editor' : 'viewer'
      req.user = { id: decoded.sub, username: decoded['cognito:username'] || decoded.email, role, groups }
      console.log('Auth middleware - User authenticated:', req.user.username)
      next()
    } catch (e) {
      console.error('Auth middleware - Authentication failed:', e.message)
      return res.status(401).json({ error: 'invalid token' })
    }
  }
}
