# Environment and deployment

This is the canonical inventory for environment variables and production
deployment. Never paste secret values into this document, an issue, a pull
request, or an Actions log.

## Configuration locations

| Location | Tracked | Purpose |
|---|---:|---|
| `.env.example` | yes | Operator-facing template for the web app |
| `apps/web/.env.local` | no | Canonical local and production web runtime configuration |
| `.env` | no | Root-level scripts and migrations that are explicitly launched with an env loader |
| `systemd/whoop-web.service` | yes | Non-secret process settings (`NODE_ENV` and `PATH`) |
| GitHub `production` environment | no | Deployment identity only; never application runtime secrets |

Next.js loads `apps/web/.env.local` from the app working directory. The
production service starts in that directory. Runtime application secrets stay
on the VM; the GitHub runner only receives a short-lived Tailscale identity and
asks the VM to build from its existing configuration.

## Operator-managed web variables

| Variable | Required when | Consumer |
|---|---|---|
| `WHOOP_CLIENT_ID` | Whoop OAuth or sync is enabled | Whoop OAuth and sync |
| `WHOOP_CLIENT_SECRET` | Whoop OAuth or sync is enabled | Whoop OAuth and sync |
| `WHOOP_STATE_SECRET` | Connect Whoop is enabled | Signed OAuth state |
| `WHOOP_REDIRECT_URI` | Public callback differs from the local default | Whoop OAuth |
| `WHOOP_DB_PATH` | DB is not at `../../shared/whoop_data.db` from `apps/web` | SQLite connection |
| `VAULT_KEY` | Encrypted integrations or BYOK keys are used | Token/key vault |
| `JWT_SIGNING_KEY` | Authenticated web or iOS sessions are used | Session JWTs |
| `ANTHROPIC_API_KEY` | A shared Anthropic fallback is wanted | Coach |
| `CURSOR_API_KEY` | A shared Cursor fallback is wanted | Coach |
| `CURSOR_BACKEND_URL` | Cursor catalog endpoint override is needed | Coach settings |
| `PUBLIC_ORIGIN` | Production runs behind a reverse proxy | Public redirects |
| `ADMIN_APPLE_SUB` | Admin webhook replay is enabled | Admin authorization |
| `LOG_LEVEL` | Default `info`/`debug` behavior is not wanted | Structured logger |
| `COACH_CURSOR_AGENT_BIN` | `cursor-agent` is not on the service `PATH` | Cursor Coach |
| `COACH_DEV_ORIGINS` | A private-host dev preview needs extra allowed origins | Next.js dev server |
| `APPLE_BUNDLE_ID` | Native Sign in with Apple is enabled | iOS identity-token verification |
| `APPLE_SERVICES_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_TEAM_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_KEY_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_PRIVATE_KEY` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_REDIRECT_URI` | Apple callback differs from the derived public origin | Web Apple OAuth |
| `APNS_KEY_ID` | Push delivery is enabled | APNs |
| `APNS_TEAM_ID` | Push delivery is enabled | APNs |
| `APNS_BUNDLE_ID` | Push delivery is enabled | APNs |
| `APNS_PRIVATE_KEY` | Push delivery is enabled | APNs |
| `APNS_ENVIRONMENT` | Push delivery is enabled | APNs |
| `ENABLE_PUSH_DEBUG` | Temporary authenticated push diagnostics are explicitly wanted | Debug route |

`ENABLE_PUSH_DEBUG` must remain unset or `0` in normal production operation.
The complete copyable template and key-generation notes live in
`.env.example`.

## Internal and script-only variables

These are intentionally not operator secrets in `.env.example`:

- `NODE_ENV`, `PATH`, and `HOME` come from systemd/the operating system.
- `COACH_BUILD_SHA` and `COACH_BUILD_TIME` are injected by `next.config.ts`.
- `COACH_MCP_USER_ID` and `COACH_MCP_ATTACHMENT_MANIFEST` are set per Coach
  subprocess by the application.
- `COACH_APP_ROOT`, `COACH_MCP_SERVER_PATH`, `COACH_MCP_COMPILED_PATH`, and
  `COACH_MCP_USE_COMPILED` are development/debug overrides.
- `CANONICAL_EMAIL` is used only by the bootstrap-user migration.
- `DEV_BASE_URL` is used only by the Phase C smoke script.
- `NO_COLOR` is a standard CLI presentation override.

## Value-free inventory taken 2026-07-30

The audit inspected filenames and key names only. It did not print or persist
secret values.

- The working checkout had no local `.env` files, only `.env.example`.
- Before this change, GitHub had no Actions secrets, variables, environments,
  or workflows.
- The VM had `.env`, `apps/web/.env.local`, and a legacy
  `web/.env.local`, plus the tracked `.env.example`.
- The active `whoop-web` service works from `apps/web`, making
  `apps/web/.env.local` the production source of truth.
- `VAULT_KEY`, `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, and `WHOOP_DB_PATH`
  were duplicated consistently across two or more VM files.
- `ANTHROPIC_API_KEY` and `WHOOP_REDIRECT_URI` differed between the active and
  legacy VM files. Treat the legacy copies as stale until each remaining
  script consumer is verified.
- `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` remain in the active VM file but
  no current application code reads them. They are cleanup candidates from the
  retired Cloudflare Access gate.

Do not delete the legacy VM files as part of CI/CD setup. Reconcile them in a
separate operational change after verifying every root-level script that still
loads `.env`.

## CI and production deployment

`.github/workflows/ci.yml` runs `npm ci`, `npm test`, `npm run build`, and a
syntax check of `scripts/deploy` for every pull request and push to `main`.

After verification, a push to `main` deploys only when all of these are true:

1. The `production` GitHub environment approves the job.
2. Repository variable `PRODUCTION_DEPLOY_ENABLED` is exactly `true`.
3. The environment secrets `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE` exist.
4. The ephemeral `tag:ci` runner can reach and Tailscale SSH to
   `tag:production`.

The deploy job is serialized with `cancel-in-progress: false`. It invokes
`scripts/deploy --ref "$GITHUB_SHA"`; the script remains the single deployment
implementation and still owns the SQLite online backup, build, restart, health
verification, and rollback receipt.

### One-time Tailscale setup

Use a Tailscale workload identity federation credential, not an expiring auth
key:

1. In the Tailscale admin console, create `tag:ci` and `tag:production`.
2. Apply `tag:production` to `whoop-vm`.
3. Preserve the existing human SSH rule and add narrowly scoped CI rules to
   the existing policy:

   ```json
   {
     "tagOwners": {
       "tag:ci": [],
       "tag:production": []
     },
     "grants": [
       {
         "src": ["tag:ci"],
         "dst": ["tag:production"],
         "ip": ["tcp:22"]
       }
     ],
     "ssh": [
       {
         "action": "accept",
         "src": ["tag:ci"],
         "dst": ["tag:production"],
         "users": ["george", "ubuntu"]
       },
       {
         "action": "accept",
         "src": ["george.nijo8@gmail.com"],
         "dst": ["tag:production"],
         "users": ["george", "ubuntu"]
       }
     ]
   }
   ```

   Merge these entries into the current HuJSON policy; do not replace unrelated
   grants, SSH rules, tests, or tag owners.
4. Create a GitHub Actions federated identity restricted to this repository,
   with the `auth_keys` scope and `tag:ci`.
5. Copy its client ID and generated audience into the GitHub `production`
   environment as `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`.
6. Run the workflow manually on `main`. After that succeeds, set the repository
   variable `PRODUCTION_DEPLOY_ENABLED=true`.

Official references:

- <https://tailscale.com/docs/integrations/github/github-action>
- <https://tailscale.com/docs/features/workload-identity-federation>
- <https://tailscale.com/docs/features/tailscale-ssh>
- <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>

### Manual fallback

If Actions or Tailscale identity federation is unavailable, run:

```bash
scripts/deploy --ref <full-commit-sha>
```

Use `scripts/deploy --check` for a read-only drift check. Do not duplicate the
deployment sequence as ad hoc SSH commands.
