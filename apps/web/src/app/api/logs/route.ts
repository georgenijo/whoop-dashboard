import { getChatLogs, clearChatLogs } from "@/lib/db";

export async function GET() {
  return Response.json(getChatLogs(500));
}

export async function DELETE() {
  clearChatLogs();
  return new Response(null, { status: 204 });
}
