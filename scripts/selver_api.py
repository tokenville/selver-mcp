"""
Selver.ee API Client
Vue Storefront + Magento backend
Index: vue_storefront_catalog_et
"""

import json
import os
import subprocess
import sys
import urllib.parse
import requests

TOKEN_FILE = os.path.join(os.path.dirname(__file__), "../data/selver_token.json")

BASE = "https://www.selver.ee"
INDEX = "vue_storefront_catalog_et"
STORE = "et"

HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

# Known category IDs from Selver catalog
CATEGORIES = {
    "piim_koor": 234,         # Piimad, koored
    "kohupiim": 235,          # Kohupiimad, kodujuustud
    "jogurt": 236,            # Jogurtid
    "munad": 239,             # Munad
    "void_margariinid": 240,  # Võid, margariinid
    "juustud": 243,           # Juustud
    "leivad": 248,            # Leivad
    "sealiha": 219,           # Sealiha
    "kana": 220,              # (likely near 219)
    "kala": 221,              # (likely)
    "salatid": 257,           # Salatid
    "maitseained": 263,       # Maitseained
    "olid": 267,              # Õlid, äädikad
    "kuivained": 9,           # Kuivained, hommikusöögid
    "joogid": 48,             # Veed, mahlad, joogid
    "kulmutatud": 285,        # Külmutatud liha- ja kalatooted
    "konservid": None,        # TBD
}


class SelverAPI:
    def __init__(self, token: str = None):
        self.token = token
        self.cart_token = None
        self.cookies = {}
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def _auth_headers(self) -> dict:
        """Return Authorization + Cookie headers if token/cookies are set."""
        hdrs = {}
        if self.token:
            hdrs["Authorization"] = f"Bearer {self.token}"
        if self.cookies:
            hdrs["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        return hdrs

    def _get(self, path: str, params: dict = None) -> dict:
        """GET with auth header and storeCode."""
        p = {"storeCode": STORE, **(params or {})}
        r = self.session.get(f"{BASE}{path}", params=p, headers=self._auth_headers())
        return r.json()

    def _post(self, path: str, data: dict = None, params: dict = None,
              extra_params: dict = None) -> dict:
        """POST with auth header and storeCode."""
        p = {"storeCode": STORE, **(params or {}), **(extra_params or {})}
        r = self.session.post(f"{BASE}{path}", json=data or {}, params=p, headers=self._auth_headers())
        return r.json()

    # ── AUTH ──────────────────────────────────────────────────────────────────

    def load_token(self) -> bool:
        """Load saved token from file. Returns True if token found."""
        if not os.path.exists(TOKEN_FILE):
            return False
        try:
            with open(TOKEN_FILE) as f:
                data = json.load(f)
            token = data.get("token")
            if token:
                if isinstance(token, str) and token.startswith('"') and token.endswith('"'):
                    token = token[1:-1]
                self.token = token
                self.cart_token = data.get("cart_token")
                self.cookies = data.get("cookies", {})
                return True
        except Exception:
            pass
        return False

    def login_browser(self, id_code: str = "38511080251", timeout: int = 120) -> bool:
        """
        Launch browser-based Smart-ID login flow.
        Prints verification code for user to confirm.
        Saves token to data/selver_token.json.
        Returns True on success.
        """
        script = os.path.join(os.path.dirname(__file__), "selver_auth.py")
        result = subprocess.run(
            [sys.executable, script, "--id-code", id_code, "--timeout", str(timeout)],
            capture_output=False,  # let output print directly
        )
        if result.returncode == 0:
            return self.load_token()
        return False

    def ensure_auth(self, id_code: str = "38511080251") -> bool:
        """Load token from file, or trigger browser login if missing/expired."""
        if self.token:
            return True
        if self.load_token():
            # Quick check if token still valid
            try:
                r = self.session.get(f"{BASE}/api/user/me?token={self.token}", timeout=5)
                if r.status_code == 200 and r.json().get("code") == 200:
                    return True
            except Exception:
                pass
        # Token missing or expired — do browser login
        print("Token missing or expired. Starting browser login...")
        return self.login_browser(id_code=id_code)

    def get_profile(self) -> dict:
        return self._get("/api/user/me")

    # ── CATALOG ───────────────────────────────────────────────────────────────

    def _catalog_search(self, entity: str, query: dict, size: int = 20,
                        from_: int = 0, sort: str = "") -> dict:
        encoded = urllib.parse.quote(json.dumps(query))
        url = (f"{BASE}/api/catalog/{INDEX}/{entity}/_search"
               f"?from={from_}&size={size}&sort={sort}&request={encoded}")
        resp = self.session.get(url)
        return resp.json()

    def search_products(self, text: str = None, category_id: int = None,
                        size: int = 20) -> list:
        """Search products by text (wildcard) and/or category_id"""
        must = [{"terms": {"status": [0, 1]}}]

        if category_id:
            must.append({"terms": {"category_ids": [category_id]}})

        if text:
            # Wildcard search on name - works with Estonian text
            words = text.lower().split()
            for word in words:
                must.append({"wildcard": {"name": f"*{word}*"}})

        query = {"query": {"bool": {"filter": {"bool": {"must": must}}}}}
        result = self._catalog_search("product", query, size=size)
        hits = result.get("hits", {}).get("hits", [])
        return [self._format_product(h["_source"]) for h in hits]

    def get_product_by_sku(self, sku: str) -> dict | None:
        query = {"query": {"bool": {"filter": {"terms": {"sku": [sku]}}}}}
        result = self._catalog_search("product", query, size=1)
        hits = result.get("hits", {}).get("hits", [])
        if hits:
            return self._format_product(hits[0]["_source"])
        return None

    def get_categories(self, level: int = 4) -> list:
        query = {
            "query": {
                "bool": {
                    "filter": {
                        "bool": {
                            "must": [
                                {"terms": {"level": [level]}},
                                {"terms": {"is_active": [True]}},
                            ]
                        }
                    }
                }
            }
        }
        result = self._catalog_search("category", query, size=200, sort="position:asc")
        hits = result.get("hits", {}).get("hits", [])
        return [
            {
                "id": h["_source"]["id"],
                "name": h["_source"]["name"],
                "url_path": h["_source"].get("url_path"),
            }
            for h in hits
        ]

    def _format_product(self, src: dict) -> dict:
        stock = src.get("stock", {})
        return {
            "sku": src.get("sku"),
            "name": src.get("name"),
            "price": round(src.get("price", 0), 2),
            "special_price": src.get("special_price"),
            "unit": src.get("product_sales_unit"),
            "brand": src.get("product_brand"),
            "category_ids": src.get("category_ids", []),
            "product_id": stock.get("product_id"),
            "stock_status": stock.get("stock_status"),  # 1 = available
        }

    # ── CART ──────────────────────────────────────────────────────────────────

    def create_cart(self) -> str:
        """Create a new cart, returns cart quote ID"""
        result = self._post("/api/cart/create")
        cart_id = result.get("result")
        if cart_id:
            self.cart_token = str(cart_id)
        return cart_id

    def get_cart(self, cart_id: str = None) -> dict:
        cart_id = cart_id or self.cart_token
        return self._get("/api/cart/pull", {"cartId": cart_id})

    def add_to_cart(self, sku: str, qty: float = 1.0, product_id: int = None,
                    cart_id: str = None) -> dict:
        cart_id = cart_id or self.cart_token
        item = {"sku": sku, "qty": qty}
        if product_id:
            item["product_id"] = product_id
        return self._post(
            "/api/ext/tkg-sales/cart/add-cart-items",
            {"cartId": cart_id, "cartItems": [item]},
        )

    def add_multiple_to_cart(self, items: list, cart_id: str = None) -> dict:
        """items: [{"sku": "...", "qty": 1, "product_id": ...}, ...]"""
        cart_id = cart_id or self.cart_token
        return self._post(
            "/api/ext/tkg-sales/cart/add-cart-items",
            {"cartId": cart_id, "cartItems": items},
        )

    def clear_cart(self, cart_id: str = None) -> dict:
        cart_id = cart_id or self.cart_token
        return self._post(
            "/api/ext/tkg-sales/cart/truncate",
            {"cartId": cart_id},
        )

    def get_cart_totals(self, cart_id: str = None) -> dict:
        cart_id = cart_id or self.cart_token
        return self._get("/api/cart/totals", {"cartId": cart_id})

    def get_shipping_methods(self, address: dict, cart_id: str = None) -> dict:
        cart_id = cart_id or self.cart_token
        return self._post(
            "/api/cart/shipping-methods",
            {"cartId": cart_id, "address": address},
        )

    # ── TIMESLOTS ─────────────────────────────────────────────────────────────

    # Delivery method ID for courier (Tellin kauba kulleriga)
    DELIVERY_METHOD_ID = 419

    def validate_postcode(self, postcode: str) -> dict:
        return self._get(f"/api/ext/timeslot/is-postcode-valid/{postcode}")

    def get_timeslot_reservation(self, cart_id: str = None) -> dict:
        """Get current active timeslot reservation."""
        cart_id = cart_id or self.cart_token
        return self._get("/api/ext/timeslot/get-reservation", {"cartId": cart_id})

    def get_available_timeslots(self, method_id: int = None, cart_id: str = None) -> dict:
        """
        Get available delivery timeslots.
        Returns: {days: [...], times: [...], slots: [{id, date, time, label, enabled}, ...]}
        Only slots with enabled=True are available for booking.
        """
        method_id = method_id or self.DELIVERY_METHOD_ID
        cart_id = cart_id or self.cart_token
        return self._get(f"/api/ext/timeslot/get-method-data/{method_id}/0",
                         {"cartId": cart_id})

    def reserve_timeslot(self, timeslot_id: int, date: str,
                         email: str = None, telephone: str = None,
                         cart_id: str = None) -> dict:
        """
        Reserve a delivery timeslot.
        timeslot_id: slot id from get_available_timeslots()
        date: "YYYY-MM-DD"
        Returns reservation info with expired_at timestamp (45 min window).
        """
        cart_id = cart_id or self.cart_token
        body = {
            "timeslotId": timeslot_id,
            "date": date,
            "stationId": "",
            "email": email or "",
            "telephone": telephone or "",
        }
        r = self.session.post(
            f"{BASE}/api/ext/timeslot/reserve",
            json=body,
            params={"cartId": cart_id, "storeCode": STORE},
            headers=self._auth_headers(),
        )
        return r.json()

    def delete_timeslot_reservation(self, cart_id: str = None) -> dict:
        """Cancel current timeslot reservation."""
        cart_id = cart_id or self.cart_token
        r = self.session.post(
            f"{BASE}/api/ext/timeslot/delete",
            json={},
            params={"cartId": cart_id, "storeCode": STORE},
            headers=self._auth_headers(),
        )
        return r.json()

    def get_shipping_methods_for_address(self, address: dict = None,
                                          cart_id: str = None) -> list:
        """
        Get available shipping methods for given address.
        Default address is Ivan's home (Eha 3, Taebla).
        Returns list of {carrier_code, method_code, method_title, price_incl_tax}.
        """
        if address is None:
            address = {
                "region": "Laane maakond", "region_id": 0, "country_id": "EE",
                "street": ["Eha tanav 3", "Taebla"], "city": "Taebla",
                "postcode": "90801", "firstname": "Ivan", "lastname": "Sokolov",
                "email": "0959741@gmail.com", "telephone": "37259025467",
                "extension_attributes": {},
            }
        cart_id = cart_id or self.cart_token
        result = self._post("/api/cart/shipping-methods",
                            {"address": address},
                            params={"cartId": cart_id})
        return result.get("result", []) if result.get("code") == 200 else []


if __name__ == "__main__":
    api = SelverAPI()
    print("Testing product search...")
    products = api.search_products(text="täispiim", size=5)
    for p in products:
        print(f"  {p['name']} | {p['sku']} | {p['price']}€")
    print(f"\nFound {len(products)} products\n")

    print("Category 234 (Piimad):")
    products = api.search_products(category_id=234, size=5)
    for p in products:
        print(f"  {p['name']} | {p['price']}€")
