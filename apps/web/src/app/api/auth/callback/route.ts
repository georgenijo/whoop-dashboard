import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return new NextResponse(`Whoop OAuth error: ${error}`, { status: 400 });
  }
  if (!code) {
    return new NextResponse("Missing authorization code", { status: 400 });
  }

  try {
    await exchangeCode(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return new NextResponse(message, { status: 500 });
  }

  return NextResponse.redirect(
    new URL("/settings?reconnected=1", req.nextUrl.origin)
  );
}
