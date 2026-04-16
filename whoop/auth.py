import json
import os
import secrets
import string
import threading
import time
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv

load_dotenv()

AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
SCOPES = "offline read:profile read:recovery read:cycles read:sleep read:workout read:body_measurement"
TOKEN_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tokens.json")

_refresh_lock = threading.Lock()


def _generate_state() -> str:
    chars = string.ascii_letters + string.digits
    return "".join(secrets.choice(chars) for _ in range(8))


def build_auth_url(client_id: str, redirect_uri: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": _generate_state(),
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str, redirect_uri: str) -> dict:
    client_id = os.getenv("WHOOP_CLIENT_ID")
    client_secret = os.getenv("WHOOP_CLIENT_SECRET")
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    resp.raise_for_status()
    token_data = resp.json()
    token_data["expires_at"] = time.time() + token_data.get("expires_in", 3600)
    save_tokens(token_data)
    return token_data


def load_tokens() -> dict | None:
    try:
        with open(TOKEN_FILE) as f:
            data = json.load(f)
        if "access_token" not in data or "refresh_token" not in data:
            return None
        return data
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return None


def save_tokens(data: dict) -> None:
    tmp = TOKEN_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, TOKEN_FILE)


def is_expired(data: dict) -> bool:
    return time.time() > data.get("expires_at", 0) - 60


def refresh_tokens(data: dict) -> dict | None:
    client_id = os.getenv("WHOOP_CLIENT_ID")
    client_secret = os.getenv("WHOOP_CLIENT_SECRET")
    try:
        resp = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": data["refresh_token"],
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        resp.raise_for_status()
        token_data = resp.json()
        token_data["expires_at"] = time.time() + token_data.get("expires_in", 3600)
        save_tokens(token_data)
        return token_data
    except requests.exceptions.HTTPError:
        clear_tokens()
        return None


def clear_tokens() -> None:
    try:
        os.remove(TOKEN_FILE)
    except FileNotFoundError:
        pass


def get_valid_token() -> str | None:
    with _refresh_lock:
        data = load_tokens()
        if data is None:
            return None
        if is_expired(data):
            data = refresh_tokens(data)
            if data is None:
                return None
        return data["access_token"]
