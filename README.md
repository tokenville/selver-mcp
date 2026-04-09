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
  <img src="https://img.shields.io/badge/auth-Smart--ID-orange" alt="Smart-ID" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

---

## What can it do?

- **Search products** on Selver.ee catalog (Estonian)
- **Manage your cart** — add, remove, update quantities, checkout
- **Browse deals** — find discounted products by category
- **Schedule delivery** — browse timeslots and reserve slots
- **Smart-ID auth** — login with Estonian personal ID

> **Looking for pantry, family config, and purchase preferences?** Check out [grocery-manager](https://github.com/vibenya/grocery-manager) — a companion Claude Code skill that handles the household side. It works with this MCP for preference-aware shopping.

## Example prompts

Once connected, just talk to your AI agent naturally:

```
🔍 "Find chicken breast on Selver"
🛒 "Add 2kg potatoes and milk to cart"
📅 "Show delivery slots for tomorrow"
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
# Edit .mcp.json — add your SELVER_ID_CODE
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

### Product categories

`milk`, `cottage`, `yogurt`, `eggs`, `butter`, `cheese`, `bread`, `pork`, `chicken`, `fish`, `vegetables`, `fruits`, `tropical`, `mushrooms`, `herbs`, `berries`, `salads`, `spices`, `oils`, `dry_goods`, `drinks`, `frozen_meat`, `sausages`, `sweets`, `baby`, `pets`, `household`

## Tech Stack

- **Runtime** — [Bun](https://bun.sh)
- **Protocol** — [MCP](https://modelcontextprotocol.io) (Model Context Protocol)
- **Backend** — Selver.ee Vue Storefront + Magento API
- **Auth** — [Playwright](https://playwright.dev) + Smart-ID

## License

MIT
