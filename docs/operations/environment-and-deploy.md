# Environment and deployment

This is the canonical production runbook. Production runs on Fleet node
`opti`; the retired Oracle host `whoop-vm` was decommissioned 2026-08-10 and
is not part of the deploy path (see the legacy appendix at the end of this
document). Never paste secret values into this document, an issue, a pull
request, or a command log.

## Production topology

```text
coach.georgenijo.com ─┐   Cloudflare Access-gated
                      ├─ Cloudflare Tunnel `opti-murmur` ─> opti:127.0.0.1:8501
coach-api.georgenijo.com ─┘   bearer-only, no Access        │
                                                             ├─ Next.js web + API
                                                             ├─ Cursor Agent
                                                             └─ SQLite (local WAL file)
```

- Fleet name: `opti` (Linux Mint, tailnet `opti`, 100.82.135.53 —
  informational only, do not hard-code it into scripts or commands).
- Runtime user: `george`, with passwordless sudo. `whoop-web` is a **system**
  systemd unit (`/etc/systemd/system/whoop-web.service`), not a user unit —
  operations need `sudo` on `opti`.
- Build/runtime Node: NVM `20.20.2` for a stable native-module ABI — pinned
  in the repo root `.nvmrc`, which CI also reads via `node-version-file`
  (issue #500).
- Public ingress: a single shared, box-level Cloudflare Tunnel named
  `opti-murmur` (`dac9359e-51bd-4ad9-8389-dd510127c04e`), configured at
  `/etc/cloudflared/config.yml` and run by the system `cloudflared.service`.
  It also fronts other services on `opti` (e.g. the Murmur log receiver) —
  it is not whoop-dashboard's own tunnel. No nginx, no certbot, no public IP.
- `coach.georgenijo.com` is gated by Cloudflare Access (george.nijo8@gmail.com)
  with a path-scoped bypass app for the Whoop webhook endpoint.
  `coach-api.georgenijo.com` stays bearer-only, with no Access policy.
- `ufw` is default-deny on `opti`; the tailnet is fully trusted, with
  LAN-scoped allows only for unrelated services (Home Assistant, go2rtc).
- GitHub Actions: CI only. Production deploys are operator-triggered.

## Production filesystem

```text
/home/george/Documents/whoop-dashboard/
├── .git                          in-place production checkout (also the deploy source)
├── apps/web                      Next.js app (WorkingDirectory for whoop-web.service)
│   └── .env.local                canonical application secrets (mode 0600)
└── shared/whoop_data.db          canonical SQLite database
```

Production deploys directly in this checkout — there is no separate
`releases/`/`current` symlink tree and no isolated build worktree. The JWT
signing key is not part of `.env.local`; it is injected via a root-owned, mode-600
systemd drop-in at `/etc/systemd/system/whoop-web.service.d/override.conf`,
kept out of this repository.

## Configuration locations

| Location | Tracked | Purpose |
|---|---:|---|
| `.env.example` | yes | Operator-facing application template |
| `/home/george/Documents/whoop-dashboard/apps/web/.env.local` | no | Canonical production application configuration loaded by Next.js |
| `/etc/systemd/system/whoop-web.service.d/override.conf` | no | JWT signing key drop-in (root-owned, mode 600, not in repo) |
| `/etc/cloudflared/config.yml` | no | Shared box-level tunnel config (not whoop-dashboard-specific, not in repo) |
| `systemd/whoop-web.service` | yes | Reference copy of the deployed system unit |
| `systemd/whoop-cloudflared.service` | yes | Historical — superseded by the shared system `cloudflared.service`; not currently deployed |

## Application variables

| Variable | Required when | Consumer |
|---|---|---|
| `WHOOP_CLIENT_ID` | Whoop OAuth or sync is enabled | OAuth and sync |
| `WHOOP_CLIENT_SECRET` | Whoop OAuth or sync is enabled | OAuth and sync |
| `WHOOP_STATE_SECRET` | Connect Whoop is enabled | Signed OAuth state |
| `WHOOP_REDIRECT_URI` | Callback differs from the public default | Whoop OAuth |
| `VAULT_KEY` | Encrypted integrations or BYOK keys are used | Token/key vault |
| `JWT_SIGNING_KEY` | Authenticated web or iOS sessions are used | Session JWTs |
| `ANTHROPIC_API_KEY` | Shared Anthropic fallback is wanted | Coach |
| `CURSOR_API_KEY` | Shared Cursor fallback is wanted | Coach |
| `COACH_CURSOR_AGENT_BIN` | Cursor models are enabled | Absolute Cursor Agent launcher path |
| `CURSOR_BACKEND_URL` | Cursor catalog override is needed | Coach settings |
| `PUBLIC_ORIGIN` | Production redirects are generated | Web auth |
| `ADMIN_APPLE_SUB` | Admin webhook replay is enabled | Admin authorization |
| `LOG_LEVEL` | Default logging is not wanted | Structured logger |
| `APPLE_BUNDLE_ID` | Native Sign in with Apple is enabled | iOS identity verification |
| `APPLE_SERVICES_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_TEAM_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_KEY_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_PRIVATE_KEY` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_REDIRECT_URI` | Apple callback differs from derived origin | Web Apple OAuth |
| `APNS_KEY_ID` | Push delivery is enabled | APNs |
| `APNS_TEAM_ID` | Push delivery is enabled | APNs |
| `APNS_BUNDLE_ID` | Push delivery is enabled | APNs |
| `APNS_PRIVATE_KEY` | Push delivery is enabled | APNs |
| `APNS_ENVIRONMENT` | Push delivery is enabled | APNs |
| `ENABLE_PUSH_DEBUG` | Temporary push diagnostics are explicitly wanted | Debug route |

`ENABLE_PUSH_DEBUG` must remain unset or `0` during normal production.

## Normal deployment

Install Cursor Agent once as the runtime user before enabling Cursor models:

```bash
fleet exec opti 'curl https://cursor.com/install -fsS | bash'
fleet exec opti '/home/george/.local/bin/cursor-agent --version'
```

Keep `COACH_CURSOR_AGENT_BIN=/home/george/.local/bin/cursor-agent` in
`apps/web/.env.local`. `scripts/deploy` is the canonical release path. Before
building or restarting, it runs the launcher under the same minimal PATH used
by Coach; a missing binary or an auto-updated launcher that needs a new shell
tool aborts the deploy while the existing service remains running. The canary
checks the standardized launcher path (overridable with
`DEPLOY_CURSOR_AGENT_BIN`); it does not load or validate application variables
or provider credentials from `.env.local`.

```bash
scripts/deploy --check
scripts/deploy
```

Verify real state directly when diagnosing production:

```bash
fleet exec opti 'sudo systemctl status whoop-web --no-pager'
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && git log -1'
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && ~/.nvm/versions/node/v20.20.2/bin/node scripts/check-cursor-agent.mjs ~/.local/bin/cursor-agent'
curl -fsS https://coach-api.georgenijo.com/api/health
```

No production secret or database is copied into GitHub or a release
directory.

### Concurrent deploys

`scripts/deploy` takes an on-box lock (a directory, `/tmp/whoop-deploy.lock`
by default, overridable with `DEPLOY_LOCK_DIR`) on opti for the snapshot,
sync, install, build and restart phases — the resource being protected is
opti's checkout, not the operator's machine, so two operators on two
different laptops correctly contend for the same lock (issue #469).
`scripts/deploy --check` is read-only and never takes it.

A second deploy started while one is already running fails immediately with:

```
FAILED: another deploy is already running on opti
   holder pid:  <sentinel pid>
   started:     <UTC timestamp>
   ...
```

This is not a queue — the second invocation exits, it does not wait. Re-run
it once the first deploy finishes.

If the named holder is confirmed dead (the box crashed mid-deploy, or the
holder was `kill -9`'d) but the message reappears rather than self-healing,
clear the lock by hand:

```bash
fleet exec opti 'kill <pid> 2>/dev/null; rm -rf /tmp/whoop-deploy.lock'
```

One case deliberately does **not** self-heal automatically and does **not**
release on exit: if a detached `npm ci` or `next build` hits its poll
ceiling, or the poller detects an orphaned holder of the build's own
`.next` lock, `scripts/deploy` leaves the on-box lock HELD rather than
released, because the mutating step may genuinely still be writing to the
checkout — releasing would let a second deploy `reset --hard` and `npm ci`
underneath it. The failure message says the lock was left held and repeats
the same manual-clear recipe; only run it once you have actually confirmed
on opti that nothing is still running (`fleet exec opti 'pgrep -af "next
build|npm ci"'`).

## Operations

```bash
# Status
fleet exec opti 'sudo systemctl status whoop-web cloudflared --no-pager'

# Logs
fleet exec opti 'sudo journalctl -u whoop-web -n 100 --no-pager'
fleet exec opti 'sudo journalctl -u cloudflared -n 100 --no-pager'

# Restart
fleet exec opti 'sudo systemctl restart whoop-web'
```

Rollback application code by resetting the checkout to the previous full SHA,
rebuilding, and restarting:

```bash
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && git reset --hard <previous-full-sha>'
fleet exec opti 'sudo systemctl restart whoop-web'
```

Database restoration is deliberately manual because it discards writes made
after the selected backup. Stop the web service, move the current DB and WAL
sidecars aside, install a verified backup, then start and smoke-test. Never
restore a database file while `whoop-web` is running.

## CI

`.github/workflows/ci.yml` runs `npm ci`, tests, and the production build for
pull requests and pushes to `main`. CI does not possess Fleet, Cloudflare,
application-secret, or database credentials and does not deploy production.

## Legacy: `whoop-vm` (decommissioned)

Production ran on an Oracle Cloud VM (`whoop-vm`, two-user SSH access,
nginx + certbot, public IP) until it was fully migrated to `opti` on
2026-08-10. All production data, secrets, and traffic now live on `opti`;
`whoop-vm`'s services are stopped and disabled, and the VM is powered off
pending termination. A final archive of the VM's state (database, env,
configs) is retained at `opti:/home/george/archives/whoop-vm-2026-08-10/`.
`infra/terraform/` still describes the retired VM for historical/audit
reference only — never `terraform apply` it against production.

The detailed migration procedure that was originally planned for this cutover
(a `releases/`/`current` symlink deploy under `/home/george/services/`,
user-level systemd, a dedicated `whoop-dashboard-opti` tunnel) is not
reproduced here because it does not match how the migration actually landed —
see "Normal deployment" above for the real, current layout. It is not needed
for any future operation.
