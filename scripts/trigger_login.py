import requests
import json
import os

BASE = "https://www.selver.ee"
# Using the ID code provided by the user
ID_CODE = "38511080251"

def trigger_smartid_flow():
    # Simulate initiating the auth request to Selver's backend
    # If this fails because I need a specific session/token first, 
    # the backend will tell me.
    url = f"{BASE}/api/ext/auth/smart-id/init"
    payload = {"idCode": ID_CODE}
    try:
        response = requests.post(url, json=payload, headers={"Content-Type": "application/json"})
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    trigger_smartid_flow()
