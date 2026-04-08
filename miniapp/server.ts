import { readFileSync } from 'fs'
import { join } from 'path'
import { SelverAPI, type PantryItem } from '../mcp-server/selver-api'

const PORT = 3100
const PUBLIC_DIR = join(import.meta.dir, 'public')

// ── Telegram Bot Token ────────────────────────────────────────────────────

const BOT_TOKEN = (() => {
  const envPath = join(import.meta.dir, '..', '.telegram', '.env')
  const content = readFileSync(envPath, 'utf8')
  const match = content.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m)
  if (!match) throw new Error('TELEGRAM_BOT_TOKEN not found in .telegram/.env')
  return match[1].trim()
})()

// ── Telegram initData Validation ──────────────────────────────────────────

async function validateInitData(initData: string): Promise<boolean> {
  if (!initData) return false

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return false

  params.delete('hash')
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n')

  const encoder = new TextEncoder()
  const secretKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const secretHash = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(BOT_TOKEN))

  const validationKey = await crypto.subtle.importKey(
    'raw',
    secretHash,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', validationKey, encoder.encode(dataCheckString))

  const computedHash = Buffer.from(signature).toString('hex')
  return computedHash === hash
}

// ── Helpers ───────────────────────────────────────────────────────────────

const api = new SelverAPI()

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

// ── MIME types ─────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function getMime(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'))
  return MIME[ext] || 'application/octet-stream'
}

// ── Auth middleware ───────────────────────────────────────────────────────

async function requireAuth(req: Request): Promise<Response | null> {
  const initData =
    req.headers.get('X-Telegram-Init-Data') ||
    new URL(req.url).searchParams.get('initData') ||
    ''

  // Skip auth if no initData (dev mode / first launch)
  // TODO: enforce in production
  if (!initData) return null
  if (!await validateInitData(initData)) {
    return err('Invalid or missing Telegram initData', 401)
  }
  return null
}

// ── Route matching ────────────────────────────────────────────────────────

function matchRoute(method: string, pathname: string): { handler: string; index?: number; query?: string } | null {
  if (method === 'GET' && pathname === '/api/pantry') return { handler: 'pantry.list' }
  if (method === 'POST' && pathname === '/api/pantry') return { handler: 'pantry.add' }
  if (method === 'POST' && pathname === '/api/pantry/enrich') return { handler: 'pantry.enrich' }
  if (method === 'GET' && pathname === '/api/search') return { handler: 'search' }
  if (method === 'GET' && pathname === '/api/config') return { handler: 'config' }

  const pantryMatch = pathname.match(/^\/api\/pantry\/(\d+)$/)
  if (pantryMatch) {
    const index = parseInt(pantryMatch[1], 10)
    if (method === 'PATCH') return { handler: 'pantry.update', index }
    if (method === 'DELETE') return { handler: 'pantry.remove', index }
  }

  return null
}

// ── Server ────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url)
    const { pathname } = url

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // ── API routes ──────────────────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
      const authErr = await requireAuth(req)
      if (authErr) return authErr

      const route = matchRoute(req.method, pathname)
      if (!route) return err('Not found', 404)

      try {
        switch (route.handler) {
          case 'pantry.list': {
            return json(api.loadPantry())
          }

          case 'pantry.add': {
            const body = await req.json() as Partial<PantryItem>
            if (!body.name) return err('name is required')
            const items = api.pantryAdd(body.name, body.quantity, body.unit, body.category)
            return json(items)
          }

          case 'pantry.update': {
            const items = api.loadPantry()
            if (route.index! < 0 || route.index! >= items.length) return err('Index out of range', 404)
            const body = await req.json() as Partial<PantryItem>
            Object.assign(items[route.index!], body)
            api.savePantry(items)
            return json(items)
          }

          case 'pantry.remove': {
            const items = api.loadPantry()
            if (route.index! < 0 || route.index! >= items.length) return err('Index out of range', 404)
            items.splice(route.index!, 1)
            api.savePantry(items)
            return json(items)
          }

          case 'pantry.enrich': {
            const items = api.loadPantry()
            let changed = 0
            for (const item of items) {
              if (item.image) continue
              // Try several search strategies
              const nameParts = item.name.split(',')
              const queries = [
                item.name,                          // exact full name
                nameParts[0].trim(),                // before first comma
                nameParts[0].trim().split(' ').slice(0, 2).join(' '), // first 2 words
                nameParts[0].trim().split(' ')[0],  // first word only
              ]
              for (const q of queries) {
                if (!q || q.length < 2) continue
                try {
                  const results = await api.searchProducts(q, undefined, 5)
                  // Best match: exact name
                  const match = results.find(p =>
                    p.name.toLowerCase() === item.name.toLowerCase()
                  ) || results.find(p => {
                    const pFirst = p.name.split(',')[0].toLowerCase().trim()
                    const iFirst = nameParts[0].toLowerCase().trim()
                    return pFirst === iFirst || iFirst.includes(pFirst) || pFirst.includes(iFirst)
                  }) || (queries.indexOf(q) === queries.length - 1 ? results[0] : null)
                  if (match?.image) {
                    item.image = match.image
                    changed++
                    break
                  }
                } catch { /* skip */ }
              }
            }
            if (changed > 0) api.savePantry(items)
            return json({ enriched: changed, total: items.length })
          }

          case 'search': {
            const q = url.searchParams.get('q') || ''
            if (!q) return err('q parameter is required')
            const products = await api.searchProducts(q)
            return json(products)
          }

          case 'config': {
            return json(api.loadConfig())
          }
        }
      } catch (e: any) {
        return err(e.message || 'Internal server error', 500)
      }

      return err('Not found', 404)
    }

    // ── Static files ────────────────────────────────────────────────────
    const filePath = pathname === '/' ? '/index.html' : pathname
    const file = Bun.file(join(PUBLIC_DIR, filePath))
    if (await file.exists()) {
      return new Response(file, {
        headers: { 'Content-Type': getMime(filePath), ...CORS },
      })
    }

    return err('Not found', 404)
  },
})

console.log(`Selver MiniApp server running on http://localhost:${PORT}`)
