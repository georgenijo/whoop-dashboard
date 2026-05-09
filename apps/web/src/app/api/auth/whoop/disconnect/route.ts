import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { tokensPath } from "@/lib/auth";
import { deleteIntegration } from "@/lib/db/integrations";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const WHOOP_PROVIDER = "whoop";

/**
 * Remove all Whoop credentials for the signed-in user.
 *
 * Deletes BOTH the encrypted integrations row and the legacy tokens.json
 * file (if present). Either may be missing; that's fine. Idempotent on
 * success — a second call returns the same shape with `removed: false`.
 */
export async function POST(req: Request) {
  const auth = await requireAuth(req);
  let dbRemoved = false;
  let fileRemoved = false;
  let fileError: string | null = null;

  try {
    // `deleteIntegration` returns the rows-affected count. We surface the
    // difference between "row was actually removed" vs "no-op (no row to
    // delete)" so the Settings UI can render an honest result.
    dbRemoved = deleteIntegration(auth.user.id, WHOOP_PROVIDER) > 0;
  } catch (err) {
    // Non-fatal: a missing row + missing file is the same desired end state.
    console.error(
      `[whoop/disconnect] integrations delete failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  try {
    await fs.unlink(tokensPath());
    fileRemoved = true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOENT") {
      fileError = err instanceof Error ? err.message : String(err);
      console.error(`[whoop/disconnect] tokens.json unlink failed: ${fileError}`);
    }
  }

  return NextResponse.json({
    ok: true,
    removed: dbRemoved || fileRemoved,
    db_removed: dbRemoved,
    file_removed: fileRemoved,
    file_error: fileError,
  });
}
