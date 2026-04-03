#!/usr/bin/env python3
"""
Selver.ee authentication via Playwright browser automation.

Flow:
1. Opens headless browser, navigates to selver.ee
2. Clicks "Logi sisse Erakliendina" -> SSO
3. Submits Smart-ID with personal ID code
4. Prints verification code for user to confirm on phone
5. Waits for browser to land on selver.ee logged-in state
6. Extracts Magento customer token from localStorage
7. Saves to data/selver_token.json

Usage:
    python3 selver_auth.py
    python3 selver_auth.py --id-code 38511080251 --timeout 120
"""

import asyncio
import json
import os
import sys
import time
import argparse

try:
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

TOKEN_FILE = os.path.join(os.path.dirname(__file__), "../data/selver_token.json")


async def get_selver_token(id_code: str, timeout: int = 120, headless: bool = True) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
            locale="et-EE",
        )
        page = await ctx.new_page()

        try:
            # Step 1: Navigate to selver.ee
            print("[1/5] Opening selver.ee...")
            await page.goto("https://www.selver.ee", wait_until="domcontentloaded", timeout=30000)

            # Dismiss cookie banner if present
            try:
                await page.click("button:has-text('Luba kõik')", timeout=3000)
            except PlaywrightTimeout:
                pass

            # Step 2: Click login button
            print("[2/5] Opening login dialog...")
            await page.click("button:has-text('Logi sisse e-Selverisse')", timeout=10000)
            await page.click("button:has-text('Erakliendina')", timeout=5000)

            # Step 3: Now on SSO page — submit Smart-ID
            print("[3/5] Submitting Smart-ID...")
            await page.wait_for_selector("input[placeholder='Isikukood']", timeout=15000)
            await page.fill("input[placeholder='Isikukood']", id_code)
            await page.click("button:has-text('Sisene')")

            # Step 4: Get verification code
            print("[4/5] Waiting for verification code...")
            # The 4-digit code appears on the waiting page
            await page.wait_for_selector("text=Veenduge", timeout=10000)

            # Extract verification code from page
            code_el = await page.query_selector(".verification-code, [class*='verif'], strong")
            if code_el:
                code_text = await code_el.inner_text()
                # Find 4-digit number
                import re
                match = re.search(r'\d{4}', code_text)
                code = match.group() if match else "????"
            else:
                # Fallback: get all text and find 4-digit number
                import re
                body = await page.inner_text("body")
                match = re.search(r'\b(\d{4})\b', body)
                code = match.group(1) if match else "????"

            print(f"\n{'='*40}")
            print(f"  Verification code: {code}")
            print(f"  Confirm in Smart-ID on your phone!")
            print(f"{'='*40}\n")
            sys.stdout.flush()

            # Step 5: Wait for redirect back to selver.ee with login complete
            print(f"[5/5] Waiting for confirmation (up to {timeout}s)...")

            deadline = time.time() + timeout
            token = None

            while time.time() < deadline:
                current_url = page.url
                # Check if we're back on selver.ee
                if "selver.ee" in current_url and "sso.partnerkaart" not in current_url:
                    # Check if we need to confirm profile data
                    try:
                        await page.wait_for_selector("button:has-text('Jätka')", timeout=2000)
                        print("  Profile confirmation form — submitting...")
                        await page.click("button:has-text('Jätka')")
                        await page.wait_for_load_state("networkidle", timeout=10000)
                    except PlaywrightTimeout:
                        pass

                    # Try to get token from localStorage
                    try:
                        # VSF stores token in localStorage, typically under shop/user/token
                        # or in the vuex state
                        storage = await page.evaluate("""() => {
                            const result = {};
                            for (let i = 0; i < localStorage.length; i++) {
                                const key = localStorage.key(i);
                                result[key] = localStorage.getItem(key);
                            }
                            return result;
                        }""")

                        def clean_val(val):
                            """Strip JSON-encoded quotes if present."""
                            if val and val.startswith('"') and val.endswith('"'):
                                try:
                                    return json.loads(val)
                                except Exception:
                                    pass
                            return val

                        # Primary: VSF stores auth token under this exact key
                        token_value = clean_val(storage.get("shop/user/current-token"))

                        # Fallback: search all keys
                        if not token_value:
                            for key, val in storage.items():
                                if not val:
                                    continue
                                if key == "shop/user/current-token" or (
                                    "current-token" in key and "refresh" not in key
                                ):
                                    token_value = clean_val(val)
                                    break

                        if token_value:
                            token = token_value
                            cart_token = storage.get("shop/cart/current-cart-token")
                            user_raw = storage.get("shop/user/current-user")
                            user_data = {}
                            if user_raw:
                                try:
                                    user_data = json.loads(user_raw)
                                except Exception:
                                    pass
                            # Collect cookies
                            raw_cookies = await ctx.cookies(["https://www.selver.ee"])
                            cookie_dict = {c["name"]: c["value"] for c in raw_cookies}
                            return {
                                "token": token,
                                "cart_token": cart_token,
                                "cookies": cookie_dict,
                                "user": user_data,
                                "id_code": id_code,
                                "saved_at": int(time.time()),
                            }
                            break

                        # Also check if user is visually logged in
                        try:
                            logged_in = await page.query_selector("text=Tere,")
                            if logged_in:
                                print("  User logged in but token not in localStorage yet, retrying...")
                        except Exception:
                            pass

                    except Exception as e:
                        print(f"  localStorage read error: {e}")

                await asyncio.sleep(2)

            if not token:
                # Last attempt: try cookies
                cookies = await ctx.cookies()
                for c in cookies:
                    if 'token' in c['name'].lower() and len(c['value']) > 20:
                        token = c['value']
                        break

            return {
                "token": token,
                "id_code": id_code,
                "saved_at": int(time.time()),
            }

        finally:
            await browser.close()


def save_token(data: dict):
    os.makedirs(os.path.dirname(os.path.abspath(TOKEN_FILE)), exist_ok=True)
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Token saved to {TOKEN_FILE}")


def main():
    parser = argparse.ArgumentParser(description="Selver.ee browser-based login")
    parser.add_argument("--id-code", default="38511080251", help="Estonian personal ID code")
    parser.add_argument("--timeout", type=int, default=120, help="Seconds to wait for Smart-ID")
    parser.add_argument("--visible", action="store_true", help="Show browser window (non-headless)")
    args = parser.parse_args()

    print("Selver.ee Smart-ID login via browser")
    print(f"Personal ID: {args.id_code}")
    print()

    result = asyncio.run(get_selver_token(
        id_code=args.id_code,
        timeout=args.timeout,
        headless=not args.visible,
    ))

    if result.get("token"):
        save_token(result)
        print()
        print("Authentication successful!")
        print(f"  Token: {result['token'][:40]}...")
        return 0
    else:
        print("\nERROR: Could not extract token after login.", file=sys.stderr)
        print("Token not found in localStorage or cookies.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
