import { describe, expect, it } from "vitest";
import {
  COACH_ERROR_COPY,
  CONNECTION_LOST_MESSAGE,
  CoachRequestError,
  classifyCoachFailure,
} from "./chat-errors";

describe("classifyCoachFailure", () => {
  it.each([
    [{ reason: "missing_key", status: 503 }, "missing_key"],
    [{ reason: "invalid_key", status: 502 }, "invalid_key"],
    [{ kind: "bad_api_key", status: 401 }, "invalid_key"],
    // An untagged 401 is the auth gate (expired session), not a provider key.
    [{ status: 401 }, "session_expired"],
    [{ reason: "model_unavailable", status: 422 }, "model_unavailable"],
    [{ status: 422 }, "model_unavailable"],
    [{ kind: "overloaded", status: 503 }, "overloaded"],
    [{ kind: "rate_limited", status: 429 }, "overloaded"],
    [{ reason: "timeout", status: 504 }, "timeout"],
    [{ status: 504 }, "timeout"],
    [{ kind: "quota_exceeded", status: 402 }, "quota"],
    [{ kind: "network_error", status: 503 }, "network"],
    [{ kind: "server_error", status: 500 }, "unknown"],
    [{ reason: "something_new", status: 500 }, "unknown"],
  ])("maps %j to %s", (info, errorClass) => {
    expect(
      classifyCoachFailure(new CoachRequestError("Server said so.", info))
        .errorClass,
    ).toBe(errorClass);
  });

  it("shows the sign-in hint, not the auth gate's body, for an expired session", () => {
    expect(
      classifyCoachFailure(new CoachRequestError("Unauthorized", { status: 401 })),
    ).toEqual({ errorClass: "session_expired", detail: null });
  });

  it("treats a stray AbortError as cancelled", () => {
    expect(
      classifyCoachFailure(new DOMException("aborted", "AbortError")),
    ).toEqual({ errorClass: "cancelled", detail: null });
  });

  it("treats fetch network failures and dropped streams as network", () => {
    expect(classifyCoachFailure(new TypeError("Failed to fetch"))).toEqual({
      errorClass: "network",
      detail: null,
    });
    expect(classifyCoachFailure(new Error(CONNECTION_LOST_MESSAGE))).toEqual({
      errorClass: "network",
      detail: null,
    });
  });

  it("drops the old generic server sentence in favour of class copy", () => {
    expect(
      classifyCoachFailure(
        new CoachRequestError("Coach call failed. Please try again.", {
          kind: "server_error",
          status: 500,
        }),
      ),
    ).toEqual({ errorClass: "unknown", detail: null });
  });

  it("has a title and hint for every class", () => {
    for (const copy of Object.values(COACH_ERROR_COPY)) {
      expect(copy.title).toBeTruthy();
      expect(copy.hint).toBeTruthy();
    }
  });
});
