#!/usr/bin/env bun
/**
 * Selver.ee MCP Server
 *
 * Tools for grocery shopping: product search, cart management,
 * pantry tracking, delivery timeslots, family config.
 *
 * Runs as stdio MCP server under Bun.
 */

import { dirname, join } from 'path'
import { existsSync, readFileSync } from 'fs'

// Load .env from project root (parent of mcp-server/)
const ROOT = dirname(import.meta.dir)
const envFile = join(ROOT, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { z } from 'zod'

import { CATEGORIES, searchProducts, getDeals } from './src/catalog.js'
import { SelverAuth } from './src/auth.js'
import * as cart from './src/cart.js'
import { createStorage } from './src/storage.js'

const auth = new SelverAuth()
const storage = createStorage()

const categoryKeys = Object.keys(CATEGORIES).join(', ')

const server = new McpServer(
  { name: 'selver', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    instructions: `MCP server for Selver.ee — Estonia's largest grocery store. Tools for product search, cart management, pantry tracking, and delivery scheduling. Product names are in Estonian. Storage backend: ${storage.backend}.`,
  },
)

// ── Catalog tools (no auth required) ──────────────────────────────────────

function paginationFooter(offset: number, limit: number, total: number): string {
  const hasMore = offset + limit < total
  return `\n--- ${offset + 1}–${Math.min(offset + limit, total)} of ${total}${hasMore ? ` | next offset: ${offset + limit}` : ''}`
}

server.tool(
  'selver_search_products',
  `Search Selver.ee products by name (Estonian or partial). Returns name, SKU, price, stock status. No auth required. Category keys: ${categoryKeys}`,
  {
    query: z.string(),
    category: z.string().optional(),
    limit: z.number().optional().describe('Max results (default 10)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
  },
  async ({ query, category, limit, offset }) => {
    const l = limit || 10
    const o = offset || 0
    const categoryId = category ? CATEGORIES[category]?.id : undefined
    const { products, total } = await searchProducts(query, categoryId, l, o)
    return {
      content: [{
        type: 'text',
        text: products.length
          ? products.map(p => {
              const sale = p.special_price ? ` (SALE: ${p.special_price}€)` : ''
              const stock = p.stock_status === 1 ? '' : ' [OUT OF STOCK]'
              return `${p.name} | ${p.sku} | ${p.price}€${sale}${stock}`
            }).join('\n') + paginationFooter(o, l, total)
          : 'No products found. Try different Estonian keywords (e.g. "piim" for milk, "leib" for bread).',
      }],
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
)

server.tool(
  'selver_browse_category',
  `Browse products in a category without text search. Category keys: ${categoryKeys}`,
  {
    category: z.string(),
    limit: z.number().optional().describe('Max results (default 20)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
  },
  async ({ category, limit, offset }) => {
    const cat = CATEGORIES[category]
    if (!cat) return { isError: true, content: [{ type: 'text', text: `Unknown category. Available: ${categoryKeys}` }] }
    const l = limit || 20
    const o = offset || 0
    const { products, total } = await searchProducts(undefined, cat.id, l, o)
    return { content: [{ type: 'text', text: products.map(p => `${p.name} | ${p.sku} | ${p.price}€`).join('\n') + paginationFooter(o, l, total) }] }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
)

server.tool(
  'selver_find_deals',
  'Find products currently on sale (discounted price).',
  {
    category: z.string().optional(),
    limit: z.number().optional().describe('Max results (default 20)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
  },
  async ({ category, limit, offset }) => {
    const l = limit || 20
    const o = offset || 0
    const catId = category ? CATEGORIES[category]?.id : undefined
    const { products, total } = await getDeals(catId, l, o)
    return {
      content: [{
        type: 'text',
        text: products.length
          ? products.map(p => `${p.name} | ${p.sku} | was ${p.price}€ → NOW ${p.special_price}€`).join('\n') +
              `\n--- ${products.length} deals shown${o + l < total ? ` | next offset: ${o + l}` : ''}`
          : 'No deals found right now.',
      }],
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
)

// ── Auth tools ────────────────────────────────────────────────────────────

server.tool(
  'selver_auth_status',
  'Check if Selver auth token is valid. Shows user name and time until expiry.',
  {},
  async () => {
    auth.loadToken()
    const status = await auth.checkAuth()
    if (status.valid) {
      const mins = status.expires_in ? Math.floor(status.expires_in / 60) : '?'
      return { content: [{ type: 'text', text: `Authenticated as ${status.user}. Token expires in ${mins} min.` }] }
    }
    return { content: [{ type: 'text', text: `Not authenticated: ${status.error}\nRun selver_login tool to get a fresh token (requires Smart-ID on phone).` }] }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false } },
)

server.tool(
  'selver_login',
  'Trigger Smart-ID browser login for fresh auth token. Requires SELVER_ID_CODE env var and user phone confirmation. Token lasts 1 hour.',
  { timeout: z.number().optional() },
  async ({ timeout }) => {
    const msg = await auth.triggerLogin(timeout || 180)
    return { content: [{ type: 'text', text: msg }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
)

// ── Shared helpers ────────────────────────────────────────────────────────

async function requireAuth(): Promise<{ content: [{ type: 'text'; text: string }]; isError: true } | null> {
  auth.loadToken()
  const check = await auth.checkAuth()
  if (!check.valid) return { isError: true, content: [{ type: 'text', text: `Auth required: ${check.error}` }] }
  return null
}

// ── Cart tools (auth required) ────────────────────────────────────────────

server.tool(
  'selver_cart_view',
  'View current cart contents and totals. Requires valid auth.',
  {},
  async () => {
    const denied = await requireAuth()
    if (denied) return denied

    if (!auth.cartToken) await cart.createCart(auth)
    const { items, error } = await cart.getCart(auth)
    if (error) return { isError: true, content: [{ type: 'text', text: `Cart error: ${error}` }] }
    if (!items.length) return { content: [{ type: 'text', text: 'Cart is empty.' }] }

    const totals = await cart.getCartTotals(auth)
    const lines = items.map((i: any) => `[${i.item_id}] ${i.name} x${i.qty} — ${i.price}€`)
    lines.push(`\nTotal: ${totals.grand_total}€ (${totals.items_qty} items)`)
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
)

server.tool(
  'selver_cart_add',
  'Add products to cart by SKU. Use selver_search_products first to find SKUs. Requires valid auth.',
  {
    items: z.array(z.object({
      sku: z.string().describe('Product SKU (e.g. "T000058782")'),
      qty: z.number().optional().describe('Quantity (default 1)'),
    })),
  },
  async ({ items }) => {
    const denied = await requireAuth()
    if (denied) return denied

    if (!auth.cartToken) await cart.createCart(auth)
    const cartItems = items.map(i => ({ sku: i.sku, qty: i.qty || 1 }))
    const res = await cart.addToCart(auth, cartItems)
    if (res.success) {
      const cartData = res.cart
      const added = cartData?.items || []
      return {
        content: [{
          type: 'text',
          text: `Added! Cart now has ${added.length} items:\n` +
            added.map((i: any) => `  ${i.name} x${i.qty} — ${i.price}€`).join('\n'),
        }],
      }
    }
    return { isError: true, content: [{ type: 'text', text: `Failed to add: ${res.error}` }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
)

server.tool(
  'selver_cart_remove',
  'Remove an item from cart by item_id (get item_id from selver_cart_view).',
  { item_id: z.number() },
  async ({ item_id }) => {
    const denied = await requireAuth()
    if (denied) return denied
    const res = await cart.removeFromCart(auth, item_id)
    if (!res.success) return { isError: true, content: [{ type: 'text', text: `Failed: ${res.error}` }] }
    return { content: [{ type: 'text', text: 'Item removed.' }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
)

server.tool(
  'selver_cart_update_qty',
  'Update quantity of an item already in cart.',
  { item_id: z.number(), sku: z.string(), qty: z.number() },
  async ({ item_id, sku, qty }) => {
    const denied = await requireAuth()
    if (denied) return denied
    const res = await cart.updateCartItem(auth, item_id, sku, qty)
    if (!res.success) return { isError: true, content: [{ type: 'text', text: `Failed: ${res.error}` }] }
    return { content: [{ type: 'text', text: 'Quantity updated.' }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
)

server.tool(
  'selver_cart_clear',
  'Remove ALL items from cart. Use with caution.',
  {},
  async () => {
    const denied = await requireAuth()
    if (denied) return denied
    const res = await cart.clearCart(auth)
    if (!res.success) return { isError: true, content: [{ type: 'text', text: `Failed: ${res.error}` }] }
    return { content: [{ type: 'text', text: 'Cart cleared.' }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } },
)

// ── Delivery tools ────────────────────────────────────────────────────────

server.tool(
  'selver_timeslots',
  'Get available delivery timeslots. Requires valid auth and items in cart.',
  {},
  async () => {
    const denied = await requireAuth()
    if (denied) return denied
    const slots = await cart.getTimeslots(auth)
    return { content: [{ type: 'text', text: JSON.stringify(slots, null, 2) }] }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
)

server.tool(
  'selver_reserve_timeslot',
  'Reserve a delivery timeslot (45 min hold). Get slot IDs from selver_timeslots tool.',
  { timeslot_id: z.number(), date: z.string().describe('Date YYYY-MM-DD') },
  async ({ timeslot_id, date }) => {
    const denied = await requireAuth()
    if (denied) return denied
    const email = auth.user?.email || ''
    const phone = auth.user?.addresses?.[0]?.telephone || ''
    const res = await cart.reserveTimeslot(auth, timeslot_id, date, email, phone)
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
)

// ── Pantry tools (storage-backed) ─────────────────────────────────────────

server.tool(
  'selver_pantry_view',
  'View current pantry (home inventory). Shows all items with quantities.',
  {},
  async () => {
    const items = await storage.getPantry()
    if (!items.length) return { content: [{ type: 'text', text: 'Pantry is empty.' }] }
    return {
      content: [{
        type: 'text',
        text: items.map((i, idx) => {
          let line = `${idx + 1}. ${i.name}`
          if (i.quantity) line += ` — ${i.quantity} ${i.unit || 'pcs'}`
          if (i.category) line += ` (${i.category})`
          return line
        }).join('\n'),
      }],
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false } },
)

server.tool(
  'selver_pantry_add',
  'Add one or more items to pantry. Pass an array for batch additions (single tool call instead of many).',
  {
    items: z.array(z.object({
      name: z.string().describe('Item name (Selver product name or free text)'),
      quantity: z.number().optional(),
      unit: z.string().optional().describe('Unit: kg, L, pcs, g, ml, etc.'),
      category: z.string().optional().describe('Category: dairy, meat, vegetables, etc.'),
    })).describe('Items to add'),
  },
  async ({ items: toAdd }) => {
    const result = await storage.addPantryItems(toAdd)
    return { content: [{ type: 'text', text: `Added ${toAdd.length} item(s). Pantry now has ${result.length} items.` }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: false } },
)

server.tool(
  'selver_pantry_remove',
  'Remove one or more items from pantry. Pass an array for batch removals (single tool call instead of many).',
  {
    items: z.array(z.object({
      name: z.string().describe('Item name (partial match)'),
      quantity: z.number().optional().describe('Amount to remove (omit to remove entirely)'),
    })).describe('Items to remove'),
  },
  async ({ items: toRemove }) => {
    const result = await storage.removePantryItems(toRemove)
    return { content: [{ type: 'text', text: `Removed ${toRemove.length} item(s). Pantry now has ${result.length} items.` }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: true } },
)

// ── Family config ─────────────────────────────────────────────────────────

server.tool(
  'selver_family_config',
  'View family profile: members, pets, dietary preferences, address, meal planning settings.',
  {},
  async () => {
    const config = await storage.getConfig()
    if (!config) return { content: [{ type: 'text', text: 'No family config found. Set one up with selver_update_family_config.' }] }
    return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false } },
)

server.tool(
  'selver_update_family_config',
  'Update family profile (members, address, meal preferences). Pass partial config to merge with existing.',
  { config: z.record(z.any()).describe('Partial config object to merge') },
  async ({ config: patch }) => {
    const updated = await storage.updateConfig(patch)
    return { content: [{ type: 'text', text: `Config updated.\n${JSON.stringify(updated, null, 2)}` }] }
  },
  { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
)

// ── Start ──────────────────────────────────────────────────────────────────

const mode = process.env.MCP_TRANSPORT || 'stdio'

if (mode === 'http') {
  const port = parseInt(process.env.PORT || '3000')
  const apiKey = process.env.API_KEY

  const MAX_SESSIONS = 50
  const transports = new Map<string, StreamableHTTPServerTransport>()

  function checkOrigin(req: IncomingMessage, res: ServerResponse): boolean {
    if (apiKey) return true // remote mode uses API key auth, no origin restriction needed
    const origin = req.headers.origin
    if (origin && !['http://localhost', 'http://127.0.0.1'].some(o => origin.startsWith(o))) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Forbidden origin' }))
      return false
    }
    return true
  }

  function checkApiKey(req: IncomingMessage, res: ServerResponse): boolean {
    if (!apiKey) return true
    const provided = req.headers['x-api-key'] || new URL(req.url!, `http://${req.headers.host}`).searchParams.get('api_key')
    if (provided !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid or missing API key' }))
      return false
    }
    return true
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', chunk => data += chunk)
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  }

  const httpServer = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', storage: storage.backend }))
      return
    }

    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    if (!checkOrigin(req, res)) return
    if (!checkApiKey(req, res)) return

    if (req.method === 'POST') {
      const body = await readBody(req)
      const parsed = JSON.parse(body)
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res, parsed)
        return
      }

      if (transports.size >= MAX_SESSIONS) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Too many active sessions' }))
        return
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport)
          process.stderr.write(`session started: ${id}\n`)
        },
        onsessionclosed: (id) => {
          transports.delete(id)
          process.stderr.write(`session closed: ${id}\n`)
        },
      })

      await server.connect(transport)
      await transport.handleRequest(req, res, parsed)
    } else if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res)
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing or invalid session ID' }))
      }
    } else if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res)
      } else {
        res.writeHead(400)
        res.end()
      }
    } else {
      res.writeHead(405)
      res.end()
    }
  })

  httpServer.listen(port, () => {
    process.stderr.write(`selver MCP server v1.0.0 (http) on port ${port}\n`)
  })
} else {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('selver MCP server v1.0.0 (stdio) started\n')
}
