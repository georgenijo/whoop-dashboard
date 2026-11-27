"use client";

import {
  newRunningWorkLog,
  parseCoachWorkLog,
  type CoachToolActivity,
  type CoachWorkLog,
} from "@/lib/coach/work-log-types";
import {
  parseCoachPresentationBlocks,
  type CoachPresentationBlock,
} from "@/lib/coach/presentation";
import { useRouter } from "next/navigation";
import {
  CONNECTION_LOST_MESSAGE,
  CoachRequestError,
  classifyCoachFailure,
  type CoachTurnError,
} from "./chat-errors";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

export type ChatMessageStatus = "complete" | "aborted";
export type ChatAttachment = {
  id: string;
  url: string;
  mime_type: "image/jpeg";
  width: number;
  height: number;
  size_bytes: number;
};

export type ComposerAttachment = {
  id: string;
  url: string;
  mime_type: string;
  width?: number;
  height?: number;
  size_bytes: number;
  pending?: boolean;
};

export type PendingChatImage = {
  id: string;
  file: File;
  previewUrl: string;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  status?: ChatMessageStatus;
  work_log?: CoachWorkLog | null;
  presentation_blocks?: CoachPresentationBlock[];
  attachments: ChatAttachment[];
};

export type ComposerMessage = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: ChatMessageStatus;
  workLog?: CoachWorkLog | null;
  workStartedAt?: number;
  presentationBlocks?: CoachPresentationBlock[];
  attachments?: ComposerAttachment[];
  /** Set when the turn failed; drives the actionable error + Retry. */
  error?: CoachTurnError;
};

type FailedTurn = { text: string; images: PendingChatImage[] };

type UseChatSendParams = {
  initialMessages: ChatMessage[];
  threadId: number;
  setThreadId: Dispatch<SetStateAction<number>>;
  refreshThreads: () => Promise<unknown>;
  setBadApiKey?: (value: boolean) => void;
};

type SendParams = Omit<UseChatSendParams, "initialMessages"> & {
  // Clears the client router cache once a turn has settled (see
  // `sendChatMessage`). Injected so the module-level sender stays hook-free.
  refreshRouter: () => void;
  text: string;
  messages: ComposerMessage[];
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>;
  setInput: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setPreparingImages: Dispatch<SetStateAction<boolean>>;
  pendingImages: PendingChatImage[];
  setPendingImages: (images: PendingChatImage[]) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  abortRef: RefObject<AbortController | null>;
  /**
   * Resending a failed turn: the composer is only cleared if it still holds
   * that draft, and is not refilled if the resend fails too.
   */
  retry?: boolean;
  onTurnFailed: (turn: FailedTurn | null) => void;
};

type ToolStartEvent = { id: string; name: string; input: unknown };
type ToolEndEvent = {
  id: string;
  name: string;
  duration_ms: number | null;
  rows: number | null;
  status: "ok" | "error";
  error?: string;
  response?: unknown;
};
type ToolProgressEvent = {
  id?: string;
  tool: string;
  stage: string;
  message?: string;
};
type StreamHandlers = {
  appendText: (text: string) => void;
  startTool: (event: ToolStartEvent) => void;
  endTool: (event: ToolEndEvent) => void;
  progressTool: (event: ToolProgressEvent) => void;
  done: (
    reply: string,
    workLog: CoachWorkLog | null,
    presentationBlocks: CoachPresentationBlock[],
  ) => void;
  badApiKey?: (event: { origin: string }) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function updateAssistantMessage(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  update: (message: ComposerMessage) => ComposerMessage,
) {
  setMessages((previous) => {
    const current = previous[index];
    if (!current) return previous;
    const next = [...previous];
    next[index] = update(current);
    return next;
  });
}

function appendAssistantText(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  text: string,
) {
  updateAssistantMessage(setMessages, index, (message) => ({
    ...message,
    content: `${message.content}${text}`,
  }));
}

function activeWorkLog(message: ComposerMessage): CoachWorkLog {
  return message.workLog ?? newRunningWorkLog();
}

function startAssistantTool(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  event: ToolStartEvent,
) {
  updateAssistantMessage(setMessages, index, (message) => {
    const workLog = activeWorkLog(message);
    const note = message.content.trim();
    const notes = note ? [...workLog.notes, note] : workLog.notes;
    const tools = workLog.tools.some((tool) => tool.id === event.id)
      ? workLog.tools
      : [
          ...workLog.tools,
          {
            id: event.id,
            name: event.name,
            input: event.input,
            state: "running" as const,
            status: null,
            duration_ms: null,
            rows: null,
          },
        ];
    return {
      ...message,
      content: "",
      workLog: { ...workLog, notes, tools },
    };
  });
}

function findToolIndex(
  tools: CoachToolActivity[],
  id: string | undefined,
  name: string,
): number {
  if (id) {
    const exact = tools.findIndex((tool) => tool.id === id);
    if (exact >= 0) return exact;
  }
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    if (tool.name === name && tool.state === "running") return index;
  }
  return -1;
}

function endAssistantTool(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  event: ToolEndEvent,
) {
  updateAssistantMessage(setMessages, index, (message) => {
    const workLog = activeWorkLog(message);
    const tools = [...workLog.tools];
    const toolIndex = findToolIndex(tools, event.id, event.name);
    const completed: CoachToolActivity = {
      ...(toolIndex >= 0
        ? tools[toolIndex]
        : {
            id: event.id,
            name: event.name,
            input: {},
          }),
      state: "complete",
      status: event.status,
      duration_ms: event.duration_ms,
      rows: event.rows,
      ...(event.error ? { error: event.error } : {}),
      ...(event.response === undefined ? {} : { response: event.response }),
    };
    if (toolIndex >= 0) tools[toolIndex] = completed;
    else tools.push(completed);
    return { ...message, workLog: { ...workLog, tools } };
  });
}

function progressAssistantTool(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  event: ToolProgressEvent,
) {
  updateAssistantMessage(setMessages, index, (message) => {
    const workLog = activeWorkLog(message);
    const tools = [...workLog.tools];
    const toolIndex = findToolIndex(tools, event.id, event.tool);
    if (toolIndex < 0) return message;
    tools[toolIndex] = {
      ...tools[toolIndex],
      stage: event.stage,
      stage_message: event.message,
    };
    return { ...message, workLog: { ...workLog, tools } };
  });
}

function finishAssistant(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  reply: string,
  authoritativeWorkLog: CoachWorkLog | null,
  presentationBlocks: CoachPresentationBlock[],
) {
  updateAssistantMessage(setMessages, index, (message) => ({
    ...message,
    content: reply,
    streaming: false,
    presentationBlocks,
    workLog: authoritativeWorkLog ?? {
      ...activeWorkLog(message),
      status: "complete",
      duration_ms:
        message.workStartedAt == null ? null : Date.now() - message.workStartedAt,
    },
  }));
}

function failAssistant(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  error: CoachTurnError,
) {
  updateAssistantMessage(setMessages, index, (message) => ({
    ...message,
    streaming: false,
    error,
    workLog: {
      ...activeWorkLog(message),
      status: "error",
      duration_ms:
        message.workStartedAt == null ? null : Date.now() - message.workStartedAt,
    },
  }));
}

// The user pressed Stop: keep whatever text already arrived and mark it, the
// same way the server persists the partial reply (`status = 'aborted'`).
function stopAssistant(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
) {
  updateAssistantMessage(setMessages, index, (message) => ({
    ...message,
    streaming: false,
    status: "aborted",
    workLog: {
      ...activeWorkLog(message),
      status: "aborted",
      duration_ms:
        message.workStartedAt == null ? null : Date.now() - message.workStartedAt,
    },
  }));
}

function applyThreadHeader(
  response: Response,
  setThreadId: Dispatch<SetStateAction<number>>,
): number | null {
  const value = response.headers.get("x-thread-id");
  if (!value) return null;
  const nextThreadId = Number(value);
  if (Number.isInteger(nextThreadId) && nextThreadId > 0) {
    setThreadId(nextThreadId);
    return nextThreadId;
  }
  return null;
}

function toComposerMessages(messages: ChatMessage[]): ComposerMessage[] {
  return messages.map((message) => {
    const presentationBlocks = parseCoachPresentationBlocks(message.presentation_blocks);
    return {
      role: message.role,
      content: message.content,
      status: message.status,
      workLog: message.work_log ?? null,
      ...(presentationBlocks.length > 0 ? { presentationBlocks } : {}),
      attachments: message.attachments,
    };
  });
}

function withoutPendingTurn(messages: ComposerMessage[]): ComposerMessage[] {
  const last = messages.at(-1);
  if (!last?.streaming) return messages;
  const withoutAssistant = messages.slice(0, -1);
  return withoutAssistant.at(-1)?.role === "user"
    ? withoutAssistant.slice(0, -1)
    : withoutAssistant;
}

// A failed turn commits nothing server-side, so its user message only exists
// locally. Drop it (with its error reply) before the next send so a resend --
// Retry, or the restored draft sent again -- doesn't show the question twice.
function withoutFailedTurn(messages: ComposerMessage[]): ComposerMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.error) return messages;
  return messages.at(-2)?.role === "user" ? messages.slice(0, -2) : messages.slice(0, -1);
}

async function postMessage(
  userMessage: ComposerMessage,
  images: PendingChatImage[],
  threadId: number,
  signal: AbortSignal,
): Promise<Response> {
  if (images.length > 0) {
    const formData = new FormData();
    formData.set("message", userMessage.content);
    formData.set("thread_id", String(threadId));
    formData.set("days", "9999");
    for (const image of images) {
      formData.append("images", image.file);
    }
    return fetch("/api/chat", {
      method: "POST",
      body: formData,
      signal,
    });
  }

  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: userMessage.role, content: userMessage.content }],
      thread_id: threadId,
      days: 9999,
    }),
    signal,
  });
}

async function refreshPersistedMessages(
  threadId: number,
): Promise<ComposerMessage[] | null> {
  try {
    const response = await fetch(
      `/api/chat/history?thread_id=${encodeURIComponent(threadId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    return toComposerMessages((await response.json()) as ChatMessage[]);
  } catch {
    return null;
  }
}

async function responseError(response: Response): Promise<CoachRequestError> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (isRecord(parsed) && typeof parsed.error === "string") {
      return new CoachRequestError(parsed.error, {
        kind: parsed.kind,
        reason: parsed.reason,
        status: response.status,
      });
    }
  } catch {
    // Plain-text errors remain valid for legacy and infrastructure responses.
  }
  return new CoachRequestError(body || `Server error ${response.status}`, {
    status: response.status,
  });
}

function releasePreviewUrls(images: PendingChatImage[]) {
  for (const image of images) URL.revokeObjectURL(image.previewUrl);
}

function restoreDraftIfEmpty(
  setInput: Dispatch<SetStateAction<string>>,
  draftText: string,
) {
  setInput((current) => (current === "" ? draftText : current));
}

function optimisticAttachments(
  images: PendingChatImage[],
): ComposerAttachment[] {
  return images.map((image) => ({
    id: image.id,
    url: image.previewUrl,
    mime_type: image.file.type,
    size_bytes: image.file.size,
    pending: true,
  }));
}

async function yieldForPreparingState(images: PendingChatImage[]) {
  if (images.length === 0 || typeof requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function parseSsePayload(event: string, data: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(data) as unknown;
    return isRecord(payload) ? payload : {};
  } catch {
    throw new Error(`Invalid Coach stream event: ${event}`);
  }
}

export function workPhaseLabel(
  workLog: CoachWorkLog | null | undefined,
  hasVisibleText = false,
): string | null {
  if (!workLog || workLog.status !== "running") return null;
  const running = [...workLog.tools].reverse().find((tool) => tool.state === "running");
  if (running?.stage_message) return running.stage_message;
  if (running?.stage) return running.stage.replaceAll("_", " ");
  if (running) return `Running ${running.name.replaceAll("_", " ")}…`;
  if (workLog.tools.length > 0) return "Analyzing results…";
  if (hasVisibleText) return "Writing response…";
  return "Thinking…";
}

async function readChatStream(
  response: Response,
  handlers: StreamHandlers,
): Promise<void> {
  if (!response.body) throw new Error("Coach stream did not include a response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let sawDone = false;

  const dispatch = () => {
    const event = eventName;
    const data = dataLines.join("\n");
    eventName = "message";
    dataLines = [];
    if (!data) return;

    const payload = parseSsePayload(event, data);
    if (event === "text_delta") {
      if (typeof payload.text === "string") handlers.appendText(payload.text);
    } else if (event === "tool_use_start" && typeof payload.name === "string") {
      handlers.startTool({
        id:
          typeof payload.id === "string"
            ? payload.id
            : `legacy:${payload.name}:${Date.now()}`,
        name: payload.name,
        input: payload.input ?? {},
      });
    } else if (event === "tool_use_end" && typeof payload.name === "string") {
      handlers.endTool({
        id: typeof payload.id === "string" ? payload.id : "",
        name: payload.name,
        duration_ms:
          typeof payload.duration_ms === "number" ? payload.duration_ms : null,
        rows:
          typeof payload.rows === "number" || payload.rows === null
            ? payload.rows
            : null,
        status: payload.status === "error" ? "error" : "ok",
        ...(typeof payload.error === "string" ? { error: payload.error } : {}),
        ...(Object.hasOwn(payload, "response") ? { response: payload.response } : {}),
      });
    } else if (
      event === "tool_progress" &&
      typeof payload.tool === "string" &&
      typeof payload.stage === "string"
    ) {
      handlers.progressTool({
        ...(typeof payload.id === "string" ? { id: payload.id } : {}),
        tool: payload.tool,
        stage: payload.stage,
        ...(typeof payload.message === "string" ? { message: payload.message } : {}),
      });
    } else if (event === "done") {
      sawDone = true;
      handlers.done(
        typeof payload.reply === "string" ? payload.reply : "",
        parseCoachWorkLog(payload.work_log),
        parseCoachPresentationBlocks(payload.presentation_blocks),
      );
    } else if (event === "error") {
      if (payload.kind === "bad_api_key") {
        handlers.badApiKey?.({
          origin:
            typeof payload.origin === "string" ? payload.origin : "unknown",
        });
        sawDone = true;
      } else {
        throw new CoachRequestError(
          typeof payload.message === "string"
            ? payload.message
            : "Coach stream failed",
          { kind: payload.kind, reason: payload.reason },
        );
      }
    }
  };

  const processLine = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    if (field === "data") dataLines.push(value);
  };

  const consume = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) consume(tail);
    if (buffer) processLine(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!sawDone) throw new Error(CONNECTION_LOST_MESSAGE);
}

async function sendChatMessage(params: SendParams) {
  if (!params.text.trim() && params.pendingImages.length === 0) return;
  if (params.abortRef.current) return;
  params.setBadApiKey?.(false);
  params.onTurnFailed(null);

  const draftText = params.text;
  const draftImages = params.pendingImages;
  const userMessage: ComposerMessage = {
    role: "user",
    content: params.text,
    attachments: optimisticAttachments(draftImages),
  };
  const nextMessages = [
    ...withoutFailedTurn(withoutPendingTurn(params.messages)),
    userMessage,
  ];
  params.setMessages(nextMessages);
  params.setLoading(true);
  params.setPreparingImages(draftImages.length > 0);
  if (params.retry) {
    params.setInput((current) => (current === draftText ? "" : current));
  } else {
    params.setInput("");
  }
  if (params.inputRef.current) params.inputRef.current.style.height = "auto";

  const controller = new AbortController();
  params.abortRef.current = controller;
  const assistantIndex = nextMessages.length;
  const workStartedAt = Date.now();
  params.setMessages((previous) => [
    ...previous,
    {
      role: "assistant",
      content: "",
      streaming: true,
      workLog: newRunningWorkLog(),
      workStartedAt,
    },
  ]);
  const isCurrent = () => params.abortRef.current === controller;
  let badApiKey = false;

  try {
    await yieldForPreparingState(draftImages);
    const response = await postMessage(
      userMessage,
      draftImages,
      params.threadId,
      controller.signal,
    );
    if (!isCurrent()) return;
    params.setPreparingImages(false);
    const responseThreadId =
      applyThreadHeader(response, params.setThreadId) ?? params.threadId;
    if (!response.ok) {
      if (response.status === 401) {
        try {
          const body = (await response.clone().json()) as { kind?: string };
          if (body.kind === "bad_api_key") {
            params.setBadApiKey?.(true);
            params.setMessages((previous) => previous.slice(0, assistantIndex));
            restoreDraftIfEmpty(params.setInput, draftText);
            return;
          }
        } catch {
          // Fall through to the generic error path.
        }
      }
      throw await responseError(response);
    }
    if (!params.retry) params.setPendingImages([]);

    await readChatStream(response, {
      appendText: (text) =>
        appendAssistantText(params.setMessages, assistantIndex, text),
      startTool: (event) =>
        startAssistantTool(params.setMessages, assistantIndex, event),
      endTool: (event) =>
        endAssistantTool(params.setMessages, assistantIndex, event),
      progressTool: (event) =>
        progressAssistantTool(params.setMessages, assistantIndex, event),
      done: (reply, workLog, presentationBlocks) =>
        finishAssistant(
          params.setMessages,
          assistantIndex,
          reply,
          workLog,
          presentationBlocks,
        ),
      badApiKey: () => {
        badApiKey = true;
        params.setBadApiKey?.(true);
      },
    });
    if (!isCurrent()) return;
    if (badApiKey) {
      params.setMessages((previous) => previous.slice(0, assistantIndex));
      restoreDraftIfEmpty(params.setInput, draftText);
      params.setPendingImages(draftImages);
      return;
    }
    if (draftImages.length > 0) {
      const persistedMessages = await refreshPersistedMessages(responseThreadId);
      if (persistedMessages) {
        params.setMessages(persistedMessages);
      } else {
        params.setMessages((previous) =>
          previous.map((message) => ({
            ...message,
            attachments: message.attachments?.filter(
              (attachment) => !attachment.pending,
            ),
          })),
        );
      }
    }
    releasePreviewUrls(draftImages);
    void params.refreshThreads();
  } catch (error) {
    // Only this hook aborts the controller: Stop while current, or a thread
    // switch (which has already replaced `abortRef`). Abort reasons are
    // re-thrown verbatim by fetch/read, so check the signal, not the error.
    if (controller.signal.aborted) {
      releasePreviewUrls(draftImages);
      if (isCurrent()) stopAssistant(params.setMessages, assistantIndex);
      void params.refreshThreads();
      return;
    }
    if (!isCurrent()) return;
    if (!params.retry) {
      restoreDraftIfEmpty(params.setInput, draftText);
      params.setPendingImages(draftImages);
    }
    params.onTurnFailed({ text: draftText, images: draftImages });
    failAssistant(params.setMessages, assistantIndex, classifyCoachFailure(error));
  } finally {
    if (isCurrent()) {
      params.abortRef.current = null;
      params.setLoading(false);
      params.setPreparingImages(false);
      params.inputRef.current?.focus();
    }
    // The turn has settled (completed, failed, or aborted), and the server may
    // have persisted messages either way. `staleTimes.dynamic` caches this
    // page's RSC payload, whose `initialMessages` now predates the turn:
    // navigating away and back would remount with the exchange missing.
    // `router.refresh()` clears the client router cache. It is also safe for
    // live state: the hook ignores same-thread `initialMessages` changes.
    params.refreshRouter();
  }
}

export function useChatSend({
  initialMessages,
  threadId,
  setThreadId,
  refreshThreads,
  setBadApiKey,
}: UseChatSendParams) {
  const router = useRouter();
  const refreshRouter = useCallback(() => router.refresh(), [router]);
  const [messages, setMessages] = useState<ComposerMessage[]>(
    toComposerMessages(initialMessages),
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [preparingImages, setPreparingImages] = useState(false);
  const [pendingImages, setPendingImagesState] = useState<PendingChatImage[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const pendingImagesRef = useRef<PendingChatImage[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const syncedThreadRef = useRef<number | null>(null);
  const failedTurnRef = useRef<FailedTurn | null>(null);
  const rememberFailedTurn = useCallback((turn: FailedTurn | null) => {
    failedTurnRef.current = turn;
  }, []);
  const activeMessage = [...messages]
    .reverse()
    .find((message) => message.streaming && message.role === "assistant");

  const setPendingImages = useCallback((images: PendingChatImage[]) => {
    pendingImagesRef.current = images;
    setPendingImagesState(images);
  }, []);

  const addImages = useCallback(
    (files: File[]) => {
      const supported = files.filter((file) =>
        ["image/jpeg", "image/png", "image/webp"].includes(file.type),
      );
      if (supported.length !== files.length) {
        setAttachmentError("Choose JPEG, PNG, or WebP images.");
        return;
      }
      if (supported.some((file) => file.size > 8 * 1024 * 1024)) {
        setAttachmentError("Each image must be 8 MB or smaller.");
        return;
      }
      const available = 3 - pendingImagesRef.current.length;
      if (available <= 0 || supported.length > available) {
        setAttachmentError("You can attach up to 3 images.");
        return;
      }
      const additions = supported.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setAttachmentError(null);
      setPendingImages([...pendingImagesRef.current, ...additions]);
    },
    [setPendingImages],
  );

  const removeImage = useCallback(
    (id: string) => {
      const image = pendingImagesRef.current.find((item) => item.id === id);
      if (image) URL.revokeObjectURL(image.previewUrl);
      setPendingImages(
        pendingImagesRef.current.filter((item) => item.id !== id),
      );
      setAttachmentError(null);
    },
    [setPendingImages],
  );

  // A server-driven thread change intentionally resets all local composer
  // state in one effect.
  useEffect(() => {
    // Reset only when the thread actually changes. `router.refresh()` after a
    // turn hands this hook a fresh `initialMessages` for the SAME thread; the
    // local state is already authoritative then, and resetting it would wipe
    // the draft, abort a follow-up turn, and flash the transcript.
    if (syncedThreadRef.current === threadId) return;
    syncedThreadRef.current = threadId;
    abortRef.current?.abort();
    abortRef.current = null;
    failedTurnRef.current = null;
    releasePreviewUrls(pendingImagesRef.current);
    setPendingImages([]);
    setMessages(toComposerMessages(initialMessages));
    setInput("");
    setLoading(false);
    setPreparingImages(false);
    setAttachmentError(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [initialMessages, setPendingImages, threadId]);

  useEffect(
    () => () => {
      releasePreviewUrls(pendingImagesRef.current);
      pendingImagesRef.current = [];
    },
    [],
  );

  const send = useCallback(
    (text: string) =>
      sendChatMessage({
        text,
        messages,
        threadId,
        setThreadId,
        setMessages,
        setInput,
        setLoading,
        setPreparingImages,
        pendingImages,
        setPendingImages,
        inputRef,
        abortRef,
        refreshThreads,
        refreshRouter,
        setBadApiKey,
        onTurnFailed: rememberFailedTurn,
      }),
    [
      messages,
      rememberFailedTurn,
      pendingImages,
      refreshRouter,
      refreshThreads,
      setBadApiKey,
      setPendingImages,
      setThreadId,
      threadId,
    ],
  );

  // Stop the streaming reply. Text already received stays, marked stopped.
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Resend the last failed user message. `withoutFailedTurn` drops the failed
  // pair so the resend's optimistic user message replaces it.
  const retry = useCallback(() => {
    const failedTurn = failedTurnRef.current;
    const failed = messages.at(-1);
    if (
      abortRef.current ||
      !failedTurn ||
      failed?.role !== "assistant" ||
      !failed.error ||
      messages.at(-2)?.role !== "user"
    ) {
      return Promise.resolve();
    }
    // The failure restored these images to the composer; they're being sent
    // again, so take them back out (without revoking their preview URLs,
    // which the resent user message still displays).
    if (pendingImagesRef.current === failedTurn.images) setPendingImages([]);
    return sendChatMessage({
      text: failedTurn.text,
      messages,
      threadId,
      setThreadId,
      setMessages,
      setInput,
      setLoading,
      setPreparingImages,
      pendingImages: failedTurn.images,
      setPendingImages,
      inputRef,
      abortRef,
      refreshThreads,
      refreshRouter,
      setBadApiKey,
      onTurnFailed: rememberFailedTurn,
      retry: true,
    });
  }, [
    messages,
    refreshRouter,
    refreshThreads,
    rememberFailedTurn,
    setBadApiKey,
    setPendingImages,
    setThreadId,
    threadId,
  ]);

  return {
    messages,
    input,
    setInput,
    loading,
    preparingImages,
    pendingImages,
    attachmentError,
    addImages,
    removeImage,
    inputRef,
    send,
    stop,
    retry,
    progress: activeMessage?.workLog ?? null,
    progressLabel: workPhaseLabel(
      activeMessage?.workLog,
      Boolean(activeMessage?.content),
    ),
  };
}
