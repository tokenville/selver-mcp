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
  removePantryItem(name: string, quantity?: number): Promise<PantryItem[]>

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
    // Check if item exists (case-insensitive)
    const { data: existing } = await this.db
      .from('pantry_items')
      .select('*')
      .ilike('name', name)
      .limit(1)

    if (existing?.length) {
      const item = existing[0]
      if (quantity && item.quantity) {
        await this.db
          .from('pantry_items')
          .update({ quantity: item.quantity + quantity })
          .eq('id', item.id)
      }
    } else {
      await this.db
        .from('pantry_items')
        .insert({ name, quantity, unit, category })
    }

    return this.getPantry()
  }

  async removePantryItem(name: string, quantity?: number): Promise<PantryItem[]> {
    const { data: existing } = await this.db
      .from('pantry_items')
      .select('*')
      .ilike('name', `%${name}%`)
      .limit(1)

    if (existing?.length) {
      const item = existing[0]
      if (quantity && item.quantity && item.quantity > quantity) {
        await this.db
          .from('pantry_items')
          .update({ quantity: item.quantity - quantity })
          .eq('id', item.id)
      } else {
        await this.db
          .from('pantry_items')
          .delete()
          .eq('id', item.id)
      }
    }

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
    const items = await this.getPantry()
    const existing = items.find(i => i.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      if (quantity) existing.quantity = (existing.quantity || 0) + quantity
      if (unit) existing.unit = unit
      if (category) existing.category = category
    } else {
      const entry: PantryItem = { name, added: new Date().toISOString() }
      if (quantity) entry.quantity = quantity
      if (unit) entry.unit = unit
      if (category) entry.category = category
      items.push(entry)
    }
    this.writeJson(PANTRY_FILE, items)
    return items
  }

  async removePantryItem(name: string, quantity?: number): Promise<PantryItem[]> {
    const items = await this.getPantry()
    const idx = items.findIndex(i => i.name.toLowerCase().includes(name.toLowerCase()))
    if (idx >= 0) {
      if (quantity && items[idx].quantity && items[idx].quantity! > quantity) {
        items[idx].quantity! -= quantity
      } else {
        items.splice(idx, 1)
      }
    }
    this.writeJson(PANTRY_FILE, items)
    return items
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
