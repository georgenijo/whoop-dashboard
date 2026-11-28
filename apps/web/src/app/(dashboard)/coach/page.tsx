import { headers } from "next/headers";
import CoachWorkspace from "@/components/coach/CoachWorkspace";
import "@/styles/coach.css";
import {
  createChatThread,
  getChatThreadById,
  getChatThreadContext,
  getChatThreadMessages,
  getChatThreads,
  getLatestChatThread,
  getUserSettings,
} from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { getCoachSuggestionContext } from "@/lib/coach/suggestion-context";
import {
  modelPrefForSelection,
  resolveCoachProvider,
  resolveCoachEffort,
} from "@/lib/coach/provider";

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
  const { user } = await requireAuthOrSignin(new Request("http://localhost", { headers: headerList }));
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

  // No redirect to `/coach?thread=N`: a bare `/coach` renders the newest
  // thread directly, and a missing/foreign id falls back to it (the client
  // corrects the address bar). Switching threads after this is client-side,
  // so there is no `key={thread.id}` remount either.
  const threads = getChatThreads(user.id);
  const messages = getChatThreadMessages(user.id, activeThread.id);
  const initialContext = getChatThreadContext(user.id, activeThread.id);
  const initialModelPref = modelPrefForSelection(
    resolveCoachProvider(user.id),
  );
  const initialCoachEffort = resolveCoachEffort(user.id);
  const initialCursorModelParams =
    getUserSettings(user.id)?.cursor_model_params ?? {};
  const suggestionContext = getCoachSuggestionContext(user.id);

  return (
    <CoachWorkspace
      initialThreadId={activeThread.id}
      initialThreads={threads}
      initialMessages={messages}
      initialContext={initialContext}
      initialModelPref={initialModelPref}
      initialCoachEffort={initialCoachEffort}
      initialCursorModelParams={initialCursorModelParams}
      suggestionContext={suggestionContext}
    />
  );
}
