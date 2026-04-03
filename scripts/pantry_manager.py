"""
Pantry Manager — управление домашней кладовой
"""

import json
from pathlib import Path
from datetime import date

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
PANTRY_FILE = DATA_DIR / "pantry.json"


def load_pantry() -> dict:
    if PANTRY_FILE.exists():
        return json.loads(PANTRY_FILE.read_text())
    return {"items": {}, "last_updated": None}


def save_pantry(data: dict):
    data["last_updated"] = date.today().isoformat()
    PANTRY_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def add_item(name: str, qty: float, unit: str = "шт", sku: str = None, notes: str = None):
    """Add or update item in pantry"""
    pantry = load_pantry()
    pantry["items"][name] = {
        "qty": qty,
        "unit": unit,
        "sku": sku,
        "notes": notes,
        "added": date.today().isoformat(),
    }
    save_pantry(pantry)
    return f"✅ Добавлено: {name} — {qty} {unit}"


def remove_item(name: str):
    """Remove item from pantry"""
    pantry = load_pantry()
    if name in pantry["items"]:
        del pantry["items"][name]
        save_pantry(pantry)
        return f"🗑 Удалено: {name}"
    return f"❌ Не найдено: {name}"


def update_qty(name: str, qty: float):
    """Update quantity of an item"""
    pantry = load_pantry()
    if name in pantry["items"]:
        pantry["items"][name]["qty"] = qty
        save_pantry(pantry)
        return f"✅ Обновлено: {name} — теперь {qty} {pantry['items'][name].get('unit', '')}"
    return f"❌ Не найдено: {name}"


def use_item(name: str, qty: float):
    """Subtract quantity (used in cooking)"""
    pantry = load_pantry()
    if name in pantry["items"]:
        current = pantry["items"][name]["qty"]
        new_qty = max(0, current - qty)
        pantry["items"][name]["qty"] = new_qty
        save_pantry(pantry)
        unit = pantry["items"][name].get("unit", "")
        return f"✅ Использовано: {qty} {unit} {name}. Осталось: {new_qty} {unit}"
    return f"❌ Не найдено: {name}"


def list_pantry() -> str:
    """Format pantry as readable text"""
    pantry = load_pantry()
    items = pantry.get("items", {})
    if not items:
        return "🏠 Кладовая пуста"

    lines = [f"🏠 Кладовая ({len(items)} позиции):"]
    for name, info in sorted(items.items()):
        qty = info.get("qty", "?")
        unit = info.get("unit", "")
        low = "⚠️ " if isinstance(qty, (int, float)) and qty < 1 else ""
        lines.append(f"  {low}{name}: {qty} {unit}".rstrip())

    updated = pantry.get("last_updated")
    if updated:
        lines.append(f"\nОбновлено: {updated}")
    return "\n".join(lines)


def add_from_shopping_list(shopping_list: list):
    """Add items from a shopping list to pantry"""
    results = []
    for item in shopping_list:
        name = item.get("name", "")
        qty = item.get("qty_numeric", 1)
        unit = item.get("unit", "шт")
        sku = item.get("sku")
        if name:
            results.append(add_item(name, qty, unit, sku=sku))
    return "\n".join(results)


def get_low_stock(threshold: float = 1.0) -> list:
    """Return items with low quantity"""
    pantry = load_pantry()
    low = []
    for name, info in pantry.get("items", {}).items():
        qty = info.get("qty", 0)
        if isinstance(qty, (int, float)) and qty <= threshold:
            low.append({"name": name, "qty": qty, "unit": info.get("unit", "")})
    return low


def parse_add_command(text: str) -> tuple:
    """
    Parse natural language add command.
    Examples:
      "молоко 2 л" -> ("молоко", 2, "л")
      "яйца 10 шт" -> ("яйца", 10, "шт")
      "масло" -> ("масло", 1, "шт")
    """
    parts = text.strip().split()
    if len(parts) >= 3:
        name = " ".join(parts[:-2])
        try:
            qty = float(parts[-2])
            unit = parts[-1]
            return name, qty, unit
        except ValueError:
            pass
    if len(parts) >= 2:
        try:
            qty = float(parts[-1])
            name = " ".join(parts[:-1])
            return name, qty, "шт"
        except ValueError:
            pass
    return text.strip(), 1, "шт"


if __name__ == "__main__":
    print(list_pantry())
    print()
    print(add_item("молоко", 2, "л", notes="Tere 2.5%"))
    print(add_item("яйца", 12, "шт"))
    print(add_item("сливочное масло", 200, "г"))
    print(add_item("гречка", 500, "г"))
    print(add_item("макароны", 400, "г"))
    print()
    print(list_pantry())
