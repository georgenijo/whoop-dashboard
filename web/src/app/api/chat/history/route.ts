import { getChatMessages, clearChatMessages } from "@/lib/db";

export async function GET() {
  return Response.json(getChatMessages());
}

export async function DELETE() {
  clearChatMessages();
  return new Response(null, { status: 204 });
}
