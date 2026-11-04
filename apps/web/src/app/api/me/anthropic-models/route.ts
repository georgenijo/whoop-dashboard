import { requireAuth } from "@/lib/auth";
import { MissingApiKeyError, resolveApiKeyForUser } from "@/lib/coach/api-key";
import {
  AnthropicModelCatalogError,
  listAnthropicModelsForKey,
} from "@/lib/coach/anthropic-models";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    try {
      const { key } = resolveApiKeyForUser(user.id);
      const models = await listAnthropicModelsForKey(key);
      return Response.json({ status: "ready", models }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      if (error instanceof MissingApiKeyError || error instanceof AnthropicModelCatalogError) {
        return Response.json({
          status: error instanceof MissingApiKeyError ? "not_configured" : error.reason,
          models: [],
        }, { headers: { "Cache-Control": "private, no-store" } });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
