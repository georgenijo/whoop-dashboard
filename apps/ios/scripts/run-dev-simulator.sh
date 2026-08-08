#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SIMULATOR_ID="${1:-}"
DEV_USER_ID="${COACH_DEV_USER_ID:-2}"
FLEET_NODE="${COACH_DEV_FLEET_NODE:-opti}"
PROD_ENV_FILE="${COACH_DEV_ENV_FILE:-/home/george/services/whoop-dashboard/.env.local}"
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
require_command fleet
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

printf 'Minting a Debug-only session for user %s on Fleet node %s...\n' "$DEV_USER_ID" "$FLEET_NODE"
SESSION_TOKEN="$(
  fleet exec "$FLEET_NODE" "python3 - '$DEV_USER_ID' '$PROD_ENV_FILE'" <<'PYTHON'
import base64
import hashlib
import hmac
import json
import pathlib
import re
import sys
import time


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def read_env_value(path: pathlib.Path, key: str) -> str:
    pattern = re.compile(rf"^(?:export\s+)?{re.escape(key)}=(.*)$")
    for raw_line in path.read_text().splitlines():
        match = pattern.match(raw_line.strip())
        if not match:
            continue
        value = match.group(1).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        return value
    raise SystemExit(f"{key} is missing from {path}")


user_id = int(sys.argv[1])
env_path = pathlib.Path(sys.argv[2])
signing_key = read_env_value(env_path, "JWT_SIGNING_KEY")
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
key = base64.b64decode(signing_key, validate=True)
signature = base64url(hmac.new(key, unsigned, hashlib.sha256).digest())
sys.stdout.write(f"{unsigned.decode('ascii')}.{signature}")
PYTHON
)"

if [[ -z "$SESSION_TOKEN" ]]; then
  printf 'Fleet node %s returned an empty session token.\n' "$FLEET_NODE" >&2
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
