/**
 * Selver.ee auth — token management, Smart-ID login.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, dirname } from 'path'
import type { TokenData } from './types.js'

const BASE = 'https://www.selver.ee'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const DATA_DIR = join(dirname(dirname(import.meta.dir)), 'data')
const TOKEN_FILE = join(DATA_DIR, 'selver_token.json')

export class SelverAuth {
  token: string | null = null
  cartToken: string | null = null
  cookies: Record<string, string> = {}
  user: Record<string, any> = {}

  constructor() {
    this.loadToken()
  }

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

  authHeaders(): Record<string, string> {
    const hdrs: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    }
    if (this.token) hdrs['Authorization'] = `Bearer ${this.token}`
    if (Object.keys(this.cookies).length > 0) {
      hdrs['Cookie'] = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }
    return hdrs
  }

  async checkAuth(): Promise<{ valid: boolean; user?: string; error?: string; expires_in?: number }> {
    if (!this.token) return { valid: false, error: 'No token loaded' }

    try {
      const payload = JSON.parse(Buffer.from(this.token.split('.')[1], 'base64url').toString())
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp && now >= payload.exp) {
        return { valid: false, error: `Token expired ${Math.floor((now - payload.exp) / 60)} minutes ago` }
      }
      const expiresIn = payload.exp ? payload.exp - now : undefined

      const r = await fetch(`${BASE}/api/user/me?token=${this.token}`, { headers: this.authHeaders() })
      const body = await r.json() as any
      if (body.code === 200) {
        return { valid: true, user: `${body.result.firstname} ${body.result.lastname}`, expires_in: expiresIn }
      }
      return { valid: false, error: body.result || 'Unknown error' }
    } catch (e: any) {
      return { valid: false, error: e.message }
    }
  }

  async triggerLogin(timeout = 180): Promise<string> {
    const idCode = process.env.SELVER_ID_CODE
    if (!idCode) return 'SELVER_ID_CODE env var not set. Set it to your Estonian personal ID code.'

    const script = join(dirname(dirname(import.meta.dir)), 'scripts', 'selver_auth.py')
    if (!existsSync(script)) {
      return `Auth script not found at ${script}. Install: pip install playwright && playwright install chromium`
    }

    try {
      const output = execFileSync(
        'python3',
        [script, '--id-code', idCode, '--timeout', String(timeout)],
        { timeout: (timeout + 30) * 1000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      )
      this.loadToken()
      const codeMatch = output.match(/Verification code: (\d{4})/)
      return codeMatch
        ? `Smart-ID verification code: ${codeMatch[1]}. Confirm on your phone!`
        : output
    } catch (e: any) {
      return `Auth failed: ${e.stderr || e.message}`
    }
  }

  saveCartToken(cartToken: string) {
    this.cartToken = cartToken
    if (existsSync(TOKEN_FILE)) {
      const data = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
      data.cart_token = cartToken
      writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2))
    }
  }
}
