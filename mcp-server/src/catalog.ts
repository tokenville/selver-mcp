/**
 * Selver.ee catalog — product search, categories, deals.
 * No auth required for these operations.
 */

import type { Product } from './types.js'

const BASE = 'https://www.selver.ee'
const INDEX = 'vue_storefront_catalog_et'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

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
  fruits:      { id: 210, name_et: 'Õunad, pirnid' },
  tropical:    { id: 212, name_et: 'Troopilised, eksootilised viljad' },
  vegetables:  { id: 213, name_et: 'Köögiviljad, juurviljad' },
  mushrooms:   { id: 214, name_et: 'Seened' },
  herbs:       { id: 215, name_et: 'Maitsetaimed, värsked salatid, piprad' },
  berries:     { id: 217, name_et: 'Marjad' },
  sausages:    { id: 225, name_et: 'Vorstid, viinerid' },
  sweets:      { id: 270, name_et: 'Maiustused' },
  baby:        { id: 296, name_et: 'Lastekaubad' },
  pets:        { id: 303, name_et: 'Lemmikloomakaubad' },
  household:   { id: 289, name_et: 'Majapidamistarbed' },
}

async function catalogSearch(entity: string, query: object, size = 20, from = 0, sort = ''): Promise<any> {
  const encoded = encodeURIComponent(JSON.stringify(query))
  const url = `${BASE}/api/catalog/${INDEX}/${entity}/_search?from=${from}&size=${size}&sort=${sort}&request=${encoded}`
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  return r.json()
}

function formatProduct(src: any): Product {
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

// Non-food category IDs to exclude from default search results
const NON_FOOD_CATEGORY_IDS = [
  63,  // Enesehooldustarbed (cosmetics)
  64, 68, 71, 77, 82, 94,
  100, // Majapidamis- ja kodukaubad (household)
  101, 107, 113, 118, 123, 135, 143, 149, 155,
  161, // Aed ja lilled (garden)
  162, 163, 164, 165,
  166, // Vabaajakaubad (leisure)
  167, 170, 174, 184, 190, 197, 202, 206,
  322, 323, // Hooajakaubad (seasonal)
  434, // Vabad ametikohad (vacancies)
  511,
]

export async function searchProducts(text?: string, categoryId?: number, size = 20): Promise<Product[]> {
  const must: any[] = [{ terms: { status: [0, 1] } }]
  const must_not: any[] = []
  if (categoryId) {
    must.push({ terms: { category_ids: [categoryId] } })
  } else {
    // Exclude non-food categories (cosmetics, household, garden, leisure)
    must_not.push({ terms: { category_ids: NON_FOOD_CATEGORY_IDS } })
  }
  if (text) {
    for (const word of text.toLowerCase().split(/\s+/)) {
      must.push({ wildcard: { name: `*${word}*` } })
    }
  }
  const filter: any = { bool: { must } }
  if (must_not.length) filter.bool.must_not = must_not
  const query = { query: { bool: { filter } } }
  const result = await catalogSearch('product', query, size)
  return (result?.hits?.hits || []).map((h: any) => formatProduct(h._source))
}

export async function getProduct(sku: string): Promise<Product | null> {
  const query = { query: { bool: { filter: { terms: { sku: [sku] } } } } }
  const result = await catalogSearch('product', query, 1)
  const hits = result?.hits?.hits || []
  return hits.length ? formatProduct(hits[0]._source) : null
}

export async function getDeals(categoryId?: number, size = 20): Promise<Product[]> {
  const must: any[] = [
    { terms: { status: [0, 1] } },
    { exists: { field: 'special_price' } },
  ]
  if (categoryId) must.push({ terms: { category_ids: [categoryId] } })
  const query = { query: { bool: { filter: { bool: { must } } } } }
  const result = await catalogSearch('product', query, size, 0, 'special_price:asc')
  return (result?.hits?.hits || [])
    .map((h: any) => formatProduct(h._source))
    .filter(p => p.special_price && p.special_price < p.price)
}
