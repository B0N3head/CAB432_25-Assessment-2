import config from './config.js'

let client = null
let lib = null

async function ensure() {
  if (!config.cache.enabled) return null
  if (!client) {
    const m = await import('memjs')
    lib = m.default || m
    client = lib.Client.create(config.cache.memcachedUrl)
  }
  return client
}

export async function cacheGet(key) {
  try {
    const c = await ensure(); if (!c) return null
    const res = await c.get(key)
    return res?.value ? JSON.parse(res.value.toString('utf8')) : null
  } catch { return null }
}

export async function cacheSet(key, value, ttlSec = 120) {
  try {
    const c = await ensure(); if (!c) return false
    await c.set(key, Buffer.from(JSON.stringify(value)), { expires: ttlSec })
    return true
  } catch { return false }
}

export async function cacheDel(key) {
  try { const c = await ensure(); if (!c) return false; await c.delete(key); return true } catch { return false }
}
