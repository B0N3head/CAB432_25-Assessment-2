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
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || !decoded.header) throw new Error('invalid token')
  const kid = decoded.header.kid
  const keys = await getJwks(config.cognito.userPoolId)
  const jwk = keys.find(k => k.kid === kid)
  if (!jwk) throw new Error('public key not found')
  const pem = jwkToPem(jwk)
  const verified = jwt.verify(token, pem, { algorithms: ['RS256'] })
  return verified
}

export function authMiddlewareCognito() {
  return async (req, res, next) => {
    try {
      const header = req.headers['authorization'] || ''
      const raw = header.startsWith('Bearer ') ? header.slice(7) : header
      const token = raw || (typeof req.query?.token === 'string' ? req.query.token.replace(/^Bearer\s+/,'') : '')
      if (!token) return res.status(401).json({ error: 'missing token' })
      const decoded = await verifyCognitoToken(token)
      // Map Cognito groups to your role field for compatibility
      const groups = decoded['cognito:groups'] || []
      const role = groups.includes('Admin') ? 'admin' : groups.includes('Editor') ? 'editor' : 'viewer'
      req.user = { id: decoded.sub, username: decoded['cognito:username'] || decoded.email, role, groups }
      next()
    } catch (e) {
      return res.status(401).json({ error: 'invalid token' })
    }
  }
}
