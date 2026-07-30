import { requireAuth } from "@/lib/auth";
import {
  CursorModelCatalogError,
  listCursorModelsForKey,
} from "@/lib/coach/cursor-models";
import {
  MissingCursorKeyError,
  resolveCursorKey,
} from "@/lib/coach/cursor-key";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);

    let key: string;
    try {
      key = resolveCursorKey(user.id).key;
    } catch (error) {
      if (error instanceof MissingCursorKeyError) {
        return Response.json({ status: "not_configured", models: [] });
      }
      throw error;
    }

    try {
      const models = await listCursorModelsForKey(key);
      return Response.json({ status: "ready", models });
    } catch (error) {
      if (error instanceof CursorModelCatalogError) {
        return Response.json({ status: error.reason, models: [] });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
