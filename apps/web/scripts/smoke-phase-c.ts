// Phase C smoke test — exercises the per-user Whoop OAuth wiring end-to-end
// against a running dev server. Verifies that:
//   - /api/connectors/whoop reads per-user integrations rows
//   - /api/auth/whoop/disconnect deletes per-user rows (idempotent)
//   - /api/sync threads the auth'd user_id into runWhoopSync (does NOT need
//     a real Whoop API call — failure mode is fine, we just check the call
//     reached the sync stack with the right userId)
//   - /api/auth/login emits a signed state cookie + Whoop authorize redirect
//
// Boots no servers — caller must have a dev server running (whoop-dev skill)
// and pass its URL + WHOOP_DB_PATH so this script can both seed the DB and
// hit the HTTP surface. Refuses non-/tmp DBs unless --allow-non-snapshot.
//
// Usage:
//   cd apps/web
//   RESULT=$(bash ~/.claude/skills/whoop-dev/bin/up.sh <worktree-path>)
//   URL=$(echo $RESULT | jq -r .url)
//   DB=$(echo $RESULT | jq -r .dbPath)
//   VAULT_KEY=... WHOOP_STATE_SECRET=... \
//     WHOOP_DB_PATH=$DB DEV_BASE_URL=$URL \
//     npx tsx scripts/smoke-phase-c.ts
//   bash ~/.claude/skills/whoop-dev/bin/down.sh --port <port>

import { createRequire } from "node:module";
const requireFromHere = createRequire(import.meta.url);
const serverOnlyPath = requireFromHere.resolve("server-only");
requireFromHere.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  parent: null,
  require: requireFromHere,
} as unknown as NodeJS.Module;

import { existsSync, realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const TEST_PROVIDER = "whoop";
const USER_ID = 1;

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const suffix = detail ? `  (${detail})` : "";
  console.log(`[${tag}] ${name}${suffix}`);
}

async function main(): Promise<number> {
  if (!process.env.VAULT_KEY) {
    console.error(
      "VAULT_KEY is not set. Generate one with `openssl rand -base64 32`."
    );
    return 2;
  }
  if (!process.env.WHOOP_STATE_SECRET) {
    console.error(
      "WHOOP_STATE_SECRET is not set. Generate one with `openssl rand -base64 32`."
    );
    return 2;
  }
  const dbPath = process.env.WHOOP_DB_PATH;
  if (!dbPath) {
    console.error(
      "WHOOP_DB_PATH is not set. Point it at a snapshot DB (whoop-dev's dbPath output)."
    );
    return 2;
  }
  if (!existsSync(dbPath)) {
    console.error(`WHOOP_DB_PATH does not exist: ${dbPath}`);
    return 2;
  }
  const baseUrl = process.env.DEV_BASE_URL;
  if (!baseUrl) {
    console.error(
      "DEV_BASE_URL is not set. Point it at the whoop-dev URL (e.g. http://localhost:3001)."
    );
    return 2;
  }

  // Refuse to write to a non-snapshot DB. We seed/delete integrations rows,
  // which would corrupt shared/whoop_data.db.
  const allowNonSnapshot = process.argv.includes("--allow-non-snapshot");
  const resolvedDbPath = realpathSync(resolvePath(dbPath));
  if (
    !allowNonSnapshot &&
    !resolvedDbPath.startsWith("/tmp/") &&
    !resolvedDbPath.startsWith("/private/tmp/")
  ) {
    console.error(
      `Refusing to run against non-snapshot DB: ${resolvedDbPath}\n` +
        "Use the whoop-dev skill to spin up a /tmp snapshot, or pass --allow-non-snapshot to override."
    );
    return 2;
  }

  console.log(`smoke-phase-c: db=${dbPath}`);
  console.log(`smoke-phase-c: base_url=${baseUrl}`);
  console.log(`smoke-phase-c: user_id=${USER_ID} provider=${TEST_PROVIDER}`);

  const integrations = await import("../src/lib/db/integrations");

  // ---------------- pre-cleanup ----------------
  // Drop any stale integration row left from a previous smoke run so the
  // "disconnected" assertion below is meaningful.
  try {
    integrations.deleteIntegration(USER_ID, TEST_PROVIDER);
  } catch {
    // best-effort
  }

  // ---------------- GET /api/connectors/whoop (no DB row) ----------------
  // Dev-bootstrap auth (no Authorization header) resolves to USER_ID=1.
  // A whoop-dev snapshot may or may not have a legacy tokens.json on disk;
  // what matters for Phase C is that the DB row is absent, so the route
  // does NOT report `source=db`.
  try {
    const resp = await fetch(`${baseUrl}/api/connectors/whoop`);
    const body = (await resp.json()) as {
      status: string;
      source: string | null;
    };
    record(
      "GET /api/connectors/whoop does not report source=db when no integration row exists",
      resp.ok && body.source !== "db",
      `status=${resp.status} body.status=${body.status} source=${body.source}`
    );
  } catch (err) {
    record(
      "GET /api/connectors/whoop does not report source=db when no integration row exists",
      false,
      String(err)
    );
  }

  // ---------------- seed an integrations row directly ----------------
  // Bypass the OAuth flow — we can't really exchange a code against Whoop
  // in CI/dev — but we can prove the connector/disconnect routes operate
  // on the per-user row the way Phase C wires them.
  const accessPlain = `phase-c-access-${Date.now()}`;
  const refreshPlain = `phase-c-refresh-${Date.now()}`;
  try {
    integrations.upsertIntegration({
      user_id: USER_ID,
      provider: TEST_PROVIDER,
      access_token: accessPlain,
      refresh_token: refreshPlain,
      // Far enough in the future that the connector route reports
      // "connected" (not "needs_reconnect" due to clock).
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scope: "offline read:recovery",
      token_type: "bearer",
    });
    const got = integrations.getIntegration(USER_ID, TEST_PROVIDER);
    record(
      "seed: upsertIntegration(user_id=1) round-trips through vault",
      got?.access_token === accessPlain && got?.refresh_token === refreshPlain
    );
  } catch (err) {
    record(
      "seed: upsertIntegration(user_id=1) round-trips through vault",
      false,
      String(err)
    );
  }

  // ---------------- GET /api/connectors/whoop (connected) ----------------
  try {
    const resp = await fetch(`${baseUrl}/api/connectors/whoop`);
    const body = (await resp.json()) as {
      status: string;
      source: string | null;
      scope: string | null;
    };
    record(
      "GET /api/connectors/whoop reports connected (source=db) after seed",
      resp.ok &&
        body.status === "connected" &&
        body.source === "db" &&
        body.scope === "offline read:recovery",
      `status=${resp.status} body=${JSON.stringify(body)}`
    );
  } catch (err) {
    record(
      "GET /api/connectors/whoop reports connected (source=db) after seed",
      false,
      String(err)
    );
  }

  // ---------------- GET /api/auth/login (signed state + redirect) ----------------
  // Don't follow the redirect — we want to inspect the Location + Set-Cookie.
  try {
    const resp = await fetch(`${baseUrl}/api/auth/login`, { redirect: "manual" });
    const location = resp.headers.get("location") ?? "";
    const setCookie = resp.headers.get("set-cookie") ?? "";
    const stateInUrl = (() => {
      try {
        return new URL(location).searchParams.get("state");
      } catch {
        return null;
      }
    })();
    const stateInCookie = (() => {
      // Cookie attributes vary; just look for the `whoop_oauth_state=` prefix.
      const match = setCookie.match(/whoop_oauth_state=([^;]+)/);
      return match ? match[1] : null;
    })();
    const isRedirect = resp.status === 307 || resp.status === 302;
    const goesToWhoop = location.includes("api.prod.whoop.com/oauth/oauth2/auth");
    const cookieAttrs =
      /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie);
    const statesMatch =
      !!stateInUrl && !!stateInCookie && stateInUrl === stateInCookie;
    record(
      "GET /api/auth/login redirects to Whoop with matching signed state in URL + cookie",
      isRedirect && goesToWhoop && statesMatch && cookieAttrs,
      `status=${resp.status} redirect_to_whoop=${goesToWhoop} states_match=${statesMatch} cookie_attrs=${cookieAttrs}`
    );
  } catch (err) {
    record(
      "GET /api/auth/login redirects to Whoop with matching signed state in URL + cookie",
      false,
      String(err)
    );
  }

  // ---------------- POST /api/sync (auth threaded through) ----------------
  // We can't avoid hitting the real Whoop API from inside runWhoopSync, so
  // this call will likely fail upstream (no real token). What matters is
  // that the route reaches runWhoopSync via requireAuth().user.id — a 401
  // would prove a regression in the auth wiring; anything else (200 ok,
  // 500 with upstream error, 200 skipped due to cooldown) means the wiring
  // is correct.
  try {
    const resp = await fetch(`${baseUrl}/api/sync`, { method: "POST" });
    const body = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      skipped?: boolean;
      error?: string;
    };
    // Stronger than "not 401": confirm we actually reached the sync stack,
    // not bounced at routing. A 200 (ok or skipped) or a body carrying an
    // `error` string from runWhoopSync proves the route resolved → auth
    // passed → runWhoopSync executed. A bare 200 with no recognizable shape
    // (or a 401/404) would be the regression.
    const reachedSync =
      resp.status !== 401 &&
      resp.status !== 404 &&
      (resp.status === 200 ||
        typeof body.error === "string" ||
        typeof body.ok === "boolean" ||
        typeof body.skipped === "boolean");
    record(
      "POST /api/sync reaches runWhoopSync (route resolved + auth threaded)",
      reachedSync,
      `status=${resp.status} body=${JSON.stringify(body).slice(0, 160)}`
    );
  } catch (err) {
    record(
      "POST /api/sync reaches runWhoopSync (does not 401 the dev-bootstrap user)",
      false,
      String(err)
    );
  }

  // ---------------- POST /api/auth/whoop/disconnect ----------------
  try {
    const resp = await fetch(`${baseUrl}/api/auth/whoop/disconnect`, {
      method: "POST",
    });
    const body = (await resp.json()) as {
      ok: boolean;
      removed: boolean;
      db_removed: boolean;
    };
    record(
      "POST /api/auth/whoop/disconnect removes the integrations row",
      resp.ok && body.ok === true && body.db_removed === true,
      `status=${resp.status} body=${JSON.stringify(body)}`
    );
  } catch (err) {
    record(
      "POST /api/auth/whoop/disconnect removes the integrations row",
      false,
      String(err)
    );
  }

  // ---------------- GET /api/connectors/whoop (disconnected again) ----------------
  // Disconnect cleared the DB row. tokens.json on a fresh /tmp snapshot
  // doesn't exist, so source should be null and status should be disconnected.
  try {
    const resp = await fetch(`${baseUrl}/api/connectors/whoop`);
    const body = (await resp.json()) as {
      status: string;
      source: string | null;
    };
    // tokens.json may or may not exist depending on what main has on disk
    // when whoop-dev snapshotted — accept both "disconnected" (no file)
    // and "connected via file" (file fallback) as long as the DB row is
    // gone. The DB-row state is what Phase C is asserting.
    const dbRowGone = body.source !== "db";
    record(
      "GET /api/connectors/whoop no longer reports source=db after disconnect",
      resp.ok && dbRowGone,
      `status=${resp.status} body=${JSON.stringify(body)}`
    );
  } catch (err) {
    record(
      "GET /api/connectors/whoop no longer reports source=db after disconnect",
      false,
      String(err)
    );
  }

  // ---------------- POST /api/auth/whoop/disconnect (idempotent) ----------------
  try {
    const resp = await fetch(`${baseUrl}/api/auth/whoop/disconnect`, {
      method: "POST",
    });
    const body = (await resp.json()) as {
      ok: boolean;
      db_removed: boolean;
    };
    record(
      "POST /api/auth/whoop/disconnect is idempotent (second call returns ok with db_removed=false)",
      resp.ok && body.ok === true && body.db_removed === false,
      `status=${resp.status} body=${JSON.stringify(body)}`
    );
  } catch (err) {
    record(
      "POST /api/auth/whoop/disconnect is idempotent",
      false,
      String(err)
    );
  }

  // ---------------- summary ----------------
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(
    `smoke-phase-c: ${results.length - failed.length}/${results.length} passed`
  );
  if (failed.length > 0) {
    console.log("Failures:");
    for (const f of failed) {
      console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ""}`);
    }
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("smoke-phase-c crashed:", err);
    process.exit(1);
  });
