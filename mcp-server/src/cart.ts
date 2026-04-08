/**
 * Selver.ee cart operations — add, remove, update, timeslots.
 * All operations require valid auth.
 */

import type { SelverAuth } from './auth.js'
import type { CartItem } from './types.js'

const BASE = 'https://www.selver.ee'
const STORE = 'et'
const DELIVERY_METHOD_ID = 419

async function apiGet(auth: SelverAuth, path: string, params: Record<string, string> = {}): Promise<any> {
  const p = new URLSearchParams({ storeCode: STORE, ...params })
  const r = await fetch(`${BASE}${path}?${p}`, { headers: auth.authHeaders() })
  return r.json()
}

async function apiPost(auth: SelverAuth, path: string, body: any = {}, params: Record<string, string> = {}): Promise<any> {
  const p = new URLSearchParams({ storeCode: STORE, ...params })
  const r = await fetch(`${BASE}${path}?${p}`, {
    method: 'POST',
    headers: auth.authHeaders(),
    body: JSON.stringify(body),
  })
  return r.json()
}

function requireCart(auth: SelverAuth): string {
  if (!auth.cartToken) throw new Error('No cart token. Authenticate and create a cart first.')
  return auth.cartToken
}

export async function createCart(auth: SelverAuth): Promise<string | null> {
  const result = await apiPost(auth, '/api/cart/create')
  const cartId = result?.result
  if (cartId) {
    auth.saveCartToken(String(cartId))
  }
  return cartId
}

export async function getCart(auth: SelverAuth): Promise<{ items: CartItem[]; error?: string }> {
  const cartId = requireCart(auth)
  const result = await apiGet(auth, '/api/cart/pull', { cartId })
  if (result?.code === 200) return { items: result.result || [] }
  return { items: [], error: result?.result || 'Failed to fetch cart' }
}

export async function addToCart(auth: SelverAuth, items: { sku: string; qty: number }[]): Promise<{ success: boolean; cart?: any; error?: string }> {
  const cartId = requireCart(auth)
  const result = await apiPost(auth, '/api/ext/tkg-sales/cart/add-cart-items', { cartItems: items }, { cartId })
  if (result?.code === 200) return { success: true, cart: result.result }
  return { success: false, error: JSON.stringify(result) }
}

export async function removeFromCart(auth: SelverAuth, itemId: number): Promise<{ success: boolean; error?: string }> {
  const cartId = requireCart(auth)
  const result = await apiPost(auth, '/api/cart/delete', { cartItem: { item_id: itemId } }, { cartId })
  if (result?.code === 200) return { success: true }
  return { success: false, error: JSON.stringify(result) }
}

export async function updateCartItem(auth: SelverAuth, itemId: number, sku: string, qty: number): Promise<{ success: boolean; error?: string }> {
  const cartId = requireCart(auth)
  const result = await apiPost(auth, '/api/cart/update', { cartItem: { item_id: itemId, sku, qty, quote_id: cartId } }, { cartId })
  if (result?.code === 200) return { success: true }
  return { success: false, error: JSON.stringify(result) }
}

export async function clearCart(auth: SelverAuth): Promise<{ success: boolean; error?: string }> {
  const cartId = requireCart(auth)
  const result = await apiPost(auth, '/api/ext/tkg-sales/cart/truncate', {}, { cartId })
  if (result?.code === 200) return { success: true }
  return { success: false, error: JSON.stringify(result) }
}

export async function getCartTotals(auth: SelverAuth): Promise<any> {
  const cartId = requireCart(auth)
  const result = await apiGet(auth, '/api/cart/totals', { cartId })
  if (result?.code === 200) {
    const r = result.result
    return {
      subtotal: r.subtotal,
      grand_total: r.grand_total,
      items_qty: r.items_qty,
      items: (r.items || []).map((i: any) => ({ name: i.name, qty: i.qty, price: i.price, row_total: i.row_total })),
    }
  }
  return { error: result?.result || 'Failed' }
}

export async function getTimeslots(auth: SelverAuth, methodId?: number): Promise<any> {
  const cartId = requireCart(auth)
  return apiGet(auth, `/api/ext/timeslot/get-method-data/${methodId || DELIVERY_METHOD_ID}/0`, { cartId })
}

export async function reserveTimeslot(auth: SelverAuth, timeslotId: number, date: string, email?: string, telephone?: string): Promise<any> {
  const cartId = requireCart(auth)
  const p = new URLSearchParams({ cartId, storeCode: STORE })
  const r = await fetch(`${BASE}/api/ext/timeslot/reserve?${p}`, {
    method: 'POST',
    headers: auth.authHeaders(),
    body: JSON.stringify({ timeslotId, date, stationId: '', email: email || '', telephone: telephone || '' }),
  })
  return r.json()
}
