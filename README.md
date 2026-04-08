# Selver Assistant

MCP server for [Selver.ee](https://selver.ee) — Estonia's largest grocery store. Connect it to Claude, ChatGPT, or any MCP-compatible AI agent to:

- **Search products** on Selver.ee by name (Estonian)
- **Manage your cart** — add, remove, update quantities
- **Track your pantry** — what's in the fridge
- **Plan meals** — the AI agent uses your pantry + family profile to suggest recipes
- **Schedule delivery** — browse timeslots and reserve slots

## Quick Start

```bash
# 1. Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# 2. Install dependencies
cd mcp-server && bun install

# 3. Copy config templates
cp data/config.example.json data/config.json
cp data/pantry.example.json data/pantry.json

# 4. Copy MCP config (for Claude Code)
cp .mcp.json.example .mcp.json
# Edit .mcp.json and set env vars

# 5. Set up environment
cp .env.example .env
# Edit .env with your SELVER_ID_CODE
```

### Claude Code

Copy `.mcp.json.example` to `.mcp.json` and restart Claude Code. The server will appear automatically.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "selver": {
      "command": "bun",
      "args": ["run", "/path/to/selver-assistant/mcp-server/server.ts"],
      "env": {
        "SELVER_ID_CODE": "your-estonian-id-code"
      }
    }
  }
}
```

## Storage

By default, data is stored in local JSON files (`data/`). For multi-device sync, set up Supabase:

1. Create a [Supabase](https://supabase.com) project
2. Run `supabase/schema.sql` in the SQL editor
3. Set `SUPABASE_URL` and `SUPABASE_KEY` in your `.env` or `.mcp.json`

The server auto-detects: if Supabase env vars are set, it uses Supabase. Otherwise, local JSON.

## Authentication

Selver uses Smart-ID (Estonian national ID) for login. The `login` tool launches a Playwright browser session:

```bash
# Prerequisites
pip install playwright
playwright install chromium

# Set your ID code
export SELVER_ID_CODE=your-estonian-id-code
```

When you call the `login` tool, confirm the verification code on your phone. Token lasts 1 hour.

## Tools

| Tool | Auth | Description |
|------|------|-------------|
| `search_products` | No | Search products by Estonian name |
| `browse_category` | No | Browse products in a category |
| `find_deals` | No | Products currently on sale |
| `auth_status` | No | Check auth token status |
| `login` | No | Trigger Smart-ID login |
| `cart_view` | Yes | View cart contents |
| `cart_add` | Yes | Add products by SKU |
| `cart_remove` | Yes | Remove item from cart |
| `cart_update_qty` | Yes | Change item quantity |
| `cart_clear` | Yes | Empty entire cart |
| `timeslots` | Yes | Available delivery slots |
| `reserve_timeslot` | Yes | Reserve a delivery slot |
| `pantry_view` | No | View pantry inventory |
| `pantry_add` | No | Add to pantry |
| `pantry_remove` | No | Remove from pantry |
| `family_config` | No | View family profile |
| `update_family_config` | No | Update family profile |

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Protocol**: [MCP](https://modelcontextprotocol.io) (Model Context Protocol)
- **Backend**: Selver.ee Vue Storefront + Magento API
- **Storage**: Local JSON or Supabase
- **Auth**: Playwright + Smart-ID

## License

MIT
