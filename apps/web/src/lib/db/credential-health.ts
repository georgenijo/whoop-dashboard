import "server-only";
import { hasTable, openWrite, safeQuery } from "./connection";

// Issue #525 — persisted health of server-side credentials. The table is
// bootstrapped lazily in openWrite() (connection.ts). Rows carry a status
// and timestamps only; callers must never pass key material in `detail`.

export type CredentialHealthStatus = "ok" | "invalid" | "unreachable";

export type CredentialHealthRow = {
  credential: string;
  status: CredentialHealthStatus;
  last_checked: string;
  last_ok: string | null;
  consecutive_invalid: number;
  incident_open: boolean;
  detail: string | null;
};

type RawRow = Omit<CredentialHealthRow, "incident_open"> & {
  incident_open: number;
};

function fromRaw(row: RawRow | undefined): CredentialHealthRow | null {
  if (!row) return null;
  return { ...row, incident_open: row.incident_open === 1 };
}

export function getCredentialHealth(
  credential: string,
): CredentialHealthRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "credential_health")) return null;
    return fromRaw(
      db
        .prepare(
          `SELECT credential, status, last_checked, last_ok,
                  consecutive_invalid, incident_open, detail
             FROM credential_health WHERE credential = ?`,
        )
        .get(credential) as RawRow | undefined,
    );
  });
}

export function saveCredentialHealth(row: CredentialHealthRow): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO credential_health
       (credential, status, last_checked, last_ok, consecutive_invalid, incident_open, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(credential) DO UPDATE SET
       status = excluded.status,
       last_checked = excluded.last_checked,
       last_ok = excluded.last_ok,
       consecutive_invalid = excluded.consecutive_invalid,
       incident_open = excluded.incident_open,
       detail = excluded.detail`,
    ).run(
      row.credential,
      row.status,
      row.last_checked,
      row.last_ok,
      row.consecutive_invalid,
      row.incident_open ? 1 : 0,
      row.detail,
    );
  } finally {
    db.close();
  }
}
