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

server.tool(
  'search_products',
  `Search Selver.ee products by name (Estonian or partial). Returns name, SKU, price, stock status. No auth required. Category keys: ${categoryKeys}`,
  { query: z.string(), category: z.string().optional(), limit: z.number().optional() },
  async ({ query, category, limit }) => {
    const categoryId = category ? CATEGORIES[category]?.id : undefined
    const products = await searchProducts(query, categoryId, limit || 10)
    return {
      content: [{
        type: 'text',
        text: products.length
          ? products.map(p => {
              const sale = p.special_price ? ` (SALE: ${p.special_price}€)` : ''
              const stock = p.stock_status === 1 ? '' : ' [OUT OF STOCK]'
              return `${p.name} | ${p.sku} | ${p.price}€${sale}${stock}`
            }).join('\n')
          : 'No products found. Try different Estonian keywords (e.g. "piim" for milk, "leib" for bread).',
      }],
    }
  },
)

server.tool(
  'browse_category',
  `Browse products in a category without text search. Category keys: ${categoryKeys}`,
  { category: z.string(), limit: z.number().optional() },
  async ({ category, limit }) => {
    const cat = CATEGORIES[category]
    if (!cat) return { content: [{ type: 'text', text: `Unknown category. Available: ${categoryKeys}` }] }
    const products = await searchProducts(undefined, cat.id, limit || 20)
    return { content: [{ type: 'text', text: products.map(p => `${p.name} | ${p.sku} | ${p.price}€`).join('\n') }] }
  },
)

server.tool(
  'find_deals',
  'Find products currently on sale (discounted price).',
  { category: z.string().optional(), limit: z.number().optional() },
  async ({ category, limit }) => {
    const catId = category ? CATEGORIES[category]?.id : undefined
    const deals = await getDeals(catId, limit || 20)
    return {
      content: [{
        type: 'text',
        text: deals.length
          ? deals.map(p => `${p.name} | ${p.sku} | was ${p.price}€ → NOW ${p.special_price}€`).join('\n')
          : 'No deals found right now.',
      }],
    }
  },
)

// ── Auth tools ────────────────────────────────────────────────────────────

server.tool(
  'auth_status',
  'Check if Selver auth token is valid. Shows user name and time until expiry.',
  {},
  async () => {
    auth.loadToken()
    const status = await auth.checkAuth()
    if (status.valid) {
      const mins = status.expires_in ? Math.floor(status.expires_in / 60) : '?'
      return { content: [{ type: 'text', text: `Authenticated as ${status.user}. Token expires in ${mins} min.` }] }
    }
    return { content: [{ type: 'text', text: `Not authenticated: ${status.error}\nRun login tool to get a fresh token (requires Smart-ID on phone).` }] }
  },
)

server.tool(
  'login',
  'Trigger Smart-ID browser login for fresh auth token. Requires SELVER_ID_CODE env var and user phone confirmation. Token lasts 1 hour.',
  { timeout: z.number().optional() },
  async ({ timeout }) => {
    const msg = await auth.triggerLogin(timeout || 180)
    return { content: [{ type: 'text', text: msg }] }
  },
)

// ── Cart tools (auth required) ────────────────────────────────────────────

server.tool(
  'cart_view',
  'View current cart contents and totals. Requires valid auth.',
  {},
  async () => {
    auth.loadToken()
    const check = await auth.checkAuth()
    if (!check.valid) return { content: [{ type: 'text', text: `Auth required: ${check.error}` }] }

    if (!auth.cartToken) await cart.createCart(auth)
    const { items, error } = await cart.getCart(auth)
    if (error) return { content: [{ type: 'text', text: `Cart error: ${error}` }] }
    if (!items.length) return { content: [{ type: 'text', text: 'Cart is empty.' }] }

    const totals = await cart.getCartTotals(auth)
    const lines = items.map((i: any) => `[${i.item_id}] ${i.name} x${i.qty} — ${i.price}€`)
    lines.push(`\nTotal: ${totals.grand_total}€ (${totals.items_qty} items)`)
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'cart_add',
  'Add products to cart by SKU. Use search_products first to find SKUs. Requires valid auth.',
  {
    items: z.array(z.object({
      sku: z.string().describe('Product SKU (e.g. "T000058782")'),
      qty: z.number().optional().describe('Quantity (default 1)'),
    })),
  },
  async ({ items }) => {
    auth.loadToken()
    const check = await auth.checkAuth()
    if (!check.valid) return { content: [{ type: 'text', text: `Auth required: ${check.error}` }] }

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
    return { content: [{ type: 'text', text: `Failed to add: ${res.error}` }] }
  },
)

server.tool(
  'cart_remove',
  'Remove an item from cart by item_id (get item_id from cart_view).',
  { item_id: z.number() },
  async ({ item_id }) => {
    auth.loadToken()
    const res = await cart.removeFromCart(auth, item_id)
    return { content: [{ type: 'text', text: res.success ? 'Item removed.' : `Failed: ${res.error}` }] }
  },
)

server.tool(
  'cart_update_qty',
  'Update quantity of an item already in cart.',
  { item_id: z.number(), sku: z.string(), qty: z.number() },
  async ({ item_id, sku, qty }) => {
    auth.loadToken()
    const res = await cart.updateCartItem(auth, item_id, sku, qty)
    return { content: [{ type: 'text', text: res.success ? 'Quantity updated.' : `Failed: ${res.error}` }] }
  },
)

server.tool(
  'cart_clear',
  'Remove ALL items from cart. Use with caution.',
  {},
  async () => {
    auth.loadToken()
    const res = await cart.clearCart(auth)
    return { content: [{ type: 'text', text: res.success ? 'Cart cleared.' : `Failed: ${res.error}` }] }
  },
)

// ── Delivery tools ────────────────────────────────────────────────────────

server.tool(
  'timeslots',
  'Get available delivery timeslots. Requires valid auth and items in cart.',
  {},
  async () => {
    auth.loadToken()
    const slots = await cart.getTimeslots(auth)
    return { content: [{ type: 'text', text: JSON.stringify(slots, null, 2) }] }
  },
)

server.tool(
  'reserve_timeslot',
  'Reserve a delivery timeslot (45 min hold). Get slot IDs from timeslots tool.',
  { timeslot_id: z.number(), date: z.string().describe('Date YYYY-MM-DD') },
  async ({ timeslot_id, date }) => {
    auth.loadToken()
    const email = auth.user?.email || ''
    const phone = auth.user?.addresses?.[0]?.telephone || ''
    const res = await cart.reserveTimeslot(auth, timeslot_id, date, email, phone)
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] }
  },
)

// ── Pantry tools (storage-backed) ─────────────────────────────────────────

server.tool(
  'pantry_view',
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
)

server.tool(
  'pantry_add',
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
)

server.tool(
  'pantry_remove',
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
)

// ── Family config ─────────────────────────────────────────────────────────

server.tool(
  'family_config',
  'View family profile: members, pets, dietary preferences, address, meal planning settings.',
  {},
  async () => {
    const config = await storage.getConfig()
    if (!config) return { content: [{ type: 'text', text: 'No family config found. Set one up with update_family_config.' }] }
    return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] }
  },
)

server.tool(
  'update_family_config',
  'Update family profile (members, address, meal preferences). Pass partial config to merge with existing.',
  { config: z.record(z.any()).describe('Partial config object to merge') },
  async ({ config: patch }) => {
    const updated = await storage.updateConfig(patch)
    return { content: [{ type: 'text', text: `Config updated.\n${JSON.stringify(updated, null, 2)}` }] }
  },
)

// ── Start ──────────────────────────────────────────────────────────────────

const mode = process.env.MCP_TRANSPORT || 'stdio'

if (mode === 'http') {
  const port = parseInt(process.env.PORT || '3000')
  const apiKey = process.env.API_KEY

  const transports = new Map<string, StreamableHTTPServerTransport>()

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

    if (!checkApiKey(req, res)) return

    if (req.method === 'POST') {
      const body = await readBody(req)
      const parsed = JSON.parse(body)
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res, parsed)
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
