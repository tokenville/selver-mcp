<p align="center">
  <img src="https://images.delfi.ee/media-api-image-cropper/v1/ac35d598-df6e-42e9-bedb-459a59976f5e.jpg?noup&w=1200&h=711" alt="e-Selver delivery van" width="600" />
</p>

<h1 align="center">Selver MCP</h1>

<p align="center">
  MCP server for <a href="https://selver.ee">Selver.ee</a> — Estonia's largest grocery store.<br>
  Connect to Claude, ChatGPT, or any MCP-compatible AI agent.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/MCP-Model_Context_Protocol-blue" alt="MCP" />
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/storage-Supabase-3fcf8e?logo=supabase" alt="Supabase" />
  <img src="https://img.shields.io/badge/auth-Smart--ID-orange" alt="Smart-ID" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

---

## What can it do?

- **Search products** on Selver.ee catalog (Estonian)
- **Manage your cart** — add, remove, update quantities, checkout
- **Track your pantry** — what's at home, batch add/remove
- **Plan meals** — AI uses your pantry + family profile to suggest recipes
- **Schedule delivery** — browse timeslots and reserve slots
- **Family config** — store family members, dietary preferences, address

## Example prompts

Once connected, just talk to your AI agent naturally:

```
🔍 "Find chicken breast on Selver"
🛒 "Add 2kg potatoes and milk to cart"
📦 "What's in my pantry?"
🗑️ "We ate the eggs and butter, remove them"
🍽️ "Suggest dinner for tonight based on what we have"
📅 "Show delivery slots for tomorrow"
👨‍👩‍👧‍👦 "Set up family: 2 adults, 2 kids (ages 3 and 12)"
💰 "Find deals on meat this week"
🛍️ "Build a grocery list for the week, budget 80€"
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- Estonian personal ID code (for Smart-ID auth)
- Python + Playwright (for login only)

```bash
# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Install Playwright for Smart-ID login
pip install playwright && playwright install chromium
```

### Installation

```bash
git clone https://github.com/tokenville/selver-mcp.git
cd selver-mcp

# Install dependencies
cd mcp-server && bun install && cd ..

# Set up environment
cp .env.example .env
# Edit .env — add your SELVER_ID_CODE
```

### Connect to Claude Code

```bash
cp .mcp.json.example .mcp.json
# Edit .mcp.json — add your SELVER_ID_CODE (and Supabase keys if using)
```

Restart Claude Code — the Selver server appears automatically.

### Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "selver": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/selver-mcp/mcp-server/server.ts"],
      "env": {
        "SELVER_ID_CODE": "your-estonian-id-code"
      }
    }
  }
}
```

### Authentication

Selver uses **Smart-ID** (Estonian national ID). When you ask the agent to log in:

1. Agent calls the `login` tool
2. You get a 4-digit verification code
3. Confirm it on your phone via Smart-ID app
4. Token is valid for 1 hour

## Storage

By default, pantry and family config are stored in **local JSON files** (`data/`). This works great for single-user setups.

### Supabase (recommended for shared/multi-device use)

For syncing across devices or sharing with family members, set up [Supabase](https://supabase.com):

**1. Create a project**

Sign up at [supabase.com](https://supabase.com) and create a new project (free tier is enough).

**2. Create tables**

Go to **SQL Editor** and run:

```sql
create table if not exists pantry_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity numeric,
  unit text,
  category text,
  image text,
  created_at timestamptz default now()
);

create table if not exists config (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
```

**3. Get your keys**

Go to **Settings → API** and copy:
- **Project URL** → `SUPABASE_URL`
- **anon public key** → `SUPABASE_KEY`

**4. Add to your config**

```bash
# In .env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "selver": {
      "command": "bun",
      "args": ["run", "mcp-server/server.ts"],
      "env": {
        "SELVER_ID_CODE": "your-id",
        "SUPABASE_URL": "https://xxxxx.supabase.co",
        "SUPABASE_KEY": "eyJhbGciOiJIUzI1NiIs..."
      }
    }
  }
}
```

The server auto-detects: if Supabase env vars are set → Supabase. Otherwise → local JSON.

## Multi-user setup (sharing with family)

Want both you and your partner to manage the same pantry and cart? Here's how:

**1. Use Supabase** (see above) — both users share the same database.

**2. Each person installs the MCP server** on their own machine with the same Supabase credentials:

```bash
# Person A (your machine)
git clone https://github.com/tokenville/selver-mcp.git
cd selver-mcp && cd mcp-server && bun install
# Set .env with YOUR Selver ID + shared Supabase keys

# Person B (partner's machine)
git clone https://github.com/tokenville/selver-mcp.git
cd selver-mcp && cd mcp-server && bun install
# Set .env with THEIR Selver ID + same Supabase keys
```

**3. Pantry and family config sync automatically** — both see the same inventory.

**4. Cart is per-user** — each person has their own Selver account and cart (tied to their Smart-ID).

> **Tip:** Set up the family config once — it syncs to both users via Supabase. Either person can say "add eggs to pantry" or "we're out of milk" and both see the update.

## Tools Reference

| Tool | Auth | Description |
|------|:----:|-------------|
| `search_products` | — | Search products by name (Estonian) |
| `browse_category` | — | Browse a product category |
| `find_deals` | — | Products currently on sale |
| `auth_status` | — | Check auth token status |
| `login` | — | Smart-ID login (phone confirmation) |
| `cart_view` | ✓ | View cart contents and totals |
| `cart_add` | ✓ | Add products by SKU (batch) |
| `cart_remove` | ✓ | Remove item from cart |
| `cart_update_qty` | ✓ | Change item quantity |
| `cart_clear` | ✓ | Empty entire cart |
| `timeslots` | ✓ | Available delivery time slots |
| `reserve_timeslot` | ✓ | Reserve a delivery slot (45 min hold) |
| `pantry_view` | — | View home inventory |
| `pantry_add` | — | Add items to pantry (batch) |
| `pantry_remove` | — | Remove items from pantry (batch) |
| `family_config` | — | View family profile |
| `update_family_config` | — | Update family profile |

### Product categories

`milk`, `cottage`, `yogurt`, `eggs`, `butter`, `cheese`, `bread`, `pork`, `chicken`, `fish`, `vegetables`, `fruits`, `tropical`, `mushrooms`, `herbs`, `berries`, `salads`, `spices`, `oils`, `dry_goods`, `drinks`, `frozen_meat`, `sausages`, `sweets`, `baby`, `pets`, `household`

## Tech Stack

- **Runtime** — [Bun](https://bun.sh)
- **Protocol** — [MCP](https://modelcontextprotocol.io) (Model Context Protocol)
- **Backend** — Selver.ee Vue Storefront + Magento API
- **Storage** — Local JSON or [Supabase](https://supabase.com)
- **Auth** — [Playwright](https://playwright.dev) + Smart-ID

## License

MIT
