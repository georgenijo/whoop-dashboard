# Frame Morning brief publisher

This bridge reads one explicitly bound account from the existing SQLite store
and sends a short-lived v1 summary to a private Home Assistant webhook. It does
not expose a dashboard endpoint, write the database, decrypt OAuth credentials,
or call WHOOP. Home Assistant receives `{ "brief": PAYLOAD }`; no health files
are written under `/local`, and the CLI never prints the payload or webhook URL.

## Private configuration

Create `/etc/frame-morning-publisher.env` outside the repository, owned by
`root:root` and mode `0600`. A system service manager reads `EnvironmentFile=`
before dropping to `User=george`, so the publisher process does not need direct
file access. Use placeholders here; never put actual values in the unit,
repository, shell history, issue, or pull request.

```dotenv
FRAME_MORNING_HA_WEBHOOK_URL=http://127.0.0.1:8123/api/webhook/<private-webhook-id>
FRAME_MORNING_USER_ID=<positive-users.id>
FRAME_MORNING_ACCOUNT_SUBJECT=<exact-stable-users.apple_sub>
```

`FRAME_MORNING_HA_WEBHOOK_URL` must use literal `127.0.0.1` or `[::1]`, plain
HTTP, and the `/api/webhook/<id>` path. Redirects, credentials, query strings,
fragments, hostnames such as `localhost`, and non-loopback addresses are
rejected.

The local ID alone is never sufficient. Configure exactly one additional
binding:

- `FRAME_MORNING_ACCOUNT_SUBJECT`: exact stable `users.apple_sub`; or
- `FRAME_MORNING_EMAIL_SHA256`: 64 lowercase hexadecimal characters containing
  SHA-256 of the account email after `trim().toLowerCase()` normalization.

The configured ID and binding must resolve uniquely to the same user. The
publisher also requires that user's IANA `users.timezone` and one active WHOOP
integration with a populated provider user ID. Missing/deleted accounts,
binding mismatches, removed integrations, `needs_reauth=1`, schema drift, and
database failures produce an all-null `unavailable` brief and a nonzero exit.
OAuth token columns are not selected.

If the webhook destination is valid but account configuration is missing or
invalid, the CLI immediately sends `unavailable` before exiting nonzero. If the
healthy publish itself fails, it makes one best-effort `unavailable` attempt.
The HTTP request times out after 10 seconds and never follows redirects. The
systemd service has a 25-second outer bound.

## Install the example timer

The tracked units are examples and are not installed by `scripts/deploy`.
After privately provisioning the environment file, an operator can copy the
two units from `systemd/` into `/etc/systemd/system/`, run `systemctl
daemon-reload`, and enable `frame-morning-publisher.timer`. Those are explicit
deployment actions and are intentionally outside this implementation.

The timer runs every three minutes. Each brief expires ten minutes after its
publisher heartbeat, so a stopped publisher, broken webhook, or disconnected
frame fails closed after the expiry window.

For a one-shot local verification from `apps/web`, using the same private
environment without printing it:

```bash
npm run frame:morning:publish
```

Success exits zero. A source, configuration, or HTTP failure exits nonzero.

## Freshness boundary

This publisher only reads records already stored by the application. It adds
no provider polling and does not make a WHOOP request.

The active ingestion paths are application/manual seven-day syncs plus signed
WHOOP webhooks for supported resources. The existing
`whoop-web-refresh.timer` runs every 30 minutes, but it is only an OAuth
refresh-token keepalive; it does not fetch health records. Recovery, sleep, and
workout webhooks can update those resources between syncs. WHOOP does not send
cycle webhooks, so cycle strain and native cycle steps can remain at the last
application sync. The retired Python daily sync is not an active freshness
source. The payload reports each metric's data date and marks prior data within
seven days as `stale`; older data is omitted as `missing`.

WHOOP cycle steps are preferred for the requested date, then current Apple
Health steps, then the most recent single provider within seven days. Providers
are never summed. An open WHOOP cycle is marked partial. This does not promise
live or background iPhone step delivery.
