import { ImageResponse } from "next/og";
import ShareCard, { CARD_BASE_HEIGHT, CARD_BASE_WIDTH } from "@/components/share/ShareCard";
import { requireAuth } from "@/lib/auth";
import { isShareCardEnabled } from "@/lib/share-card-flag";
import { loadTodayCard } from "@/lib/share/load";
import { parseShareOptions, shareFilename } from "@/lib/share/todayCard";

export const dynamic = "force-dynamic";

const SCALE = 2; // 1080 x 1350 PNG from the 540 x 675 card

// GET /api/share/today[?hide=1][&theme=light] — the signed-in user's own
// snapshot card as a PNG download. Off unless SHARE_CARD=1.
//
// Private by construction: the only user id is `requireAuth`'s, the response
// is `no-store, private`, and there is no token, share id or public URL. The
// card text is ASCII built from numbers and fixed words (see todayCard.ts),
// so Satori renders it with its bundled font and never fetches a fallback
// font or emoji glyph over the network.
export async function GET(req: Request): Promise<Response> {
  // Flag first: when off, nothing below runs — no auth lookup, no DB read.
  if (!isShareCardEnabled()) return Response.json({ error: "not_found" }, { status: 404 });

  let userId: number;
  try {
    ({
      user: { id: userId },
    } = await requireAuth(req));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const url = new URL(req.url);
  const model = loadTodayCard(userId, parseShareOptions({
    hide: url.searchParams.get("hide"),
    theme: url.searchParams.get("theme"),
  }));

  return new ImageResponse(ShareCard({ model, scale: SCALE, forImage: true }), {
    width: CARD_BASE_WIDTH * SCALE,
    height: CARD_BASE_HEIGHT * SCALE,
    headers: {
      "Content-Disposition": `attachment; filename="${shareFilename(model.date)}"`,
      "Cache-Control": "no-store, private",
    },
  });
}
