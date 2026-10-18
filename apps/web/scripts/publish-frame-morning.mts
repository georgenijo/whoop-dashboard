import { pathToFileURL } from "node:url";
import * as morningBriefNamespace from "@/lib/db/morning-brief";
import * as morningPublisherNamespace from "@/lib/frame-morning-publisher";

type MorningBriefModule = typeof import("@/lib/db/morning-brief");
type MorningPublisherModule = typeof import("@/lib/frame-morning-publisher");
type MorningAccountBinding = import("@/lib/db/morning-brief").MorningAccountBinding;

// apps/web is package-default CommonJS. The explicit .mts entrypoint is ESM
// so Node/tsx can execute top-level await; its .ts dependencies therefore
// arrive through the CommonJS default namespace at runtime. Vitest presents
// the same modules as native named exports, so accept either interop shape.
const morningBriefModule = (
  (morningBriefNamespace as unknown as { default?: MorningBriefModule }).default ??
  morningBriefNamespace
) as MorningBriefModule;
const morningPublisherModule = (
  (morningPublisherNamespace as unknown as { default?: MorningPublisherModule }).default ??
  morningPublisherNamespace
) as MorningPublisherModule;
const {
  buildMorningBrief,
  unavailableMorningBrief,
} = morningBriefModule;
const {
  publishMorningBrief,
  validateMorningWebhookUrl,
} = morningPublisherModule;

type AccountConfig = {
  userId: number;
  binding: MorningAccountBinding;
};

type Environment = Record<string, string | undefined>;

export function readWebhookDestination(env: Environment): string | null {
  const webhookUrl = env.FRAME_MORNING_HA_WEBHOOK_URL?.trim() ?? "";
  try {
    validateMorningWebhookUrl(webhookUrl);
  } catch {
    return null;
  }
  return webhookUrl;
}

export function readAccountConfig(env: Environment): AccountConfig | null {
  const rawUserId = env.FRAME_MORNING_USER_ID?.trim() ?? "";
  const userId = Number(rawUserId);
  if (!/^\d+$/.test(rawUserId) || !Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }

  const accountSubject = env.FRAME_MORNING_ACCOUNT_SUBJECT?.trim() ?? "";
  const emailSha256 = env.FRAME_MORNING_EMAIL_SHA256?.trim() ?? "";
  if (Boolean(accountSubject) === Boolean(emailSha256)) return null;
  const binding: MorningAccountBinding = accountSubject
    ? { kind: "account_subject", value: accountSubject }
    : { kind: "email_sha256", value: emailSha256 };
  return { userId, binding };
}

type PublisherDependencies = {
  publish?: typeof publishMorningBrief;
  build?: typeof buildMorningBrief;
  now?: () => Date;
  log?: Pick<Console, "log" | "error">;
};

export async function runMorningPublisher(
  env: Environment,
  dependencies: PublisherDependencies = {},
): Promise<number> {
  const log = dependencies.log ?? console;
  const publish = dependencies.publish ?? publishMorningBrief;
  const now = dependencies.now?.() ?? new Date();
  const webhookUrl = readWebhookDestination(env);
  if (!webhookUrl) {
    log.error("frame morning publish failed: invalid private destination");
    return 1;
  }

  const account = readAccountConfig(env);
  if (!account) {
    try {
      await publish(webhookUrl, unavailableMorningBrief(now));
    } catch {
      log.error("frame morning publish failed");
      return 1;
    }
    log.error("frame morning publish failed: invalid private configuration");
    return 1;
  }

  const result = (dependencies.build ?? buildMorningBrief)({
    userId: account.userId,
    binding: account.binding,
    now,
  });
  try {
    await publish(webhookUrl, result.brief);
  } catch {
    if (result.brief.status !== "unavailable") {
      try {
        await publish(webhookUrl, unavailableMorningBrief(now));
      } catch {
        // The first failure is already definitive. This best-effort second
        // request only lets Home Assistant fail closed when the endpoint is
        // reachable but rejected the healthy payload.
      }
    }
    log.error("frame morning publish failed");
    return 1;
  }

  if (result.failure) {
    log.error(`frame morning source unavailable: ${result.failure}`);
    return 1;
  }
  log.log("frame morning publish succeeded");
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  process.exitCode = await runMorningPublisher(process.env);
}
