"""
Daily Menu Cron — runs every evening, generates tomorrow's menu
and sends it via Hermes to Telegram
"""

import json
import sys
import os
from pathlib import Path
from datetime import date, timedelta

# Add scripts dir to path
sys.path.insert(0, str(Path(__file__).parent))

from meal_planner import (
    generate_daily_menu, update_meal_plan, format_menu_message,
    get_config, get_pantry
)


def main():
    config = get_config()
    pantry = get_pantry()

    # Generate for tomorrow
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    print(f"Генерирую меню на {tomorrow}...")
    menu = generate_daily_menu(pantry, config, date_str=tomorrow)
    update_meal_plan(menu)

    message = format_menu_message(menu)
    print(message)

    # Return message for cron delivery
    return message


if __name__ == "__main__":
    result = main()
    # Cron will capture stdout and deliver to Telegram
    print("\n---\nГотово! Меню сохранено.")
