"use client";

import {
  newRunningWorkLog,
  parseCoachWorkLog,
  type CoachToolActivity,
  type CoachWorkLog,
} from "@/lib/coach/work-log-types";
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
export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  status?: ChatMessageStatus;
  work_log?: CoachWorkLog | null;
};

export type ComposerMessage = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: ChatMessageStatus;
  workLog?: CoachWorkLog | null;
  workStartedAt?: number;
};

type UseChatSendParams = {
  initialMessages: ChatMessage[];
  threadId: number;
  setThreadId: Dispatch<SetStateAction<number>>;
  refreshThreads: () => Promise<unknown>;
  setBadApiKey?: (value: boolean) => void;
};

type SendParams = Omit<UseChatSendParams, "initialMessages"> & {
  text: string;
  messages: ComposerMessage[];
  setMessages: Dispatch<SetStateAction<ComposerMessage[]>>;
  setInput: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  abortRef: RefObject<AbortController | null>;
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
  done: (reply: string, workLog: CoachWorkLog | null) => void;
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
) {
  updateAssistantMessage(setMessages, index, (message) => ({
    ...message,
    content: reply,
    streaming: false,
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
  messageText: string,
) {
  updateAssistantMessage(setMessages, index, (message) => ({
    ...message,
    content: `**Error:** ${messageText}`,
    streaming: false,
    workLog: {
      ...activeWorkLog(message),
      status: "error",
      duration_ms:
        message.workStartedAt == null ? null : Date.now() - message.workStartedAt,
    },
  }));
}

function applyThreadHeader(
  response: Response,
  setThreadId: Dispatch<SetStateAction<number>>,
) {
  const value = response.headers.get("x-thread-id");
  if (!value) return;
  const nextThreadId = Number(value);
  if (Number.isInteger(nextThreadId) && nextThreadId > 0) {
    setThreadId(nextThreadId);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function toComposerMessages(messages: ChatMessage[]): ComposerMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    status: message.status,
    workLog: message.work_log ?? null,
  }));
}

function withoutPendingTurn(messages: ComposerMessage[]): ComposerMessage[] {
  const last = messages.at(-1);
  if (!last?.streaming) return messages;
  const withoutAssistant = messages.slice(0, -1);
  return withoutAssistant.at(-1)?.role === "user"
    ? withoutAssistant.slice(0, -1)
    : withoutAssistant;
}

async function postMessage(
  userMessage: ComposerMessage,
  threadId: number,
  signal: AbortSignal,
): Promise<Response> {
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
      );
    } else if (event === "error") {
      if (payload.kind === "bad_api_key") {
        handlers.badApiKey?.({
          origin:
            typeof payload.origin === "string" ? payload.origin : "unknown",
        });
        sawDone = true;
      } else {
        throw new Error(
          typeof payload.message === "string"
            ? payload.message
            : "Coach stream failed",
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
  if (!sawDone) throw new Error("Connection lost before Coach finished.");
}

async function sendChatMessage(params: SendParams) {
  if (!params.text.trim()) return;
  params.setBadApiKey?.(false);

  const userMessage: ComposerMessage = { role: "user", content: params.text };
  const nextMessages = [...withoutPendingTurn(params.messages), userMessage];
  params.setMessages(nextMessages);
  params.setInput("");
  if (params.inputRef.current) params.inputRef.current.style.height = "auto";
  params.setLoading(true);

  params.abortRef.current?.abort();
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
    const response = await postMessage(
      userMessage,
      params.threadId,
      controller.signal,
    );
    if (!isCurrent()) return;
    applyThreadHeader(response, params.setThreadId);
    if (!response.ok) {
      if (response.status === 401) {
        try {
          const body = (await response.clone().json()) as { kind?: string };
          if (body.kind === "bad_api_key") {
            params.setBadApiKey?.(true);
            params.setMessages((previous) => previous.slice(0, assistantIndex));
            return;
          }
        } catch {
          // Fall through to the generic error path.
        }
      }
      throw new Error((await response.text()) || `Server error ${response.status}`);
    }

    await readChatStream(response, {
      appendText: (text) =>
        appendAssistantText(params.setMessages, assistantIndex, text),
      startTool: (event) =>
        startAssistantTool(params.setMessages, assistantIndex, event),
      endTool: (event) =>
        endAssistantTool(params.setMessages, assistantIndex, event),
      progressTool: (event) =>
        progressAssistantTool(params.setMessages, assistantIndex, event),
      done: (reply, workLog) =>
        finishAssistant(params.setMessages, assistantIndex, reply, workLog),
      badApiKey: () => {
        badApiKey = true;
        params.setBadApiKey?.(true);
      },
    });
    if (!isCurrent()) return;
    if (badApiKey) {
      params.setMessages((previous) => previous.slice(0, assistantIndex));
      return;
    }
    void params.refreshThreads();
  } catch (error) {
    if (isAbortError(error)) {
      if (isCurrent()) {
        params.setMessages((previous) => previous.slice(0, assistantIndex));
      }
      void params.refreshThreads();
      return;
    }
    if (!isCurrent()) return;
    failAssistant(
      params.setMessages,
      assistantIndex,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (isCurrent()) {
      params.abortRef.current = null;
      params.setLoading(false);
      params.inputRef.current?.focus();
    }
  }
}

export function useChatSend({
  initialMessages,
  threadId,
  setThreadId,
  refreshThreads,
  setBadApiKey,
}: UseChatSendParams) {
  const [messages, setMessages] = useState<ComposerMessage[]>(
    toComposerMessages(initialMessages),
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeMessage = [...messages]
    .reverse()
    .find((message) => message.streaming && message.role === "assistant");

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages(toComposerMessages(initialMessages));
    setInput("");
    setLoading(false);
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [initialMessages, threadId]);

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
        inputRef,
        abortRef,
        refreshThreads,
        setBadApiKey,
      }),
    [messages, refreshThreads, setBadApiKey, setThreadId, threadId],
  );

  return {
    messages,
    input,
    setInput,
    loading,
    inputRef,
    send,
    progress: activeMessage?.workLog ?? null,
    progressLabel: workPhaseLabel(
      activeMessage?.workLog,
      Boolean(activeMessage?.content),
    ),
  };
}
