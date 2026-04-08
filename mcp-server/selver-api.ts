/**
 * Selver.ee API client.
 * Vue Storefront + Magento backend.
 * Catalog index: vue_storefront_catalog_et
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'

const BASE = 'https://www.selver.ee'
const INDEX = 'vue_storefront_catalog_et'
const STORE = 'et'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const DATA_DIR = join(dirname(import.meta.dir), 'data')
const TOKEN_FILE = join(DATA_DIR, 'selver_token.json')
const PANTRY_FILE = join(DATA_DIR, 'pantry.json')
const CONFIG_FILE = join(DATA_DIR, 'config.json')

// ── Types ──────────────────────────────────────────────────────────────────

export type Product = {
  sku: string
  name: string
  price: number
  special_price: number | null
  unit: string | null
  brand: string | null
  category_ids: number[]
  product_id: number | null
  stock_status: number | null
  url_path?: string
  image?: string
}

export type CartItem = {
  item_id: number
  sku: string
  qty: number
  name: string
  price: number
  product_type: string
}

export type TokenData = {
  token: string | null
  cart_token: string | null
  cookies: Record<string, string>
  user?: Record<string, any>
  id_code?: string
  saved_at?: number
}

export type PantryItem = {
  name: string
  quantity?: number
  unit?: string
  category?: string
  image?: string
  added?: string
}

// ── Known categories ───────────────────────────────────────────────────────

export const CATEGORIES: Record<string, { id: number; name_et: string }> = {
  milk:        { id: 234, name_et: 'Piimad, koored' },
  cottage:     { id: 235, name_et: 'Kohupiimad, kodujuustud' },
  yogurt:      { id: 236, name_et: 'Jogurtid' },
  eggs:        { id: 239, name_et: 'Munad' },
  butter:      { id: 240, name_et: 'Võid, margariinid' },
  cheese:      { id: 243, name_et: 'Juustud' },
  bread:       { id: 248, name_et: 'Leivad' },
  pork:        { id: 219, name_et: 'Sealiha' },
  chicken:     { id: 220, name_et: 'Linnuliha' },
  fish:        { id: 221, name_et: 'Kala' },
  salads:      { id: 257, name_et: 'Salatid' },
  spices:      { id: 263, name_et: 'Maitseained' },
  oils:        { id: 267, name_et: 'Õlid, äädikad' },
  dry_goods:   { id: 9,   name_et: 'Kuivained, hommikusöögid' },
  drinks:      { id: 48,  name_et: 'Veed, mahlad, joogid' },
  frozen_meat: { id: 285, name_et: 'Külmutatud liha- ja kalatooted' },
  fruits:      { id: 253, name_et: 'Puuviljad' },
  vegetables:  { id: 254, name_et: 'Köögiviljad' },
  sausages:    { id: 225, name_et: 'Vorstid, viinerid' },
  sweets:      { id: 270, name_et: 'Maiustused' },
  baby:        { id: 296, name_et: 'Lastekaubad' },
  pets:        { id: 303, name_et: 'Lemmikloomakaubad' },
  household:   { id: 289, name_et: 'Majapidamistarbed' },
}

// ── API Client ─────────────────────────────────────────────────────────────

export class SelverAPI {
  token: string | null = null
  cartToken: string | null = null
  cookies: Record<string, string> = {}
  user: Record<string, any> = {}

  constructor() {
    this.loadToken()
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  loadToken(): boolean {
    if (!existsSync(TOKEN_FILE)) return false
    try {
      const data: TokenData = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
      let token = data.token
      if (token?.startsWith('"') && token.endsWith('"')) {
        token = token.slice(1, -1)
      }
      this.token = token
      this.cartToken = data.cart_token
      this.cookies = data.cookies || {}
      this.user = data.user || {}
      return !!token
    } catch {
      return false
    }
  }

  private authHeaders(): Record<string, string> {
    const hdrs: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    }
    if (this.token) {
      hdrs['Authorization'] = `Bearer ${this.token}`
    }
    if (Object.keys(this.cookies).length > 0) {
      hdrs['Cookie'] = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }
    return hdrs
  }

  /** Check if current token is valid */
  async checkAuth(): Promise<{ valid: boolean; user?: string; error?: string; expires_in?: number }> {
    if (!this.token) return { valid: false, error: 'No token loaded' }

    // Decode JWT to check expiry
    try {
      const payload = JSON.parse(Buffer.from(this.token.split('.')[1], 'base64url').toString())
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp && now >= payload.exp) {
        return { valid: false, error: `Token expired ${Math.floor((now - payload.exp) / 60)} minutes ago` }
      }
      const expiresIn = payload.exp ? payload.exp - now : undefined

      // Verify with server
      const r = await fetch(`${BASE}/api/user/me?token=${this.token}`, { headers: this.authHeaders() })
      const body = await r.json() as any
      if (body.code === 200) {
        return {
          valid: true,
          user: `${body.result.firstname} ${body.result.lastname}`,
          expires_in: expiresIn,
        }
      }
      return { valid: false, error: body.result || 'Unknown error' }
    } catch (e: any) {
      return { valid: false, error: e.message }
    }
  }

  /** Trigger browser-based Smart-ID login (requires user interaction) */
  async triggerAuth(idCode: string = '38511080251', timeout: number = 180): Promise<string> {
    const { execSync } = await import('child_process')
    const script = join(dirname(import.meta.dir), 'scripts', 'selver_auth.py')
    try {
      const output = execSync(
        `python3 ${script} --id-code ${idCode} --timeout ${timeout}`,
        { timeout: (timeout + 30) * 1000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      this.loadToken()
      // Extract verification code from output
      const codeMatch = output.match(/Verification code: (\d{4})/)
      const code = codeMatch ? codeMatch[1] : null
      return code
        ? `Smart-ID verification code: ${code}. Confirm on your phone!`
        : output
    } catch (e: any) {
      return `Auth failed: ${e.stderr || e.message}`
    }
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  private async catalogSearch(entity: string, query: object, size = 20, from = 0, sort = ''): Promise<any> {
    const encoded = encodeURIComponent(JSON.stringify(query))
    const url = `${BASE}/api/catalog/${INDEX}/${entity}/_search?from=${from}&size=${size}&sort=${sort}&request=${encoded}`
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    return r.json()
  }

  private formatProduct(src: any): Product {
    const stock = src.stock || {}
    return {
      sku: src.sku,
      name: src.name,
      price: Math.round((src.price || 0) * 100) / 100,
      special_price: src.special_price ? Math.round(src.special_price * 100) / 100 : null,
      unit: src.product_sales_unit || null,
      brand: src.product_brand || null,
      category_ids: src.category_ids || [],
      product_id: stock.product_id || null,
      stock_status: stock.stock_status || null,
      url_path: src.url_path || null,
      image: src.image || null,
    }
  }

  /** Search products by text and/or category */
  async searchProducts(text?: string, categoryId?: number, size = 20): Promise<Product[]> {
    const must: any[] = [{ terms: { status: [0, 1] } }]

    if (categoryId) {
      must.push({ terms: { category_ids: [categoryId] } })
    }
    if (text) {
      for (const word of text.toLowerCase().split(/\s+/)) {
        must.push({ wildcard: { name: `*${word}*` } })
      }
    }

    const query = { query: { bool: { filter: { bool: { must } } } } }
    const result = await this.catalogSearch('product', query, size)
    const hits = result?.hits?.hits || []
    return hits.map((h: any) => this.formatProduct(h._source))
  }

  /** Get product by SKU */
  async getProduct(sku: string): Promise<Product | null> {
    const query = { query: { bool: { filter: { terms: { sku: [sku] } } } } }
    const result = await this.catalogSearch('product', query, 1)
    const hits = result?.hits?.hits || []
    return hits.length ? this.formatProduct(hits[0]._source) : null
  }

  /** Browse category tree */
  async getCategories(level = 4): Promise<{ id: number; name: string; url_path: string }[]> {
    const query = {
      query: { bool: { filter: { bool: { must: [
        { terms: { level: [level] } },
        { terms: { is_active: [true] } },
      ] } } } }
    }
    const result = await this.catalogSearch('category', query, 200, 0, 'position:asc')
    const hits = result?.hits?.hits || []
    return hits.map((h: any) => ({
      id: h._source.id,
      name: h._source.name,
      url_path: h._source.url_path,
    }))
  }

  /** Get products on sale (special_price set and lower than price) */
  async getDeals(categoryId?: number, size = 20): Promise<Product[]> {
    const must: any[] = [
      { terms: { status: [0, 1] } },
      { exists: { field: 'special_price' } },
    ]
    if (categoryId) {
      must.push({ terms: { category_ids: [categoryId] } })
    }

    const query = { query: { bool: { filter: { bool: { must } } } } }
    const result = await this.catalogSearch('product', query, size, 0, 'special_price:asc')
    const hits = result?.hits?.hits || []
    return hits
      .map((h: any) => this.formatProduct(h._source))
      .filter(p => p.special_price && p.special_price < p.price)
  }

  // ── Cart ────────────────────────────────────────────────────────────────

  private async apiGet(path: string, params: Record<string, string> = {}): Promise<any> {
    const p = new URLSearchParams({ storeCode: STORE, ...params })
    const r = await fetch(`${BASE}${path}?${p}`, { headers: this.authHeaders() })
    return r.json()
  }

  private async apiPost(path: string, body: any = {}, params: Record<string, string> = {}): Promise<any> {
    const p = new URLSearchParams({ storeCode: STORE, ...params })
    const r = await fetch(`${BASE}${path}?${p}`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    })
    return r.json()
  }

  /** Create a new cart, returns cart ID */
  async createCart(): Promise<string | null> {
    const result = await this.apiPost('/api/cart/create')
    const cartId = result?.result
    if (cartId) {
      this.cartToken = String(cartId)
      // Save to token file
      if (existsSync(TOKEN_FILE)) {
        const data = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
        data.cart_token = this.cartToken
        writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2))
      }
    }
    return cartId
  }

  /** Get current cart contents */
  async getCart(): Promise<{ items: CartItem[]; error?: string }> {
    if (!this.cartToken) {
      return { items: [], error: 'No cart token. Create a cart or authenticate first.' }
    }
    const result = await this.apiGet('/api/cart/pull', { cartId: this.cartToken })
    if (result?.code === 200) {
      return { items: result.result || [] }
    }
    return { items: [], error: result?.result || 'Failed to fetch cart' }
  }

  /** Add items to cart. cartId goes in query params (not body!) */
  async addToCart(items: { sku: string; qty: number }[]): Promise<{ success: boolean; cart?: any; error?: string }> {
    if (!this.cartToken) {
      return { success: false, error: 'No cart token. Authenticate first.' }
    }
    const result = await this.apiPost(
      '/api/ext/tkg-sales/cart/add-cart-items',
      { cartItems: items },
      { cartId: this.cartToken },
    )
    if (result?.code === 200) {
      return { success: true, cart: result.result }
    }
    return { success: false, error: JSON.stringify(result) }
  }

  /** Remove item from cart by item_id */
  async removeFromCart(itemId: number): Promise<{ success: boolean; error?: string }> {
    if (!this.cartToken) {
      return { success: false, error: 'No cart token.' }
    }
    const result = await this.apiPost(
      '/api/cart/delete',
      { cartItem: { item_id: itemId } },
      { cartId: this.cartToken },
    )
    if (result?.code === 200) {
      return { success: true }
    }
    return { success: false, error: JSON.stringify(result) }
  }

  /** Update item quantity */
  async updateCartItem(itemId: number, sku: string, qty: number): Promise<{ success: boolean; error?: string }> {
    if (!this.cartToken) {
      return { success: false, error: 'No cart token.' }
    }
    const result = await this.apiPost(
      '/api/cart/update',
      { cartItem: { item_id: itemId, sku, qty, quote_id: this.cartToken } },
      { cartId: this.cartToken },
    )
    if (result?.code === 200) {
      return { success: true }
    }
    return { success: false, error: JSON.stringify(result) }
  }

  /** Clear all items from cart */
  async clearCart(): Promise<{ success: boolean; error?: string }> {
    if (!this.cartToken) {
      return { success: false, error: 'No cart token.' }
    }
    const result = await this.apiPost(
      '/api/ext/tkg-sales/cart/truncate',
      {},
      { cartId: this.cartToken },
    )
    if (result?.code === 200) {
      return { success: true }
    }
    return { success: false, error: JSON.stringify(result) }
  }

  /** Get cart totals (subtotal, grand total, item count) */
  async getCartTotals(): Promise<any> {
    if (!this.cartToken) return { error: 'No cart token.' }
    const result = await this.apiGet('/api/cart/totals', { cartId: this.cartToken })
    if (result?.code === 200) {
      const r = result.result
      return {
        subtotal: r.subtotal,
        grand_total: r.grand_total,
        items_qty: r.items_qty,
        items: (r.items || []).map((i: any) => ({
          name: i.name,
          qty: i.qty,
          price: i.price,
          row_total: i.row_total,
        })),
      }
    }
    return { error: result?.result || 'Failed' }
  }

  // ── Timeslots ───────────────────────────────────────────────────────────

  DELIVERY_METHOD_ID = 419

  async getTimeslots(methodId?: number): Promise<any> {
    if (!this.cartToken) return { error: 'No cart token.' }
    return this.apiGet(
      `/api/ext/timeslot/get-method-data/${methodId || this.DELIVERY_METHOD_ID}/0`,
      { cartId: this.cartToken },
    )
  }

  async reserveTimeslot(timeslotId: number, date: string, email?: string, telephone?: string): Promise<any> {
    if (!this.cartToken) return { error: 'No cart token.' }
    const p = new URLSearchParams({ cartId: this.cartToken, storeCode: STORE })
    const r = await fetch(`${BASE}/api/ext/timeslot/reserve?${p}`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        timeslotId,
        date,
        stationId: '',
        email: email || '',
        telephone: telephone || '',
      }),
    })
    return r.json()
  }

  // ── Pantry ──────────────────────────────────────────────────────────────

  loadPantry(): PantryItem[] {
    if (!existsSync(PANTRY_FILE)) return []
    try {
      const data = JSON.parse(readFileSync(PANTRY_FILE, 'utf8'))
      // Support both [{name}] and {items: [{name, quantity, unit}]} formats
      const items = Array.isArray(data) ? data : (data.items || [])
      return items
    } catch {
      return []
    }
  }

  savePantry(items: PantryItem[]): void {
    writeFileSync(PANTRY_FILE, JSON.stringify(items, null, 2))
  }

  pantryAdd(name: string, quantity?: number, unit?: string, category?: string): PantryItem[] {
    const items = this.loadPantry()
    const existing = items.find(i => i.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      if (quantity && existing.quantity) existing.quantity += quantity
    } else {
      const entry: PantryItem = { name }
      if (quantity) entry.quantity = quantity
      if (unit) entry.unit = unit
      if (category) entry.category = category
      items.push(entry)
    }
    this.savePantry(items)
    return items
  }

  pantryRemove(name: string, quantity?: number): PantryItem[] {
    let items = this.loadPantry()
    const idx = items.findIndex(i => i.name.toLowerCase().includes(name.toLowerCase()))
    if (idx >= 0) {
      if (quantity && items[idx].quantity && items[idx].quantity! > quantity) {
        items[idx].quantity! -= quantity
      } else {
        items.splice(idx, 1)
      }
    }
    this.savePantry(items)
    return items
  }

  // ── Config ──────────────────────────────────────────────────────────────

  loadConfig(): any {
    if (!existsSync(CONFIG_FILE)) return {}
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    } catch {
      return {}
    }
  }
}
