// Shared IANA-timezone validator. Used by /api/auth/apple (initial capture on
// sign-in) and /api/me/tz (later write-once gate from the wizard). Both
// callers treat TZ as opt-in — invalid input returns null and the caller
// elides the field rather than rejecting the request.

const TZ_MAX_LENGTH = 100;

export function sanitizeTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TZ_MAX_LENGTH) return null;
  try {
    // resolvedOptions().timeZone normalises case and offset aliases (e.g.
    // "america/new_york" → "America/New_York", "+00:00" → "UTC") so we
    // persist a single canonical IANA name regardless of browser quirks.
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed })
      .resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
