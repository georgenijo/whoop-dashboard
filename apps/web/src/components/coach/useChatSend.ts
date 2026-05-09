"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

export type ChatMessage = { id: number; role: "user" | "assistant"; content: string; created_at: string };
export type ToolProgress = {
  name: string;
  state: "running" | "done";
  /** Mid-tool progress sub-state (e.g. "fetching_sleep" for trigger_whoop_sync). */
  stage?: string;
  stageMessage?: string;
  duration_ms?: number;
  rows?: number | null;
  status?: "ok" | "error";
};
export type ComposerMessage = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  progress?: ToolProgress | null;
};

type UseChatSendParams = { initialMessages: ChatMessage[]; threadId: number; setThreadId: Dispatch<SetStateAction<number>>; refreshThreads: () => Promise<unknown> };

type SendParams = Omit<UseChatSendParams, "initialMessages"> & { text: string; messages: ComposerMessage[]; setMessages: Dispatch<SetStateAction<ComposerMessage[]>>; setInput: Dispatch<SetStateAction<string>>; setLoading: Dispatch<SetStateAction<boolean>>; inputRef: RefObject<HTMLTextAreaElement | null>; abortRef: RefObject<AbortController | null> };
type StreamHandlers = {
  appendText: (text: string) => void;
  setProgress: (progress: ToolProgress | null) => void;
  mergeProgressStage: (event: { tool: string; stage: string; message?: string }) => void;
};

function setAssistantMessage(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  content: string
) {
  setMessages((prev) => {
    const updated = [...prev];
    updated[index] = { role: "assistant", content };
    return updated;
  });
}

function updateAssistantMessage(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  update: (message: ComposerMessage) => ComposerMessage
) {
  setMessages((prev) => {
    const current = prev[index];
    if (!current) return prev;
    const updated = [...prev];
    updated[index] = update(current);
    return updated;
  });
}

function appendAssistantText(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  text: string
) {
  updateAssistantMessage(setMessages, index, (message) => ({
    ...message,
    content: `${message.content}${text}`,
    progress: null,
  }));
}

function setAssistantProgress(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  progress: ToolProgress | null
) {
  updateAssistantMessage(setMessages, index, (message) => ({
    ...message,
    progress,
  }));
}

function mergeAssistantProgressStage(
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>,
  index: number,
  event: { tool: string; stage: string; message?: string }
) {
  updateAssistantMessage(setMessages, index, (message) => {
    const cur = message.progress;
    // Merge rule:
    //  - same tool (or no current progress) → preserve everything, only
    //    overwrite stage / stageMessage. Keeps `state: "running"` from the
    //    earlier `tool_use_start`.
    //  - different tool (or no current name match) → start a fresh
    //    running record with stage; clears stale duration/rows/status.
    //    Today the producer only emits `tool_progress` for the running
    //    tool, so this branch should be unreachable; warn so a producer
    //    bug surfaces instead of silently re-mounting state.
    if (!cur || cur.name !== event.tool) {
      if (cur) {
        console.warn("[useChatSend] tool_progress for non-current tool", {
          current: cur.name,
          received: event.tool,
        });
      }
      return {
        ...message,
        progress: {
          name: event.tool,
          state: "running",
          stage: event.stage,
          stageMessage: event.message,
        },
      };
    }
    return {
      ...message,
      progress: {
        ...cur,
        stage: event.stage,
        stageMessage: event.message,
      },
    };
  });
}

function applyThreadHeader(res: Response, setThreadId: Dispatch<SetStateAction<number>>) {
  const value = res.headers.get("x-thread-id");
  if (!value) return;
  const nextThreadId = Number(value);
  if (Number.isInteger(nextThreadId) && nextThreadId > 0) setThreadId(nextThreadId);
}

function isAbortError(err: unknown): boolean { return err instanceof DOMException && err.name === "AbortError"; }

function toComposerMessages(messages: ChatMessage[]): ComposerMessage[] { return messages.map((m) => ({ role: m.role, content: m.content })); }

function withoutPendingTurn(messages: ComposerMessage[]): ComposerMessage[] {
  const last = messages[messages.length - 1];
  if (!last?.streaming) return messages;
  const withoutAssistant = messages.slice(0, -1);
  return withoutAssistant.at(-1)?.role === "user" ? withoutAssistant.slice(0, -1) : withoutAssistant;
}

async function postMessage(userMsg: ComposerMessage, threadId: number, signal: AbortSignal): Promise<Response> {
  return fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: userMsg.role, content: userMsg.content }], thread_id: threadId, days: 9999 }), signal });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSsePayload(event: string, data: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(data) as unknown;
    return isRecord(payload) ? payload : {};
  } catch {
    throw new Error(`Invalid Coach stream event: ${event}`);
  }
}

function toolLabel(name: string): string {
  return name.replace(/^query_/, "").replaceAll("_", " ");
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return "";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return `${ms}ms`;
}

function formatStage(stage: string): string {
  return stage.replaceAll("_", " ");
}

export function formatToolProgressLabel(progress: ToolProgress | null | undefined): string | null {
  if (!progress) return null;
  const name = toolLabel(progress.name);
  if (progress.state === "running") {
    if (progress.name === "trigger_whoop_sync") {
      return progress.stage
        ? `Syncing Whoop… (${formatStage(progress.stage)})`
        : "Syncing Whoop…";
    }
    return `Querying ${name}...`;
  }
  const duration = formatDuration(progress.duration_ms);
  if (progress.name === "trigger_whoop_sync") {
    if (progress.status === "error") {
      return duration ? `Sync failed in ${duration}` : "Sync failed";
    }
    return duration ? `Synced Whoop in ${duration}` : "Synced Whoop";
  }
  if (progress.status === "error") {
    return duration ? `Query ${name} failed in ${duration}` : `Query ${name} failed`;
  }
  return duration ? `Queried ${name} in ${duration}` : `Queried ${name}`;
}

function latestProgress(messages: ComposerMessage[]): ToolProgress | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.streaming) return message.progress ?? null;
  }
  return null;
}

async function readChatStream(res: Response, handlers: StreamHandlers): Promise<string> {
  if (!res.body) throw new Error("Coach stream did not include a response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let sawDone = false;
  let finalReply = "";

  const dispatch = () => {
    const event = eventName;
    const data = dataLines.join("\n");
    eventName = "message";
    dataLines = [];
    if (!data) return;

    const payload = parseSsePayload(event, data);
    if (event === "text_delta") {
      const text = payload.text;
      if (typeof text === "string") handlers.appendText(text);
      return;
    }
    if (event === "tool_use_start") {
      const name = payload.name;
      if (typeof name === "string") {
        handlers.setProgress({ name, state: "running" });
      }
      return;
    }
    if (event === "tool_use_end") {
      const name = payload.name;
      if (typeof name === "string") {
        handlers.setProgress({
          name,
          state: "done",
          duration_ms: typeof payload.duration_ms === "number" ? payload.duration_ms : undefined,
          rows: typeof payload.rows === "number" || payload.rows === null ? payload.rows : undefined,
          status: payload.status === "error" ? "error" : "ok",
        });
      }
      return;
    }
    if (event === "tool_progress") {
      const tool = payload.tool;
      const stage = payload.stage;
      if (typeof tool === "string" && typeof stage === "string") {
        handlers.mergeProgressStage({
          tool,
          stage,
          message: typeof payload.message === "string" ? payload.message : undefined,
        });
      }
      return;
    }
    if (event === "done") {
      sawDone = true;
      finalReply = typeof payload.reply === "string" ? payload.reply : "";
      return;
    }
    if (event === "error") {
      const message = typeof payload.message === "string" ? payload.message : "Coach stream failed";
      throw new Error(message);
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
    if (buffer) {
      processLine(buffer);
      buffer = "";
    }
  } finally {
    reader.releaseLock();
  }

  if (!sawDone) throw new Error("Connection lost before Coach finished.");
  return finalReply;
}

async function sendChatMessage(params: SendParams) {
  if (!params.text.trim()) return;

  const userMsg: ComposerMessage = { role: "user", content: params.text };
  const nextMessages = [...withoutPendingTurn(params.messages), userMsg];
  params.setMessages(nextMessages);
  params.setInput("");
  if (params.inputRef.current) params.inputRef.current.style.height = "auto";
  params.setLoading(true);

  params.abortRef.current?.abort();
  const controller = new AbortController();
  params.abortRef.current = controller;

  const assistantIdx = nextMessages.length;
  params.setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);
  const isCurrent = () => params.abortRef.current === controller;

  try {
    const res = await postMessage(userMsg, params.threadId, controller.signal);
    if (!isCurrent()) return;
    applyThreadHeader(res, params.setThreadId);
    if (!res.ok) {
      const reply = await res.text();
      throw new Error(reply || `Server error ${res.status}`);
    }

    const reply = await readChatStream(res, {
      appendText: (text) => appendAssistantText(params.setMessages, assistantIdx, text),
      setProgress: (progress) => setAssistantProgress(params.setMessages, assistantIdx, progress),
      mergeProgressStage: (event) =>
        mergeAssistantProgressStage(params.setMessages, assistantIdx, event),
    });
    if (!isCurrent()) return;
    setAssistantMessage(params.setMessages, assistantIdx, reply);
    void params.refreshThreads();
  } catch (err) {
    if (isAbortError(err)) {
      if (isCurrent()) params.setMessages((prev) => prev.slice(0, assistantIdx));
      return;
    }
    if (!isCurrent()) return;
    const errMsg = err instanceof Error ? err.message : String(err);
    setAssistantMessage(params.setMessages, assistantIdx, `**Error:** ${errMsg}`);
  } finally {
    if (isCurrent()) {
      params.abortRef.current = null;
      params.setLoading(false);
      params.inputRef.current?.focus();
    }
  }
}

export function useChatSend({ initialMessages, threadId, setThreadId, refreshThreads }: UseChatSendParams) {
  const [messages, setMessages] = useState<ComposerMessage[]>(toComposerMessages(initialMessages));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const progress = latestProgress(messages);

  useEffect(() => {
    abortRef.current?.abort(); abortRef.current = null;
    setMessages(toComposerMessages(initialMessages));
    setInput("");
    setLoading(false);
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [initialMessages, threadId]);

  const send = useCallback((text: string) => sendChatMessage({
    text,
    messages,
    threadId,
    setThreadId,
    setMessages,
    setInput,
    setLoading,
    inputRef,
    abortRef,
    refreshThreads,
  }), [messages, refreshThreads, setThreadId, threadId]);

  return {
    messages,
    input,
    setInput,
    loading,
    inputRef,
    send,
    progress,
    progressLabel: formatToolProgressLabel(progress),
  };
}
