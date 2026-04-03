#!/usr/bin/env python3
"""
Selver.ee / Partnerkaart Smart-ID authentication script.

Flow:
1. Start Keycloak session with partnerkaart client
2. POST Smart-ID initiation with personal ID code
3. Show verification code to user (confirm on phone)
4. Poll until authenticated (submitting hidden form fields)
5. Exchange code for token and save to data/auth_token.json

Usage:
    python3 smartid_auth.py
    python3 smartid_auth.py --id-code 38511080251
"""

import requests
import re
import json
import time
import argparse
import sys
import os

BASE_SSO = "https://sso.partnerkaart.ee/auth/realms/partner"
CLIENT_ID = "partnerkaart"
REDIRECT_URI = "https://www.partnerkaart.ee/iseteenindus/"
TOKEN_FILE = os.path.join(os.path.dirname(__file__), "../data/auth_token.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
}


def extract_form(html, form_id=None, form_index=0):
    """Extract form action and all hidden/input fields from HTML."""
    if form_id:
        pattern = rf'<form[^>]*id="{form_id}"[^>]*>(.*?)</form>'
    else:
        pattern = r'<form[^>]*>(.*?)</form>'

    forms = re.findall(pattern, html, re.DOTALL)
    form_tags = re.findall(r'<form([^>]*)>', html)

    if not forms:
        return None, {}

    idx = min(form_index, len(forms) - 1)
    form_body = forms[idx]
    form_tag = form_tags[idx] if idx < len(form_tags) else ""

    # Get action from form tag
    action_match = re.search(r'action="([^"]+)"', form_tag)
    action = action_match.group(1).replace("&amp;", "&") if action_match else None

    # Get all input fields
    fields = {}
    for inp in re.findall(r'<input([^>]+)>', form_body):
        name = re.search(r'name="([^"]+)"', inp)
        val = re.search(r'value="([^"]*)"', inp)
        if name:
            fields[name.group(1)] = val.group(1) if val else ""

    return action, fields


def start_session():
    """Start Keycloak auth flow, return (session, form_action_url)."""
    s = requests.Session()
    s.headers.update(HEADERS)

    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "response_mode": "fragment",
        "scope": "openid",
    }
    r = s.get(f"{BASE_SSO}/protocol/openid-connect/auth", params=params)
    r.raise_for_status()

    action, _ = extract_form(r.text)
    if not action:
        raise RuntimeError("Could not find form action in login page")

    return s, action


def initiate_smartid(session, action_url, id_code):
    """POST Smart-ID auth, return (verification_code, poll_form_data, poll_url)."""
    r = session.post(
        action_url,
        data={"authMethod": "SMART_ID", "personalNo": id_code},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    r.raise_for_status()

    # Find the Smart-ID polling form (form 0)
    # It has hidden fields: authMethod, verificationCode, isCancelled, smartIdSessionId
    forms = re.findall(r'<form([^>]*)>(.*?)</form>', r.text, re.DOTALL)

    poll_action = None
    poll_fields = {}

    for form_tag, form_body in forms:
        fields = {}
        for inp in re.findall(r'<input([^>]+)>', form_body):
            name = re.search(r'name="([^"]+)"', inp)
            val = re.search(r'value="([^"]*)"', inp)
            if name:
                fields[name.group(1)] = val.group(1) if val else ""

        if fields.get("authMethod") == "SMART_ID" and "smartIdSessionId" in fields:
            action_match = re.search(r'action="([^"]+)"', form_tag)
            if not action_match:
                # action might be on the form tag itself
                # try to find it in the outer context
                pass
            poll_fields = fields
            break

    # Get the form action URL — find any form action on sso.partnerkaart.ee
    # (the SMART_ID form action contains the session_code parameter)
    action_match = re.search(r'action="(https://sso\.partnerkaart\.ee[^"]+)"', r.text)
    if action_match:
        poll_action = action_match.group(1).replace("&amp;", "&")
    else:
        raise RuntimeError("Could not find poll form action URL")

    if not poll_action or not poll_fields:
        raise RuntimeError("Could not parse Smart-ID polling form")

    code = poll_fields.get("verificationCode", "????")
    return code, poll_action, poll_fields


def poll_for_result(session, poll_url, poll_fields, timeout=120):
    """
    Poll SSO every 2s with Smart-ID form fields.
    Returns the redirect Location URL with auth code.
    """
    deadline = time.time() + timeout

    attempt = 0
    while time.time() < deadline:
        attempt += 1
        # Follow all redirects — final URL will contain #code= on partnerkaart.ee
        r = session.post(
            poll_url,
            data=poll_fields,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            allow_redirects=True,
        )

        final_url = r.url
        print(f"  [{attempt}] status={r.status_code} url={final_url[:60]}...", flush=True)

        # Success: landed on www.partnerkaart.ee with auth code (not session_code)
        if "www.partnerkaart.ee" in final_url and re.search(r'[#?&]code=', final_url):
            return final_url

        # Check via redirect history (code may appear in Location header fragment)
        for hist in r.history:
            loc = hist.headers.get("Location", "")
            if "www.partnerkaart.ee" in loc and re.search(r'[#?&]code=', loc):
                return loc

        # Check for explicit cancellation
        if re.search(r'(tühistat|USER_CANCEL|SESSION_EXPIRED|authentication.*failed)', r.text, re.I):
            body = re.sub(r'<[^>]+>', ' ', r.text)
            raise RuntimeError(f"Auth failed: {' '.join(body.split())[:200]}")

        # Update poll_url and poll_fields from the response page (session_code changes each poll)
        new_action = re.search(r'action="(https://sso\.partnerkaart\.ee[^"]+)"', r.text)
        if new_action:
            poll_url = new_action.group(1).replace("&amp;", "&")
        for form_tag, form_body in re.findall(r'<form([^>]*)>(.*?)</form>', r.text, re.DOTALL):
            fields = {}
            for inp in re.findall(r'<input([^>]+)>', form_body):
                name = re.search(r'name="([^"]+)"', inp)
                val = re.search(r'value="([^"]*)"', inp)
                if name:
                    fields[name.group(1)] = val.group(1) if val else ""
            if fields.get("authMethod") == "SMART_ID" and "smartIdSessionId" in fields:
                poll_fields.update(fields)
                break

        time.sleep(2)

    raise TimeoutError(f"Smart-ID timed out after {timeout}s")


def exchange_code_for_token(session, redirect_url):
    """Exchange auth code for access token via token endpoint."""
    # Code can be in query param or fragment: both #code= and &code= patterns
    code_match = re.search(r'[#?&]code=([^&\s#]+)', redirect_url)
    if not code_match:
        raise RuntimeError(f"No auth code found in redirect URL: {redirect_url[:120]}")

    auth_code = code_match.group(1)
    r = session.post(
        f"{BASE_SSO}/protocol/openid-connect/token",
        data={
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "code": auth_code,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    r.raise_for_status()
    return r.json()


def save_token(token_data):
    os.makedirs(os.path.dirname(os.path.abspath(TOKEN_FILE)), exist_ok=True)
    token_data["saved_at"] = int(time.time())
    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)
    print(f"Token saved to {TOKEN_FILE}")


def main():
    parser = argparse.ArgumentParser(description="Selver.ee Smart-ID login")
    parser.add_argument("--id-code", default="38511080251", help="Estonian personal ID code")
    parser.add_argument("--timeout", type=int, default=180, help="Seconds to wait for Smart-ID")
    args = parser.parse_args()

    print("Selver / Partnerkaart — Smart-ID login")
    print(f"Personal ID: {args.id_code}")

    try:
        print("\n[1/4] Starting Keycloak session...")
        session, action_url = start_session()

        print("[2/4] Sending Smart-ID auth request...")
        verif_code, poll_url, poll_fields = initiate_smartid(session, action_url, args.id_code)

        print(f"\n{'='*40}")
        print(f"  Verification code: {verif_code}")
        print(f"  Open Smart-ID on phone and confirm!")
        print(f"{'='*40}\n")
        sys.stdout.flush()

        print(f"[3/4] Polling for confirmation (up to {args.timeout}s)...")
        sys.stdout.flush()
        redirect_url = poll_for_result(session, poll_url, poll_fields, timeout=args.timeout)
        print(f"  Got redirect: {redirect_url[:80]}")

        print("[4/4] Exchanging auth code for token...")
        try:
            token = exchange_code_for_token(session, redirect_url)
            save_token(token)
            print("\nAuthentication successful!")
            print(f"  Access token: {token.get('access_token','')[:40]}...")
            print(f"  Expires in: {token.get('expires_in')}s")
            print(f"  Refresh token: {'yes' if token.get('refresh_token') else 'no'}")
        except RuntimeError as e:
            # Fragment redirect — save raw redirect URL for manual handling
            print(f"\nNote: {e}")
            os.makedirs(os.path.dirname(os.path.abspath(TOKEN_FILE)), exist_ok=True)
            with open(TOKEN_FILE.replace(".json", "_redirect.txt"), "w") as f:
                f.write(redirect_url)
            print(f"Redirect URL saved for further processing.")

        return 0

    except TimeoutError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
