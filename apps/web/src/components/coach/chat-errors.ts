// Client-side view of a failed Coach turn. The server already classifies
// failures (`kind`, plus the finer `reason` from `lib/coach/error-mapping.ts`);
// this maps them onto copy that tells the user what to do next.

export type CoachErrorClass =
  | "missing_key"
  | "invalid_key"
  | "model_unavailable"
  | "overloaded"
  | "timeout"
  | "cancelled"
  | "quota"
  | "network"
  | "session_expired"
  | "unknown";

export type CoachTurnError = {
  errorClass: CoachErrorClass;
  /** Server-provided detail, when it says more than the generic fallback. */
  detail: string | null;
};

type FailureInfo = {
  reason?: unknown;
  kind?: unknown;
  status?: number;
  message?: string | null;
};

/** Thrown inside the send path so the catch block keeps the server's class. */
export class CoachRequestError extends Error {
  constructor(
    message: string,
    readonly info: FailureInfo,
  ) {
    super(message);
    this.name = "CoachRequestError";
  }
}

export const CONNECTION_LOST_MESSAGE = "Connection lost before Coach finished.";
const GENERIC_SERVER_MESSAGE = "Coach call failed. Please try again.";

export const COACH_ERROR_COPY: Record<
  CoachErrorClass,
  { title: string; hint: string }
> = {
  missing_key: {
    title: "No API key is configured for this model.",
    hint: "Add a key in Settings, or pick another model below.",
  },
  invalid_key: {
    title: "The API key for this model was rejected.",
    hint: "Update the key in Settings, then retry.",
  },
  model_unavailable: {
    title: "That model isn't available right now.",
    hint: "Pick another model below, then retry.",
  },
  overloaded: {
    title: "The model provider is busy.",
    hint: "Wait a few seconds, then retry.",
  },
  timeout: {
    title: "Coach took too long to answer.",
    hint: "Retry, or ask a narrower question.",
  },
  cancelled: {
    title: "The reply was cancelled before it finished.",
    hint: "Retry to ask again.",
  },
  quota: {
    title: "The provider account is out of credits.",
    hint: "Top up the account or add a personal key in Settings.",
  },
  network: {
    title: "Lost the connection to Coach.",
    hint: "Check your connection, then retry.",
  },
  session_expired: {
    title: "You've been signed out.",
    hint: "Reload the page to sign in again, then retry.",
  },
  unknown: {
    title: "Coach hit an unexpected error.",
    hint: "Retry, or start a new thread if it keeps happening.",
  },
};

const REASONS = new Set<CoachErrorClass>([
  "missing_key",
  "invalid_key",
  "model_unavailable",
  "overloaded",
  "timeout",
  "quota",
  "network",
]);

function classFromInfo(info: FailureInfo): CoachErrorClass {
  if (typeof info.reason === "string" && REASONS.has(info.reason as CoachErrorClass)) {
    return info.reason as CoachErrorClass;
  }
  switch (info.kind) {
    case "bad_api_key":
      return "invalid_key";
    case "quota_exceeded":
      return "quota";
    case "rate_limited":
    case "overloaded":
      return "overloaded";
    case "network_error":
      return "network";
  }
  switch (info.status) {
    // Provider-key failures always carry `kind`/`reason` (handled above); an
    // untagged 401 comes from the auth gate, i.e. the session itself.
    case 401:
      return "session_expired";
    case 422:
      return "model_unavailable";
    case 429:
    case 529:
      return "overloaded";
    case 504:
      return "timeout";
  }
  if (info.message === CONNECTION_LOST_MESSAGE) return "network";
  return "unknown";
}

export function classifyCoachFailure(error: unknown): CoachTurnError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { errorClass: "cancelled", detail: null };
  }
  // `fetch` rejects with a bare TypeError when the network itself fails.
  if (error instanceof TypeError) return { errorClass: "network", detail: null };
  const message = error instanceof Error ? error.message : String(error);
  const info =
    error instanceof CoachRequestError ? error.info : { message };
  const errorClass = classFromInfo({ ...info, message: info.message ?? message });
  const detail =
    message && message !== GENERIC_SERVER_MESSAGE && message !== CONNECTION_LOST_MESSAGE
      ? message
      : null;
  return { errorClass, detail };
}
