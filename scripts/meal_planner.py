"""
AI Meal Planner — generates daily menu from pantry using Claude API
"""

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from anthropic import Anthropic

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"

PANTRY_FILE = DATA_DIR / "pantry.json"
PLAN_FILE = DATA_DIR / "meal_plan.json"
CONFIG_FILE = DATA_DIR / "config.json"


def load_json(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_json(path: Path, data: dict):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def get_pantry() -> dict:
    return load_json(PANTRY_FILE).get("items", {})


def get_config() -> dict:
    return load_json(CONFIG_FILE)


def generate_daily_menu(
    pantry: dict,
    config: dict,
    date_str: str = None,
    adjustments: str = None,
) -> dict:
    """Generate menu for today using Claude"""
    client = Anthropic()
    today = date_str or date.today().isoformat()
    family = config.get("family", {})
    mp = config.get("meal_planning", {})

    pantry_text = "\n".join(
        f"- {name}: {info.get('qty', '?')} {info.get('unit', '')}"
        for name, info in pantry.items()
    ) if pantry else "Кладовая пуста"

    adjustment_text = f"\nПожелания/коррективы: {adjustments}" if adjustments else ""

    prompt = f"""Ты домашний шеф-повар и планировщик питания. Составь меню на {today}.

Семья: {family.get('adults', 2)} взрослых, {family.get('children', 0)} детей
Аллергии: {', '.join(family.get('allergies', [])) or 'нет'}
Предпочтения кухни: {', '.join(mp.get('cuisine_preferences', []))}
Блюда в день: {', '.join(mp.get('meals_per_day', ['завтрак', 'обед', 'ужин']))}

Что есть дома (кладовая):
{pantry_text}
{adjustment_text}

Составь меню используя в первую очередь то, что есть дома. Если нужно докупить — укажи список покупок отдельно.

Ответь СТРОГО в формате JSON:
{{
  "date": "{today}",
  "meals": {{
    "breakfast": {{
      "name": "Название блюда",
      "description": "Краткое описание",
      "recipe_steps": ["шаг 1", "шаг 2"],
      "ingredients": [{{"name": "ингредиент", "qty": "100г", "in_pantry": true}}]
    }},
    "lunch": {{ ... }},
    "dinner": {{ ... }}
  }},
  "shopping_needed": [
    {{"name": "продукт", "qty": "сколько купить", "reason": "для чего"}}
  ],
  "notes": "дополнительные заметки"
}}"""

    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text.strip()
    # Extract JSON from response
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    menu = json.loads(text)
    return menu


def update_meal_plan(menu: dict):
    """Save menu to meal plan file"""
    plan = load_json(PLAN_FILE)
    if "days" not in plan:
        plan["days"] = {}
    plan["days"][menu["date"]] = menu
    if not plan.get("week_start"):
        plan["week_start"] = menu["date"]
    save_json(PLAN_FILE, plan)


def format_menu_message(menu: dict) -> str:
    """Format menu for Telegram message"""
    date_str = menu.get("date", "сегодня")
    lines = [f"🍽 Меню на {date_str}\n"]

    meal_emojis = {"breakfast": "🌅", "lunch": "☀️", "dinner": "🌙"}
    meal_names = {"breakfast": "Завтрак", "lunch": "Обед", "dinner": "Ужин"}

    for meal_key, meal_data in menu.get("meals", {}).items():
        emoji = meal_emojis.get(meal_key, "🍴")
        name = meal_names.get(meal_key, meal_key)
        lines.append(f"{emoji} {name}: {meal_data.get('name', '?')}")
        if meal_data.get("description"):
            lines.append(f"   {meal_data['description']}")

    shopping = menu.get("shopping_needed", [])
    if shopping:
        lines.append(f"\n🛒 Нужно докупить ({len(shopping)} позиции):")
        for item in shopping[:5]:
            lines.append(f"  • {item['name']} — {item['qty']}")
        if len(shopping) > 5:
            lines.append(f"  ... и ещё {len(shopping) - 5}")

    if menu.get("notes"):
        lines.append(f"\n💡 {menu['notes']}")

    return "\n".join(lines)


def get_today_menu() -> dict | None:
    plan = load_json(PLAN_FILE)
    today = date.today().isoformat()
    return plan.get("days", {}).get(today)


def get_recipe(meal_key: str, menu: dict = None) -> str:
    """Get full recipe for a meal"""
    if not menu:
        menu = get_today_menu()
    if not menu:
        return "Меню ещё не составлено"

    meal = menu.get("meals", {}).get(meal_key)
    if not meal:
        return f"Блюдо '{meal_key}' не найдено в меню"

    lines = [f"📖 Рецепт: {meal['name']}\n"]
    if meal.get("description"):
        lines.append(meal["description"] + "\n")

    lines.append("Ингредиенты:")
    for ing in meal.get("ingredients", []):
        status = "✅" if ing.get("in_pantry") else "🛒"
        lines.append(f"  {status} {ing['name']} — {ing.get('qty', '')}")

    lines.append("\nПриготовление:")
    for i, step in enumerate(meal.get("recipe_steps", []), 1):
        lines.append(f"  {i}. {step}")

    return "\n".join(lines)


if __name__ == "__main__":
    config = get_config()
    pantry = get_pantry()

    adjustments = sys.argv[1] if len(sys.argv) > 1 else None

    print("Генерирую меню...")
    menu = generate_daily_menu(pantry, config, adjustments=adjustments)
    update_meal_plan(menu)

    print(format_menu_message(menu))
