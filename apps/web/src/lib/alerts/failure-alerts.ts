import "server-only";
import type { DB } from "@/lib/db/connection";
import { listDeviceTokensForUser } from "@/lib/db/devices";
import { forModule } from "@/lib/logger";
import { sendAlertToToken } from "@/lib/push";

/**
 * Sustained-failure detector (issue #444).
 *
 * `/logs` already shows the Coach error rate, but only to someone who opens
 * it — a 9% timeout rate ran for weeks and a dead provider credential was
 * found by accident. This module evaluates three triggers at write time,
 * piggybacking on the `chat_logs` / `sync_logs` inserts that already happen:
 *
 *   - coach_consecutive: the last N=3 Coach turns all failed.
 *   - coach_error_rate:  more than 20% of the last 20 turns failed.
 *   - sync_stale:        no successful full sync in more than 36h. This needs
 *     a periodic tick, and one already exists: the #273 keepalive timer
 *     writes a `sync_logs` row for every tenant every 30 minutes, so the
 *     check rides on `addSyncLog` with no new scheduler.
 *
 * Each (user, kind) pair is an incident persisted in `failure_incidents`. An
 * incident notifies once when it opens and stays silent until it resolves,
 * which re-arms it. The error rate uses hysteresis (opens above 20%, resolves
 * at or below 10%) so a window sitting right at the threshold doesn't flap.
 *
 * Shipped default-off. `COACH_FAILURE_ALERTS`:
 *   unset/other → nothing is evaluated or written.
 *   log         → incidents are tracked and logged (warn, so they land in
 *                 server_logs on /logs). APNs is never called.
 *   push        → as log, plus one APNs alert to the owner's devices
 *                 (`ADMIN_APPLE_SUB` user). With no owner configured it
 *                 fails closed to log-only.
 *
 * Payloads are built only from fixed strings, counts and a closed set of error
 * classes. Raw error messages, prompts, and replies never reach a log line or
 * a push.
 */

const log = forModule("alerts.failure");

export const CONSECUTIVE_FAILURES = 3;
export const RATE_WINDOW = 20;
/** Opens when the failure share of a full window is above this. */
export const RATE_OPEN_THRESHOLD = 0.2;
/** Resolves when the failure share drops to this or below. */
export const RATE_RESOLVE_THRESHOLD = 0.1;
export const SYNC_STALE_MS = 36 * 60 * 60 * 1000;

export type FailureAlertMode = "off" | "log" | "push";
export type IncidentKind = "coach_consecutive" | "coach_error_rate" | "sync_stale";

export function failureAlertMode(): FailureAlertMode {
  const raw = process.env.COACH_FAILURE_ALERTS?.trim().toLowerCase();
  return raw === "log" || raw === "push" ? raw : "off";
}

// ---------------------------------------------------------------------------
// Sanitised error classes
// ---------------------------------------------------------------------------

/** Closed set. Anything that isn't recognised becomes "unclassified error". */
const CAUSE_LABELS = {
  credential_rejected: "provider credential rejected",
  missing_credential: "provider credential missing",
  quota: "provider credits exhausted",
  rate_limited: "provider rate limited",
  overloaded: "provider overloaded",
  timeout: "provider timed out",
  network: "provider unreachable",
  model_unavailable: "model unavailable",
  upstream_error: "provider returned an error",
  whoop_auth: "Whoop credential rejected",
  whoop_rate_limited: "Whoop rate limited",
  whoop_upstream: "Whoop API error",
  unclassified: "unclassified error",
} as const;

export type ErrorClass = keyof typeof CAUSE_LABELS;

/** `error_class` values written by persistence.ts (from classifyChatError). */
const CHAT_REASON_TO_CLASS: Record<string, ErrorClass | "aborted"> = {
  aborted: "aborted",
  invalid_key: "credential_rejected",
  bad_api_key: "credential_rejected",
  missing_key: "missing_credential",
  quota: "quota",
  quota_exceeded: "quota",
  rate_limited: "rate_limited",
  overloaded: "overloaded",
  timeout: "timeout",
  network: "network",
  network_error: "network",
  model_unavailable: "model_unavailable",
  upstream_error: "upstream_error",
  server_error: "unclassified",
};

/**
 * Classify a failed Coach turn. Prefers the structured `error_class` the
 * persistence layer records; falls back to pattern-matching the stored
 * message for older rows. Returns "aborted" for user-cancelled turns, which
 * count as neither success nor failure.
 */
export function classifyChatFailure(
  errorMessage: string | null,
  details: string | null
): ErrorClass | "aborted" {
  if (details) {
    try {
      const parsed = JSON.parse(details) as { error_class?: unknown };
      if (typeof parsed.error_class === "string") {
        const mapped = CHAT_REASON_TO_CLASS[parsed.error_class];
        if (mapped) return mapped;
      }
    } catch {
      // Not JSON — fall through to the message.
    }
  }
  const m = (errorMessage ?? "").toLowerCase();
  if (/\babort/.test(m)) return "aborted";
  if (/credit balance/.test(m)) return "quota";
  if (/api key|credential|unauthori[sz]ed|\b401\b|\b403\b|authenticat|invalid.*key|key.*(rejected|invalid)/.test(m)) {
    return /missing|not configured|no .*key/.test(m) ? "missing_credential" : "credential_rejected";
  }
  if (/missing|not configured/.test(m) && /key/.test(m)) return "missing_credential";
  if (/rate.?limit|\b429\b/.test(m)) return "rate_limited";
  if (/overload|\b529\b/.test(m)) return "overloaded";
  if (/timed? ?out|timeout|etimedout/.test(m)) return "timeout";
  if (/econnrefused|econnreset|enotfound|fetch failed|network|socket hang up/.test(m)) return "network";
  if (/model/.test(m) && /unavailable|not found|not_found|does not exist/.test(m)) return "model_unavailable";
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable/.test(m)) return "upstream_error";
  return "unclassified";
}

export function classifySyncFailure(errorMessage: string | null): ErrorClass {
  const m = (errorMessage ?? "").toLowerCase();
  if (/refresh rejected|reauth|unauthori[sz]ed|\b401\b|\b403\b|invalid_grant|token/.test(m)) return "whoop_auth";
  if (/rate.?limit|\b429\b/.test(m)) return "whoop_rate_limited";
  if (/timed? ?out|timeout|etimedout/.test(m)) return "timeout";
  if (/econnrefused|econnreset|enotfound|fetch failed|network|socket hang up/.test(m)) return "network";
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable/.test(m)) return "whoop_upstream";
  return "unclassified";
}

/** Most frequent class; ties go to whichever was seen most recently. */
function dominantClass(classes: ErrorClass[]): ErrorClass {
  const counts = new Map<ErrorClass, number>();
  for (const c of classes) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: ErrorClass = "unclassified";
  let bestCount = 0;
  for (const c of classes) {
    const n = counts.get(c) ?? 0;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

export function causeLabel(cls: ErrorClass): string {
  return CAUSE_LABELS[cls];
}

// ---------------------------------------------------------------------------
// Incident state
// ---------------------------------------------------------------------------

type IncidentRow = { status: "open" | "resolved"; cause: string | null };

function readIncident(db: DB, userId: number, kind: IncidentKind): IncidentRow | null {
  return (
    (db
      .prepare("SELECT status, cause FROM failure_incidents WHERE user_id = ? AND kind = ?")
      .get(userId, kind) as IncidentRow | undefined) ?? null
  );
}

/**
 * Open the incident if it is not already open. Returns true only for the
 * write that performed the transition, which is what debounces the push to
 * once per incident.
 */
function openIncident(db: DB, userId: number, kind: IncidentKind, cause: string, now: string): boolean {
  const res = db
    .prepare(
      `INSERT INTO failure_incidents (user_id, kind, status, cause, opened_at, resolved_at, notified_at, delivery)
       VALUES (?, ?, 'open', ?, ?, NULL, NULL, NULL)
       ON CONFLICT(user_id, kind) DO UPDATE SET
         status = 'open', cause = excluded.cause, opened_at = excluded.opened_at,
         resolved_at = NULL, notified_at = NULL, delivery = NULL
       WHERE failure_incidents.status != 'open'`
    )
    .run(userId, kind, cause, now);
  return res.changes > 0;
}

function resolveIncident(db: DB, userId: number, kind: IncidentKind, now: string): boolean {
  const res = db
    .prepare(
      "UPDATE failure_incidents SET status = 'resolved', resolved_at = ? WHERE user_id = ? AND kind = ? AND status = 'open'"
    )
    .run(now, userId, kind);
  return res.changes > 0;
}

function recordDelivery(db: DB, userId: number, kind: IncidentKind, delivery: string, now: string): void {
  db.prepare(
    "UPDATE failure_incidents SET delivery = ?, notified_at = ? WHERE user_id = ? AND kind = ?"
  ).run(delivery, now, userId, kind);
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

export type FailureAlert = {
  userId: number;
  kind: IncidentKind;
  title: string;
  body: string;
};

function ownerUserId(db: DB): number | null {
  const sub = process.env.ADMIN_APPLE_SUB?.trim();
  if (!sub) return null;
  const row = db.prepare("SELECT id FROM users WHERE apple_sub = ?").get(sub) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

/** In-flight sends, exposed so tests can await delivery. */
const pending = new Set<Promise<void>>();
export async function flushFailureAlertsForTests(): Promise<void> {
  await Promise.all([...pending]);
}

function notify(db: DB, mode: FailureAlertMode, alert: FailureAlert, now: string): void {
  log.warn(
    { user_id: alert.userId, kind: alert.kind, mode, alert_body: alert.body },
    "failure alert opened"
  );
  if (mode !== "push") {
    recordDelivery(db, alert.userId, alert.kind, "log", now);
    return;
  }
  const owner = ownerUserId(db);
  if (owner === null) {
    log.warn({ kind: alert.kind }, "failure alert: ADMIN_APPLE_SUB owner not found; not pushing");
    recordDelivery(db, alert.userId, alert.kind, "no_owner", now);
    return;
  }
  const tokens = listDeviceTokensForUser(owner);
  if (tokens.length === 0) {
    recordDelivery(db, alert.userId, alert.kind, "no_devices", now);
    return;
  }
  recordDelivery(db, alert.userId, alert.kind, "push", now);
  const body = alert.userId === owner ? alert.body : `${alert.body} (user ${alert.userId})`;
  // Fire-and-forget: the log write must not wait on APNs, and a push failure
  // must never break the request that wrote the log row.
  const p = Promise.all(
    tokens.map((t) =>
      sendAlertToToken(t.token, {
        title: alert.title,
        body,
        custom: { type: "failure_alert", kind: alert.kind },
      }).then(
        (r) => {
          if (!r.ok) log.warn({ kind: alert.kind, status: r.status, reason: r.reason }, "failure alert push rejected");
        },
        (err: unknown) => {
          log.warn(
            { kind: alert.kind, err: err instanceof Error ? err.name : "error" },
            "failure alert push failed"
          );
        }
      )
    )
  ).then(() => undefined);
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

// ---------------------------------------------------------------------------
// Evaluators — each is a no-op when the flag is off and never throws.
// ---------------------------------------------------------------------------

type ChatRow = { status: string; error_message: string | null; details: string | null };

/** Call right after a `chat_logs` insert, on the same write handle. */
export function evaluateCoachFailures(db: DB, userId: number, now = new Date()): void {
  const mode = failureAlertMode();
  if (mode === "off") return;
  try {
    const nowIso = now.toISOString();
    // Over-fetch a little so a few aborted turns don't shrink the window.
    const raw = db
      .prepare(
        "SELECT status, error_message, details FROM chat_logs WHERE user_id = ? AND status IN ('ok', 'error') ORDER BY id DESC LIMIT ?"
      )
      .all(userId, RATE_WINDOW + 10) as ChatRow[];
    const turns: Array<{ ok: boolean; cls: ErrorClass | null }> = [];
    for (const r of raw) {
      if (r.status === "ok") {
        turns.push({ ok: true, cls: null });
      } else {
        const cls = classifyChatFailure(r.error_message, r.details);
        if (cls === "aborted") continue;
        turns.push({ ok: false, cls });
      }
      if (turns.length === RATE_WINDOW) break;
    }
    if (turns.length === 0) return;

    // --- consecutive failures
    const head = turns.slice(0, CONSECUTIVE_FAILURES);
    const consecutiveOpen = readIncident(db, userId, "coach_consecutive")?.status === "open";
    let consecutiveNowOpen = consecutiveOpen;
    if (turns[0].ok) {
      if (resolveIncident(db, userId, "coach_consecutive", nowIso)) {
        log.info({ user_id: userId, kind: "coach_consecutive" }, "failure alert resolved");
      }
      consecutiveNowOpen = false;
    } else if (head.length === CONSECUTIVE_FAILURES && head.every((t) => !t.ok)) {
      const cls = dominantClass(head.map((t) => t.cls as ErrorClass));
      const body = `Coach: ${CONSECUTIVE_FAILURES} consecutive failures — ${causeLabel(cls)}`;
      if (openIncident(db, userId, "coach_consecutive", cls, nowIso)) {
        notify(db, mode, { userId, kind: "coach_consecutive", title: "Coach alert", body }, nowIso);
      }
      consecutiveNowOpen = true;
    }

    // --- rolling error rate (full window only, with hysteresis)
    const failures = turns.filter((t) => !t.ok);
    const rate = failures.length / turns.length;
    const rateOpen = readIncident(db, userId, "coach_error_rate")?.status === "open";
    if (rateOpen) {
      if (rate <= RATE_RESOLVE_THRESHOLD && resolveIncident(db, userId, "coach_error_rate", nowIso)) {
        log.info({ user_id: userId, kind: "coach_error_rate" }, "failure alert resolved");
      }
    } else if (turns.length === RATE_WINDOW && rate > RATE_OPEN_THRESHOLD) {
      const cls = dominantClass(failures.map((t) => t.cls as ErrorClass));
      const body = `Coach: ${failures.length} of last ${RATE_WINDOW} turns failed — mostly ${causeLabel(cls)}`;
      if (openIncident(db, userId, "coach_error_rate", cls, nowIso)) {
        if (consecutiveNowOpen) {
          // Same outage already notified via the consecutive trigger; track
          // the incident but don't push twice for one outage.
          recordDelivery(db, userId, "coach_error_rate", "suppressed", nowIso);
          log.info({ user_id: userId, kind: "coach_error_rate" }, "failure alert opened (covered by consecutive)");
        } else {
          notify(db, mode, { userId, kind: "coach_error_rate", title: "Coach alert", body }, nowIso);
        }
      }
    }
  } catch (err) {
    log.warn({ user_id: userId, err: err instanceof Error ? err.name : "error" }, "coach failure evaluation failed");
  }
}

/**
 * Call right after a `sync_logs` insert. The keepalive timer writes a row per
 * tenant every 30 minutes, which makes this the periodic tick for staleness.
 * The "successful full sync" predicate mirrors `getLastSuccessfulSyncAt`.
 */
export function evaluateSyncStaleness(db: DB, userId: number | null, now = new Date()): void {
  if (userId === null) return;
  const mode = failureAlertMode();
  if (mode === "off") return;
  try {
    const nowIso = now.toISOString();
    const lastOk = db
      .prepare(
        `SELECT id, started_at FROM sync_logs
         WHERE status = 'ok' AND user_id = ?
           AND (source IS NULL OR source NOT IN ('webhook', 'keepalive'))
           AND recovery_count IS NOT NULL AND sleep_count IS NOT NULL AND workouts_count IS NOT NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(userId) as { id: number; started_at: string } | undefined;

    let reference: string;
    if (lastOk) {
      reference = lastOk.started_at;
    } else {
      // Never synced successfully: measure from the tenant's first sync
      // activity so a brand-new account isn't flagged instantly.
      const first = db
        .prepare("SELECT MIN(started_at) AS t FROM sync_logs WHERE user_id = ?")
        .get(userId) as { t: string | null };
      if (!first.t) return;
      reference = first.t;
    }
    const ageMs = now.getTime() - new Date(reference).getTime();
    if (!Number.isFinite(ageMs)) return;

    if (ageMs <= SYNC_STALE_MS) {
      if (resolveIncident(db, userId, "sync_stale", nowIso)) {
        log.info({ user_id: userId, kind: "sync_stale" }, "failure alert resolved");
      }
      return;
    }

    const errors = db
      .prepare(
        `SELECT error_message FROM sync_logs
         WHERE user_id = ? AND status = 'error' AND id > ?
         ORDER BY id DESC LIMIT 10`
      )
      .all(userId, lastOk?.id ?? 0) as Array<{ error_message: string | null }>;
    const hours = Math.floor(ageMs / 3_600_000);
    const subject = lastOk ? `no successful sync in ${hours}h` : `no successful sync since first attempt ${hours}h ago`;
    const cause =
      errors.length > 0
        ? causeLabel(dominantClass(errors.map((e) => classifySyncFailure(e.error_message))))
        : // Only keepalive/webhook rows since the last full sync: nothing
          // failed, nothing ran a full pull (cron or app not calling /api/sync).
          "no full sync attempted";
    if (openIncident(db, userId, "sync_stale", cause, nowIso)) {
      notify(db, mode, { userId, kind: "sync_stale", title: "Coach alert", body: `Sync: ${subject} — ${cause}` }, nowIso);
    }
  } catch (err) {
    log.warn({ user_id: userId, err: err instanceof Error ? err.name : "error" }, "sync staleness evaluation failed");
  }
}
