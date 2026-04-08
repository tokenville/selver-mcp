#!/usr/bin/env bun
/**
 * Selver.ee MCP Server
 *
 * Tools for grocery shopping: product search, cart management,
 * pantry tracking, delivery timeslots.
 *
 * Runs as stdio MCP server under Bun.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { SelverAPI, CATEGORIES } from './selver-api.js'

const api = new SelverAPI()

const server = new Server(
  { name: 'selver', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

// ── Tool definitions ───────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'selver_search',
      description: 'Search Selver.ee products by name (Estonian or partial). Returns name, SKU, price, stock status. Works without auth.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search text (Estonian product name or part of it, e.g. "piim", "pelmeenid", "majonees")' },
          category: { type: 'string', description: `Optional category key: ${Object.keys(CATEGORIES).join(', ')}` },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'selver_categories',
      description: 'List known product categories with IDs. Use category IDs to filter searches.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'selver_browse_category',
      description: 'Browse products in a category (without text search). Good for discovering what\'s available.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          category: { type: 'string', description: `Category key: ${Object.keys(CATEGORIES).join(', ')}` },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['category'],
      },
    },
    {
      name: 'selver_deals',
      description: 'Find products currently on sale (with special/discounted price).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          category: { type: 'string', description: 'Optional category key to filter deals' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'selver_auth_status',
      description: 'Check if Selver auth token is valid. Shows user name and time until expiry.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'selver_login',
      description: 'Trigger Smart-ID browser login to get a fresh auth token. Requires user to confirm verification code on their phone. Token lasts 1 hour.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          timeout: { type: 'number', description: 'Seconds to wait for Smart-ID confirmation (default 180)' },
        },
      },
    },
    {
      name: 'selver_cart_view',
      description: 'View current cart contents and totals. Requires valid auth.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'selver_cart_add',
      description: 'Add products to cart by SKU. Use selver_search first to find SKUs. Requires valid auth.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', description: 'Product SKU (e.g. "T000058782")' },
                qty: { type: 'number', description: 'Quantity (default 1)' },
              },
              required: ['sku'],
            },
            description: 'Products to add',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'selver_cart_remove',
      description: 'Remove an item from cart by item_id (get item_id from selver_cart_view).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          item_id: { type: 'number', description: 'Cart item ID to remove' },
        },
        required: ['item_id'],
      },
    },
    {
      name: 'selver_cart_update_qty',
      description: 'Update quantity of an item already in cart.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          item_id: { type: 'number', description: 'Cart item ID' },
          sku: { type: 'string', description: 'Product SKU' },
          qty: { type: 'number', description: 'New quantity' },
        },
        required: ['item_id', 'sku', 'qty'],
      },
    },
    {
      name: 'selver_cart_clear',
      description: 'Remove ALL items from cart. Use with caution.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'selver_timeslots',
      description: 'Get available delivery timeslots. Requires valid auth and items in cart.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'selver_reserve_timeslot',
      description: 'Reserve a delivery timeslot (45 min hold). Get slot IDs from selver_timeslots.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          timeslot_id: { type: 'number', description: 'Timeslot ID from selver_timeslots' },
          date: { type: 'string', description: 'Date YYYY-MM-DD' },
        },
        required: ['timeslot_id', 'date'],
      },
    },
    {
      name: 'pantry_view',
      description: 'View current pantry (home inventory).',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'pantry_add',
      description: 'Add item to pantry or increase quantity of existing item.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Item name (Selver product name or free text)' },
          quantity: { type: 'number', description: 'Amount (optional)' },
          unit: { type: 'string', description: 'Unit: kg, L, pcs, g, ml, etc. (optional)' },
          category: { type: 'string', description: 'Optional category (dairy, meat, etc.)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'pantry_remove',
      description: 'Remove item from pantry or decrease its quantity.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Item name' },
          quantity: { type: 'number', description: 'Amount to remove (omit to remove entirely)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'family_config',
      description: 'View family profile: members, pets, dietary preferences, address.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ],
}))

// ── Tool handlers ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params

  try {
    switch (name) {
      case 'selver_search': {
        const categoryId = args.category ? CATEGORIES[args.category as string]?.id : undefined
        const products = await api.searchProducts(args.query as string, categoryId, (args.limit as number) || 10)
        return result(products.length
          ? products.map(p => {
              const sale = p.special_price ? ` (SALE: ${p.special_price}€)` : ''
              const stock = p.stock_status === 1 ? '' : ' [OUT OF STOCK]'
              return `${p.name} | ${p.sku} | ${p.price}€${sale}${stock}`
            }).join('\n')
          : 'No products found. Try different Estonian keywords (e.g. "piim" for milk, "leib" for bread).')
      }

      case 'selver_categories':
        return result(Object.entries(CATEGORIES)
          .map(([key, val]) => `${key}: ${val.name_et} (id=${val.id})`)
          .join('\n'))

      case 'selver_browse_category': {
        const cat = CATEGORIES[args.category as string]
        if (!cat) return result(`Unknown category. Available: ${Object.keys(CATEGORIES).join(', ')}`)
        const products = await api.searchProducts(undefined, cat.id, (args.limit as number) || 20)
        return result(products.map(p => `${p.name} | ${p.sku} | ${p.price}€`).join('\n'))
      }

      case 'selver_deals': {
        const catId = args.category ? CATEGORIES[args.category as string]?.id : undefined
        const deals = await api.getDeals(catId, (args.limit as number) || 20)
        return result(deals.length
          ? deals.map(p => `${p.name} | ${p.sku} | was ${p.price}€ → NOW ${p.special_price}€`).join('\n')
          : 'No deals found in this category right now.')
      }

      case 'selver_auth_status': {
        api.loadToken() // Reload from file
        const status = await api.checkAuth()
        if (status.valid) {
          const mins = status.expires_in ? Math.floor(status.expires_in / 60) : '?'
          return result(`Authenticated as ${status.user}. Token expires in ${mins} min.`)
        }
        return result(`Not authenticated: ${status.error}\nRun selver_login to get a fresh token (requires Smart-ID on phone).`)
      }

      case 'selver_login': {
        const msg = await api.triggerAuth('38511080251', (args.timeout as number) || 180)
        return result(msg)
      }

      case 'selver_cart_view': {
        api.loadToken()
        const auth = await api.checkAuth()
        if (!auth.valid) return result(`Auth required: ${auth.error}`)

        if (!api.cartToken) await api.createCart()
        const { items, error } = await api.getCart()
        if (error) return result(`Cart error: ${error}`)
        if (!items.length) return result('Cart is empty.')

        const totals = await api.getCartTotals()
        const lines = items.map((i: any) =>
          `[${i.item_id}] ${i.name} x${i.qty} — ${i.price}€`)
        lines.push(`\nTotal: ${totals.grand_total}€ (${totals.items_qty} items)`)
        return result(lines.join('\n'))
      }

      case 'selver_cart_add': {
        api.loadToken()
        const auth = await api.checkAuth()
        if (!auth.valid) return result(`Auth required: ${auth.error}`)

        if (!api.cartToken) await api.createCart()
        const cartItems = (args.items as any[]).map(i => ({ sku: i.sku, qty: i.qty || 1 }))
        const res = await api.addToCart(cartItems)
        if (res.success) {
          const cart = res.cart
          const items = cart?.items || []
          return result(`Added! Cart now has ${items.length} items:\n` +
            items.map((i: any) => `  ${i.name} x${i.qty} — ${i.price}€`).join('\n'))
        }
        return result(`Failed to add: ${res.error}`)
      }

      case 'selver_cart_remove': {
        api.loadToken()
        const res = await api.removeFromCart(args.item_id as number)
        return result(res.success ? 'Item removed.' : `Failed: ${res.error}`)
      }

      case 'selver_cart_update_qty': {
        api.loadToken()
        const res = await api.updateCartItem(args.item_id as number, args.sku as string, args.qty as number)
        return result(res.success ? 'Quantity updated.' : `Failed: ${res.error}`)
      }

      case 'selver_cart_clear': {
        api.loadToken()
        const res = await api.clearCart()
        return result(res.success ? 'Cart cleared.' : `Failed: ${res.error}`)
      }

      case 'selver_timeslots': {
        api.loadToken()
        const slots = await api.getTimeslots()
        return result(JSON.stringify(slots, null, 2))
      }

      case 'selver_reserve_timeslot': {
        api.loadToken()
        const config = api.loadConfig()
        const email = config?.selver?.email || api.user?.email || ''
        const phone = api.user?.addresses?.[0]?.telephone || ''
        const res = await api.reserveTimeslot(
          args.timeslot_id as number,
          args.date as string,
          email,
          phone,
        )
        return result(JSON.stringify(res, null, 2))
      }

      case 'pantry_view': {
        const items = api.loadPantry()
        if (!items.length) return result('Pantry is empty.')
        return result(items.map((i, idx) => {
          let line = `${idx + 1}. ${i.name}`
          if (i.quantity) line += ` — ${i.quantity} ${i.unit || 'pcs'}`
          if (i.category) line += ` (${i.category})`
          return line
        }).join('\n'))
      }

      case 'pantry_add': {
        const items = api.pantryAdd(
          args.name as string,
          args.quantity as number,
          args.unit as string,
          args.category as string,
        )
        return result(`Updated pantry (${items.length} items).`)
      }

      case 'pantry_remove': {
        const items = api.pantryRemove(args.name as string, args.quantity as number)
        return result(`Updated pantry (${items.length} items).`)
      }

      case 'family_config': {
        const config = api.loadConfig()
        return result(JSON.stringify(config, null, 2))
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (e: any) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }
  }
})

function result(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

// ── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write('selver MCP server started\n')
