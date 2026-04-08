# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Python toolkit for interacting with Selver.ee (Estonian grocery store) — browsing products, managing a household pantry, generating AI meal plans, and placing orders. Designed to be driven via Telegram commands.

## Running Scripts

All scripts live in `scripts/` and are run directly with Python. They import each other as local modules, so run from `scripts/`:

```bash
cd scripts

# Search products on Selver
python3 selver_api.py

# List pantry
python3 pantry_manager.py

# Generate today's meal plan (calls Claude API)
python3 meal_planner.py

# Generate tomorrow's menu (used by cron)
python3 daily_menu_cron.py

# Generate weekly shopping list and match to Selver products
python3 shopping_assistant.py
```

## Authentication

Selver uses Vue Storefront + Magento with Smart-ID (Estonian national ID) via SSO at `sso.partnerkaart.ee`.

- Token is stored in `data/selver_token.json` as `shop/user/current-token` from localStorage
- `SelverAPI.ensure_auth()` loads the token or triggers browser login via Playwright
- Browser login: `python3 scripts/selver_auth.py [--id-code 38511080251] [--visible]`
- The `--visible` flag opens a real browser window — useful for debugging the auth flow

## Architecture

```
selver_api.py       — SelverAPI class: catalog search, cart CRUD, timeslots, shipping
selver_auth.py      — Playwright-based Smart-ID browser login → saves to data/selver_token.json
meal_planner.py     — Claude API meal plan generation → data/meal_plan.json
pantry_manager.py   — Read/write data/pantry.json (add/remove/update quantities)
shopping_assistant.py — Combines meal plan + pantry + Selver search → cart
daily_menu_cron.py  — Generates tomorrow's menu, prints for cron to capture and deliver
```

Data files in `data/`:
- `config.json` — family profile, address, meal preferences, Selver credentials
- `pantry.json` — current home inventory with quantities and units
- `meal_plan.json` — generated menus keyed by date
- `selver_token.json` — auth token + cart token + cookies

## Selver API Notes

- Backend: Vue Storefront (VSF) + Magento, catalog index `vue_storefront_catalog_et`
- All requests use `?storeCode=et`
- Product search uses Elasticsearch wildcard queries on `name` field — works well for Estonian
- Cart operations use a `cartId` (quote ID from Magento) stored in `selver_token.json`
- Delivery method ID for home courier: `419`
- Known category IDs are hardcoded in `CATEGORIES` dict in `selver_api.py`

## Claude API Usage

`meal_planner.py` and `shopping_assistant.py` call Claude (currently `claude-opus-4-5`) to:
- Generate daily menus in JSON from pantry contents
- Generate weekly shopping lists respecting budget and pantry stock

Requires `ANTHROPIC_API_KEY` in environment.

## Config

`data/config.json` is the single source of truth for family profile, address, and Selver credentials. The `selver.token` field is not used directly (token is in `data/selver_token.json`); the config's `selver` section holds `cart_id` and `delivery_postcode`.
