#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SIMULATOR_ID="${1:-}"
DEV_USER_ID="${COACH_DEV_USER_ID:-2}"
VM_HOST="${COACH_DEV_VM_HOST:-ubuntu@whoop-vm}"
API_URL="${COACH_API_URL:-https://coach-api.georgenijo.com}"
BUNDLE_ID="com.georgenijo.coach"
DERIVED_DATA_PATH="${COACH_DERIVED_DATA_PATH:-/tmp/coach-dev-derived}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_command curl
require_command tailscale
require_command xcodebuild
require_command xcodegen
require_command xcrun

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This launcher must run on the Mac that owns the iOS Simulator.\n' >&2
  exit 1
fi

if [[ -z "$SIMULATOR_ID" ]]; then
  SIMULATOR_ID="$({
    xcrun simctl list devices booted
  } | awk -F '[()]' '/\(Booted\)/ { print $2; exit }')"
fi

if [[ -z "$SIMULATOR_ID" ]]; then
  printf 'No booted iOS Simulator found. Boot one or pass its UDID.\n' >&2
  exit 1
fi

printf 'Minting a Debug-only session for user %s on %s...\n' "$DEV_USER_ID" "$VM_HOST"
SESSION_TOKEN="$(
  tailscale ssh "$VM_HOST" "bash -s -- '$DEV_USER_ID'" <<'VM_SCRIPT'
set -euo pipefail

user_id="$1"
environment="$({ sudo systemctl show whoop-web -p Environment --value; } 2>/dev/null)"
signing_key="$(printf '%s\n' "$environment" | tr ' ' '\n' | sed -n 's/^JWT_SIGNING_KEY=//p' | head -1)"

if [[ -z "$signing_key" ]]; then
  printf 'JWT_SIGNING_KEY is missing from whoop-web.service\n' >&2
  exit 1
fi

JWT_SIGNING_KEY="$signing_key" python3 - "$user_id" <<'PYTHON'
import base64
import hashlib
import hmac
import json
import os
import sys
import time


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


user_id = int(sys.argv[1])
now = int(time.time())
header = base64url(json.dumps({"alg": "HS256"}, separators=(",", ":")).encode())
payload = base64url(
    json.dumps(
        {
            "sub": str(user_id),
            "iss": "coach-api",
            "iat": now,
            "exp": now + (30 * 24 * 60 * 60),
        },
        separators=(",", ":"),
    ).encode()
)
unsigned = f"{header}.{payload}".encode("ascii")
key = base64.b64decode(os.environ["JWT_SIGNING_KEY"], validate=True)
signature = base64url(hmac.new(key, unsigned, hashlib.sha256).digest())
sys.stdout.write(f"{unsigned.decode('ascii')}.{signature}")
PYTHON
VM_SCRIPT
)"

if [[ -z "$SESSION_TOKEN" ]]; then
  printf 'The production VM returned an empty session token.\n' >&2
  exit 1
fi

http_status="$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --header "Authorization: Bearer $SESSION_TOKEN" \
    "$API_URL/api/settings"
)"
if [[ "$http_status" != "200" ]]; then
  unset SESSION_TOKEN
  printf 'The minted session was rejected by %s (HTTP %s).\n' "$API_URL" "$http_status" >&2
  exit 1
fi

printf 'Building and installing the signed Debug app on %s...\n' "$SIMULATOR_ID"
cd "$IOS_DIR"
xcodegen generate
xcodebuild \
  -quiet \
  -project Coach.xcodeproj \
  -scheme Coach \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  build

APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug-iphonesimulator/Coach.app"
xcrun simctl install "$SIMULATOR_ID" "$APP_PATH"
SIMCTL_CHILD_COACH_DEBUG_TOKEN="$SESSION_TOKEN" \
  xcrun simctl launch --terminate-running-process "$SIMULATOR_ID" "$BUNDLE_ID" >/dev/null
unset SESSION_TOKEN

printf 'Coach launched with Debug authentication bypassed.\n'
