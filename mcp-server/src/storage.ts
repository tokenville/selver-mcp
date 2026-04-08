/**
 * Storage layer with Supabase primary + local JSON fallback.
 *
 * When SUPABASE_URL and SUPABASE_KEY are set, uses Supabase.
 * Otherwise falls back to local JSON files in data/.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { PantryItem, FamilyConfig } from './types.js'

const DATA_DIR = join(dirname(dirname(import.meta.dir)), 'data')
const PANTRY_FILE = join(DATA_DIR, 'pantry.json')
const CONFIG_FILE = join(DATA_DIR, 'config.json')

// ── Interface ─────────────────────────────────────────────────────────────

export interface Storage {
  readonly backend: 'supabase' | 'local'

  getPantry(): Promise<PantryItem[]>
  addPantryItem(name: string, quantity?: number, unit?: string, category?: string): Promise<PantryItem[]>
  addPantryItems(items: { name: string; quantity?: number; unit?: string; category?: string }[]): Promise<PantryItem[]>
  removePantryItem(name: string, quantity?: number): Promise<PantryItem[]>
  removePantryItems(items: { name: string; quantity?: number }[]): Promise<PantryItem[]>

  getConfig(): Promise<FamilyConfig | null>
  updateConfig(config: Partial<FamilyConfig>): Promise<FamilyConfig>
}

// ── Supabase implementation ───────────────────────────────────────────────

class SupabaseStorage implements Storage {
  readonly backend = 'supabase' as const
  private db: SupabaseClient

  constructor(url: string, key: string) {
    this.db = createClient(url, key)
  }

  async getPantry(): Promise<PantryItem[]> {
    const { data, error } = await this.db
      .from('pantry_items')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) throw new Error(`Supabase pantry read: ${error.message}`)
    return (data || []).map(row => ({
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      category: row.category,
      image: row.image,
      added: row.created_at,
    }))
  }

  async addPantryItem(name: string, quantity?: number, unit?: string, category?: string): Promise<PantryItem[]> {
    return this.addPantryItems([{ name, quantity, unit, category }])
  }

  async addPantryItems(items: { name: string; quantity?: number; unit?: string; category?: string }[]): Promise<PantryItem[]> {
    const { data: allRows } = await this.db.from('pantry_items').select('*')
    const byName = new Map((allRows || []).map(r => [r.name.toLowerCase(), r]))

    const toInsert: object[] = []
    const ops: Promise<any>[] = []

    for (const item of items) {
      const row = byName.get(item.name.toLowerCase())
      if (row) {
        const update: Record<string, any> = {}
        if (item.quantity && row.quantity) update.quantity = row.quantity + item.quantity
        if (item.unit) update.unit = item.unit
        if (item.category) update.category = item.category
        if (Object.keys(update).length) {
          ops.push(this.db.from('pantry_items').update(update).eq('id', row.id))
        }
      } else {
        toInsert.push({ name: item.name, quantity: item.quantity, unit: item.unit, category: item.category })
        byName.set(item.name.toLowerCase(), { name: item.name })
      }
    }

    if (toInsert.length) ops.push(this.db.from('pantry_items').insert(toInsert))
    await Promise.all(ops)

    return this.getPantry()
  }

  async removePantryItem(name: string, quantity?: number): Promise<PantryItem[]> {
    return this.removePantryItems([{ name, quantity }])
  }

  async removePantryItems(items: { name: string; quantity?: number }[]): Promise<PantryItem[]> {
    const { data: allRows } = await this.db.from('pantry_items').select('*')
    const rows = allRows || []
    const ops: Promise<any>[] = []

    for (const item of items) {
      const row = rows.find(r => r.name.toLowerCase().includes(item.name.toLowerCase()))
      if (!row) continue
      if (item.quantity && row.quantity && row.quantity > item.quantity) {
        ops.push(this.db.from('pantry_items').update({ quantity: row.quantity - item.quantity }).eq('id', row.id))
      } else {
        ops.push(this.db.from('pantry_items').delete().eq('id', row.id))
      }
    }

    await Promise.all(ops)
    return this.getPantry()
  }

  async getConfig(): Promise<FamilyConfig | null> {
    const { data, error } = await this.db
      .from('config')
      .select('data')
      .eq('key', 'family')
      .single()
    if (error || !data) return null
    return data.data as FamilyConfig
  }

  async updateConfig(patch: Partial<FamilyConfig>): Promise<FamilyConfig> {
    const current = await this.getConfig() || {} as FamilyConfig
    const merged = { ...current, ...patch }
    await this.db
      .from('config')
      .upsert({ key: 'family', data: merged })
    return merged
  }
}

// ── Local JSON implementation ─────────────────────────────────────────────

class LocalStorage implements Storage {
  readonly backend = 'local' as const

  private ensureDataDir() {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  }

  private readJson<T>(path: string, fallback: T): T {
    if (!existsSync(path)) return fallback
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return fallback
    }
  }

  private writeJson(path: string, data: any) {
    this.ensureDataDir()
    writeFileSync(path, JSON.stringify(data, null, 2))
  }

  async getPantry(): Promise<PantryItem[]> {
    const raw = this.readJson(PANTRY_FILE, [])
    return Array.isArray(raw) ? raw : (raw as any).items || []
  }

  async addPantryItem(name: string, quantity?: number, unit?: string, category?: string): Promise<PantryItem[]> {
    return this.addPantryItems([{ name, quantity, unit, category }])
  }

  async addPantryItems(items: { name: string; quantity?: number; unit?: string; category?: string }[]): Promise<PantryItem[]> {
    const pantry = await this.getPantry()
    for (const item of items) {
      const existing = pantry.find(i => i.name.toLowerCase() === item.name.toLowerCase())
      if (existing) {
        if (item.quantity) existing.quantity = (existing.quantity || 0) + item.quantity
        if (item.unit) existing.unit = item.unit
        if (item.category) existing.category = item.category
      } else {
        const entry: PantryItem = { name: item.name, added: new Date().toISOString() }
        if (item.quantity) entry.quantity = item.quantity
        if (item.unit) entry.unit = item.unit
        if (item.category) entry.category = item.category
        pantry.push(entry)
      }
    }
    this.writeJson(PANTRY_FILE, pantry)
    return pantry
  }

  async removePantryItem(name: string, quantity?: number): Promise<PantryItem[]> {
    return this.removePantryItems([{ name, quantity }])
  }

  async removePantryItems(items: { name: string; quantity?: number }[]): Promise<PantryItem[]> {
    const pantry = await this.getPantry()
    for (const item of items) {
      const idx = pantry.findIndex(i => i.name.toLowerCase().includes(item.name.toLowerCase()))
      if (idx >= 0) {
        if (item.quantity && pantry[idx].quantity && pantry[idx].quantity! > item.quantity) {
          pantry[idx].quantity! -= item.quantity
        } else {
          pantry.splice(idx, 1)
        }
      }
    }
    this.writeJson(PANTRY_FILE, pantry)
    return pantry
  }

  async getConfig(): Promise<FamilyConfig | null> {
    const data = this.readJson(CONFIG_FILE, null)
    return data as FamilyConfig | null
  }

  async updateConfig(patch: Partial<FamilyConfig>): Promise<FamilyConfig> {
    const current = (await this.getConfig()) || {} as FamilyConfig
    const merged = { ...current, ...patch }
    this.writeJson(CONFIG_FILE, merged)
    return merged
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createStorage(): Storage {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY

  if (url && key) {
    process.stderr.write(`storage: supabase (${url})\n`)
    return new SupabaseStorage(url, key)
  }

  process.stderr.write(`storage: local (${DATA_DIR})\n`)
  return new LocalStorage()
}
