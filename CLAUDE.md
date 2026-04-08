# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MCP server for Selver.ee (Estonian grocery store) — product search, cart management, pantry tracking, family config. Designed to be used by AI agents (Claude, ChatGPT) via Model Context Protocol.

## Running the Server

```bash
cd mcp-server && bun install && bun run start
```

For Claude Code, copy `.mcp.json.example` → `.mcp.json` and the server auto-connects.

## Architecture

```
mcp-server/
  server.ts          — McpServer entry point, all tool definitions
  src/
    catalog.ts       — Selver product search, categories, deals (no auth)
    cart.ts          — Cart CRUD, timeslots, delivery (requires auth)
    auth.ts          — Token management, Smart-ID login via Playwright
    storage.ts       — Storage layer: Supabase primary, local JSON fallback
    types.ts         — Shared TypeScript types
scripts/
  selver_auth.py     — Playwright Smart-ID browser login (called by auth.ts)
data/
  config.json        — Family profile, address, preferences (gitignored)
  pantry.json        — Home inventory (gitignored)
  selver_token.json  — Auth token (gitignored)
supabase/
  schema.sql         — Database schema for Supabase setup
```

## Storage

Auto-detects backend from env vars:
- `SUPABASE_URL` + `SUPABASE_KEY` set → Supabase
- Otherwise → local JSON in `data/`

Tables: `pantry_items`, `config` (key-value with JSONB data column).

## Selver API Notes

- Backend: Vue Storefront (VSF) + Magento, catalog index `vue_storefront_catalog_et`
- All requests use `?storeCode=et`
- Product search uses Elasticsearch wildcard queries on `name` field
- Cart operations use a `cartId` (quote ID) stored in `data/selver_token.json`
- Delivery method ID for home courier: `419`
- Category IDs are in `CATEGORIES` map in `src/catalog.ts`

## Environment Variables

- `SELVER_ID_CODE` — Estonian personal ID for Smart-ID auth
- `SUPABASE_URL` — Supabase project URL (optional)
- `SUPABASE_KEY` — Supabase anon key (optional)
