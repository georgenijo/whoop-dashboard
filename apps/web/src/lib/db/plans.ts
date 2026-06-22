import "server-only";
import { openWrite } from "./connection";
import { forUser } from "./scoped";

// ---------------------------------------------------------------------------
// Issue #421 — workout_plans (Coach-authored, recovery-tuned plans).
//
// SHARED CONTRACT (web + iOS both consume it — see docs/plans-contract.md).
// Keep these types in lockstep with that doc and the iOS decoder.
// ---------------------------------------------------------------------------

export type Intensity = "hard" | "moderate" | "reduced" | "rest";

export interface PlanExercise {
  name: string;
  scheme: string;
  note?: string;
}

export interface PlanDay {
  name: string;
  focus?: string;
  intensity: Intensity;
  exercises: PlanExercise[];
}

export interface PlanStructure {
  days: PlanDay[];
  why?: string;
}

export interface PlanRecoveryContext {
  recovery_score?: number;
  hrv_trend_pct?: number;
  note?: string;
}

export interface WorkoutPlan {
  id: number;
  title: string;
  tag?: string;
  description?: string;
  created_by: "coach" | "user";
  is_active: boolean;
  plan: PlanStructure;
  recovery_context?: PlanRecoveryContext;
  created_at: string; // ISO-8601 UTC
  updated_at: string; // ISO-8601 UTC
}

/** Input accepted by `saveWorkoutPlan`. Already validated/normalized by the
 *  caller (the coach tool validates the raw model input before this point). */
export interface SaveWorkoutPlanInput {
  title: string;
  tag?: string;
  description?: string;
  plan: PlanStructure;
  recovery_context?: PlanRecoveryContext;
  /** When true, deactivate the user's other plans and mark this one active. */
  make_active?: boolean;
  /** Defaults to "coach" — every author today is the Coach write tool. */
  created_by?: "coach" | "user";
}

type WorkoutPlanRow = {
  id: number;
  title: string;
  tag: string | null;
  description: string | null;
  created_by: string;
  is_active: number;
  plan_json: string;
  recovery_context: string | null;
  created_at: string;
  updated_at: string;
};

const PLAN_COLUMNS =
  "id, title, tag, description, created_by, is_active, plan_json, recovery_context, created_at, updated_at";

function parseJsonOrNull<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function rowToPlan(row: WorkoutPlanRow): WorkoutPlan {
  const plan = parseJsonOrNull<PlanStructure>(row.plan_json) ?? { days: [] };
  const recovery = parseJsonOrNull<PlanRecoveryContext>(row.recovery_context);
  return {
    id: row.id,
    title: row.title,
    ...(row.tag != null ? { tag: row.tag } : {}),
    ...(row.description != null ? { description: row.description } : {}),
    created_by: row.created_by === "user" ? "user" : "coach",
    is_active: row.is_active === 1,
    plan,
    ...(recovery ? { recovery_context: recovery } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * All plans for a user. Active first, then `updated_at` descending — matching
 * the GET /api/plans contract. Tenant-scoped via `forUser(userId)` with
 * `user_id = ?` as the trailing placeholder.
 */
export function getWorkoutPlans(userId: number): WorkoutPlan[] {
  const rows = forUser(userId).all<WorkoutPlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM workout_plans
       WHERE user_id = ?
       ORDER BY is_active DESC, updated_at DESC, id DESC`,
  );
  return rows.map(rowToPlan);
}

/**
 * Insert a new plan for `userId`. When `make_active` is set, flips
 * `is_active = 0` on the user's other plans inside the SAME transaction
 * (mirrors `addChatMessages` — `db.transaction(fn)` so a failure leaves the DB
 * untouched). created_at / updated_at are stamped server-side as ISO-8601 UTC.
 * Returns the stored WorkoutPlan. Returns null only when the DB file is absent.
 */
export function saveWorkoutPlan(
  userId: number,
  input: SaveWorkoutPlanInput,
): WorkoutPlan | null {
  const db = openWrite();
  if (!db) return null;
  try {
    const now = new Date().toISOString();
    const createdBy = input.created_by === "user" ? "user" : "coach";
    const isActive = input.make_active ? 1 : 0;
    const planJson = JSON.stringify(input.plan);
    const recoveryJson = input.recovery_context
      ? JSON.stringify(input.recovery_context)
      : null;

    const deactivateOthers = db.prepare(
      "UPDATE workout_plans SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1",
    );
    const insert = db.prepare(
      `INSERT INTO workout_plans
         (user_id, title, tag, description, created_by, is_active, plan_json, recovery_context, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const write = db.transaction((): number => {
      if (isActive === 1) {
        deactivateOthers.run(now, userId);
      }
      const result = insert.run(
        userId,
        input.title,
        input.tag ?? null,
        input.description ?? null,
        createdBy,
        isActive,
        planJson,
        recoveryJson,
        now,
        now,
      );
      return Number(result.lastInsertRowid);
    });

    const id = write();

    return {
      id,
      title: input.title,
      ...(input.tag != null ? { tag: input.tag } : {}),
      ...(input.description != null ? { description: input.description } : {}),
      created_by: createdBy,
      is_active: isActive === 1,
      plan: input.plan,
      ...(input.recovery_context ? { recovery_context: input.recovery_context } : {}),
      created_at: now,
      updated_at: now,
    };
  } finally {
    db.close();
  }
}
