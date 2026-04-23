import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const url = buildAuthUrl();
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth configuration error";
    return new NextResponse(message, { status: 500 });
  }
}
