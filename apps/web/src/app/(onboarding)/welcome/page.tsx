import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireAuthOrSignin } from "@/lib/auth";
import { getUserSettings } from "@/lib/db";
import WelcomeClient from "./WelcomeClient";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ stage?: string }> };

/**
 * Server shell. Resolves auth → onboarded gate → stage decoding, then hands
 * off to the client state machine. Already-onboarded users get bounced to /
 * UNLESS they're returning via `?stage=connect` — the only legitimate
 * re-entry deep-link (the OAuth callback only redirects to `?stage=sync` for
 * unonboarded users, who don't trip the guard).
 */
export default async function WelcomePage({ searchParams }: Props) {
  const headerList = await headers();
  const req = new Request("http://localhost", { headers: headerList });
  const { user } = await requireAuthOrSignin(req);
  const params = await searchParams;
  const stageParam = params.stage;
  const allowConnectReentry = stageParam === "connect";

  const settings = getUserSettings(user.id);
  if (settings && settings.onboarded_at !== null && !allowConnectReentry) {
    redirect("/");
  }

  const initialStage: "welcome" | "connect" | "sync" =
    stageParam === "sync"
      ? "sync"
      : stageParam === "connect"
        ? "connect"
        : "welcome";

  return (
    <WelcomeClient
      initialStage={initialStage}
      initialGoals={settings?.coach_goals ?? []}
    />
  );
}
