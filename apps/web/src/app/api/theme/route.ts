import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const theme = await req.text();
  const store = await cookies();
  store.set("od-theme", theme === "atelier" ? "atelier" : "classic", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ theme: theme === "atelier" ? "atelier" : "classic" });
}
