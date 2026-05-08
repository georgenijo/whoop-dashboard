#!/usr/bin/env bash
# Whoop Dashboard VM deploy.
# Run as the `george` user on the VM. Caller (ubuntu) restarts whoop-web.
set -euo pipefail

cd "$(dirname "$0")/.."

step() { echo "[deploy] $1"; }
elapsed() { local t=$(($(date +%s) - $1)); printf "%ds" "$t"; }

t_total=$(date +%s)

t0=$(date +%s)
step "git pull"
git pull --ff-only origin main
step "git pull done in $(elapsed $t0)"

cd apps/web

t1=$(date +%s)
if [[ -f node_modules/.package-lock.json ]] && cmp -s package-lock.json node_modules/.package-lock.json; then
  step "deps unchanged — skipping install"
else
  step "deps changed — running npm ci"
  npm ci --prefer-offline --no-audit --no-fund
  step "npm ci done in $(elapsed $t1)"
fi

t2=$(date +%s)
step "next build"
npm run build
step "build done in $(elapsed $t2)"

step "ready in $(elapsed $t_total) — caller should: sudo systemctl restart whoop-web"
