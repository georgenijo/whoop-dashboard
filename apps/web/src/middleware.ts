import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const ts = new Date().toISOString();
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 60);
  console.log(
    `[req] ${ts} ${req.method} ${req.nextUrl.pathname}${req.nextUrl.search} ua="${ua}"`
  );
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
