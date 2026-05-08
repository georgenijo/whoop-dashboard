import { headers } from "next/headers";
import { redirect } from "next/navigation";
import CoachWorkspace from "@/components/coach/CoachWorkspace";
import {
  createChatThread,
  getChatThreadById,
  getChatThreadMessages,
  getChatThreads,
  getLatestChatThread,
} from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

function parseThreadId(value: string | string[] | undefined): number | null {
  if (value === undefined) return null;
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number(candidate);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string | string[] }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuth(new Request("http://localhost", { headers: headerList }));
  const { thread } = await searchParams;
  const requestedThreadId = parseThreadId(thread);

  let activeThread =
    requestedThreadId != null
      ? getChatThreadById(user.id, requestedThreadId)
      : getLatestChatThread(user.id);

  if (!activeThread && requestedThreadId != null) {
    activeThread = getLatestChatThread(user.id);
  }

  if (!activeThread) {
    activeThread = createChatThread(user.id);
  }

  if (!activeThread) {
    throw new Error("Unable to create or load a chat thread");
  }

  if (requestedThreadId !== activeThread.id) {
    redirect(`/coach?thread=${activeThread.id}`);
  }

  const threads = getChatThreads(user.id);
  const messages = getChatThreadMessages(user.id, activeThread.id);

  return (
    <CoachWorkspace
      key={activeThread.id}
      initialThreadId={activeThread.id}
      initialThreads={threads}
      initialMessages={messages}
    />
  );
}
