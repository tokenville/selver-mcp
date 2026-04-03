"""
Shopping Assistant — matches meal plan shopping list to Selver products
and creates a cart order
"""

import json
import os
from pathlib import Path
from anthropic import Anthropic
from selver_api import SelverAPI
from meal_planner import load_json, get_today_menu

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
CONFIG_FILE = DATA_DIR / "config.json"


def get_config() -> dict:
    return load_json(CONFIG_FILE)


def get_selver_api() -> SelverAPI:
    config = get_config()
    sc = config.get("selver", {})
    api = SelverAPI(token=sc.get("token"))
    if not api.token and sc.get("email") and sc.get("password"):
        result = api.login(sc["email"], sc["password"])
        if result.get("code") == 200:
            # Save token
            sc["token"] = api.token
            config["selver"] = sc
            CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2))
    return api


def find_best_product(api: SelverAPI, item_name: str) -> dict | None:
    """Find the best matching Selver product for a shopping list item"""
    # Try direct search
    results = api.search_products(text=item_name, size=5)
    if results:
        # Return cheapest in-stock item
        in_stock = [p for p in results if p.get("in_stock", True)]
        if in_stock:
            return sorted(in_stock, key=lambda x: x.get("price", 999))[0]
        return results[0]
    return None


def match_shopping_list_to_products(
    shopping_list: list, api: SelverAPI
) -> list:
    """
    Match each shopping list item to a Selver product.
    Returns list of {"item": ..., "product": ..., "found": bool}
    """
    matched = []
    for item in shopping_list:
        name = item.get("name", "")
        product = find_best_product(api, name)
        matched.append({
            "item": item,
            "product": product,
            "found": product is not None,
        })
    return matched


def format_shopping_summary(matched: list) -> str:
    """Format matched shopping list for Telegram"""
    found = [m for m in matched if m["found"]]
    not_found = [m for m in matched if not m["found"]]

    lines = [f"🛒 Список покупок ({len(matched)} позиции)\n"]

    if found:
        total = sum(m["product"]["price"] for m in found if m["product"])
        lines.append(f"Найдено в Selver ({len(found)} поз, ~{total:.2f}€):")
        for m in found:
            p = m["product"]
            item = m["item"]
            lines.append(f"  ✅ {item['name']} → {p['name']} ({p['price']}€)")

    if not_found:
        lines.append(f"\nНе найдено ({len(not_found)} поз):")
        for m in not_found:
            lines.append(f"  ❌ {m['item']['name']}")

    return "\n".join(lines)


def create_selver_order(matched: list, api: SelverAPI) -> str:
    """Create Selver cart with matched products"""
    config = get_config()
    sc = config.get("selver", {})

    # Get or create cart
    cart_id = sc.get("cart_id")
    if not cart_id:
        cart_id = api.create_cart()
        sc["cart_id"] = cart_id
        config["selver"] = sc
        CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2))

    if not cart_id:
        return "❌ Не удалось создать корзину"

    # Add items
    items_to_add = []
    for m in matched:
        if m["found"] and m["product"]:
            qty_str = m["item"].get("qty", "1")
            # Parse qty
            try:
                qty = float("".join(c for c in str(qty_str) if c.isdigit() or c == "."))
                qty = max(1.0, qty)
            except:
                qty = 1.0
            items_to_add.append({"sku": m["product"]["sku"], "qty": qty})

    if not items_to_add:
        return "❌ Нет товаров для добавления"

    result = api.add_multiple_to_cart(cart_id, items_to_add)

    # Get totals
    totals = api.get_cart_totals(cart_id)
    grand_total = totals.get("result", {}).get("grand_total", 0)

    cart_url = "https://www.selver.ee/cart"
    return (
        f"✅ Корзина создана! {len(items_to_add)} товаров\n"
        f"💰 Итого: ~{grand_total:.2f}€\n"
        f"🔗 {cart_url}"
    )


def generate_weekly_shopping_list(config: dict, pantry: dict) -> list:
    """Use Claude to generate a weekly shopping list based on preferences"""
    client = Anthropic()
    family = config.get("family", {})
    mp = config.get("meal_planning", {})
    budget = mp.get("budget_per_week_eur", 80)

    pantry_text = "\n".join(
        f"- {n}: {i.get('qty')} {i.get('unit', '')}"
        for n, i in pantry.items()
    ) if pantry else "Кладовая пуста"

    prompt = f"""Составь список покупок на неделю для семьи.

Семья: {family.get('adults', 2)} взрослых, {family.get('children', 0)} детей
Бюджет: ~{budget}€ в неделю
Предпочтения: {', '.join(mp.get('cuisine_preferences', []))}
Аллергии: {', '.join(family.get('allergies', [])) or 'нет'}

Что уже есть дома:
{pantry_text}

Составь список покупок на неделю. Покупай только то, чего нет дома или мало.
Ориентируйся на эстонский магазин Selver.

Ответь СТРОГО в формате JSON (список):
[
  {{"name": "молоко", "qty": "2 л", "qty_numeric": 2, "unit": "л", "category": "молочные", "reason": "завтраки"}},
  ...
]"""

    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    return json.loads(text)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from pantry_manager import load_pantry

    config = get_config()
    pantry = load_pantry().get("items", {})

    print("Генерирую список покупок на неделю...")
    shopping_list = generate_weekly_shopping_list(config, pantry)
    print(f"Список: {len(shopping_list)} позиции")
    for item in shopping_list[:10]:
        print(f"  {item['name']} — {item['qty']} ({item.get('reason', '')})")
