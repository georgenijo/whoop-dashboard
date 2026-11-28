// Issue #489 — latency-aware Coach turn routing.
//
// A fast, deterministic, side-effect-free classifier that decides the
// cheapest viable execution lane and tool envelope for a turn:
//
//   local          canned reply, no provider call, no tools (standalone social)
//   fast_no_tools  direct low-reasoning answer, tools disabled (educational)
//   simple_data    one preselected user-scoped read + one direct answer
//   agentic        today's full model + tool loop, tools narrowed when possible
//
// This first slice ships in SHADOW mode only (COACH_TURN_ROUTING=shadow): the
// plan is computed and persisted in chat_logs.details.routing next to what the
// existing path actually did, so the router's precision can be measured on
// real traffic before any lane is enforced. With the flag unset, nothing runs.
//
// Deterministic matching is deliberately narrow and high-precision. Anything
// it does not fully recognize — and anything below CONFIDENCE_THRESHOLD —
// escalates to `agentic` with the full tool envelope (today's behavior).
// Health-risk and write/action turns can never land in `local`,
// `fast_no_tools`, or `simple_data`.

export const ROUTE_LANES = ["local", "fast_no_tools", "simple_data", "agentic"] as const;
export type RouteLane = (typeof ROUTE_LANES)[number];

export const ROUTE_DOMAINS = [
  "recovery", "sleep", "strain", "workouts", "naps", "steps", "journal", "plans",
] as const;
export type RouteDomain = (typeof ROUTE_DOMAINS)[number];

/** Tool names the router may grant. Kept in sync with CoachToolName (tools.ts). */
export const ROUTABLE_TOOLS = [
  "query_recovery",
  "query_sleep",
  "query_strain",
  "query_workouts",
  "query_journal",
  "query_naps",
  "query_steps",
  "query_daily_snapshot",
  "query_workout_plans",
  "save_workout_plan",
  "trigger_whoop_sync",
] as const;
export type RoutableTool = (typeof ROUTABLE_TOOLS)[number];

export type ToolEnvelope = "none" | "subset" | "auto";

export type CoachRoutePlan = {
  lane: RouteLane;
  domains: RouteDomain[];
  dateRange: { start_date: string; end_date: string } | null;
  reasoning: "minimal" | "low" | "high";
  toolEnvelope: ToolEnvelope;
  /** Explicit grant for "subset"; empty for "none"; every tool for "auto". */
  allowedTools: RoutableTool[];
  risk: "low" | "high";
  confidence: number;
  reasonCode: string;
};

/** Non-content signals the decision was based on (safe to log). */
export type RouteFeatures = {
  chars: number;
  has_images: boolean;
  social: "greeting" | "thanks" | "ack" | "cancel" | null;
  greeting_prefix: boolean;
  personal: boolean;
  educational: boolean;
  domains: RouteDomain[];
  inherited_domains: boolean;
  period: string | null;
  snapshot: boolean;
  analysis: boolean;
  write_intent: boolean;
  health_risk: boolean;
  depth: "deep" | "quick" | null;
  multiline_or_quoted: boolean;
};

export type RouteDecision = {
  plan: CoachRoutePlan;
  features: RouteFeatures;
  /** True when the candidate lane was overridden to `agentic`. */
  escalated: boolean;
  /** Lane the classifier would have picked before the confidence gate. */
  candidateLane: RouteLane;
};

export type RouteInput = {
  text: string;
  hasImages?: boolean;
  /** Visible text of earlier user turns, oldest first. Only the tail is used. */
  recentUserTexts?: string[];
  /** YYYY-MM-DD in the user's day frame. */
  today: string;
};

export const CONFIDENCE_THRESHOLD = 0.75;

export type CoachTurnRoutingMode = "off" | "shadow";

/** Default-off. Only the exact value "shadow" turns the router on. */
export function coachTurnRoutingMode(
  env: Record<string, string | undefined> = process.env,
): CoachTurnRoutingMode {
  return env.COACH_TURN_ROUTING?.trim().toLowerCase() === "shadow" ? "shadow" : "off";
}

// ---------------------------------------------------------------------------
// Feature extraction

const MAX_SOCIAL_CHARS = 40;

// Whole-message social turns only. A trailing "coach" addressee, punctuation
// and emoji are tolerated; any other word disqualifies the match.
const SOCIAL_PATTERNS: Array<[NonNullable<RouteFeatures["social"]>, RegExp]> = [
  ["greeting", /^(?:h+e+y+a*|h+i+(?:ya)?|hello+|hey there|hi there|yo+|sup|howdy|hola|good (?:morning|afternoon|evening)|morning|gm)$/],
  ["thanks", /^(?:thanks?(?: (?:a lot|so much|again))?|thank you(?: (?:so much|again))?|thx|ty|cheers|appreciate it|much appreciated)$/],
  ["ack", /^(?:ok(?:ay)?|k|kk|cool|got it|nice|great|perfect|sounds good|awesome|makes sense|will do|noted)$/],
  ["cancel", /^(?:never ?mind|nvm|cancel|forget it|stop)$/],
];

const GREETING_PREFIX =
  /^(?:h+e+y+a*|h+i+|hello+|yo+|good (?:morning|afternoon|evening)|morning)(?: coach)?[\s,!.\-–—:]+/;

const DOMAIN_PATTERNS: Array<[RouteDomain, RegExp]> = [
  ["recovery", /\b(?:recovery|recovered|hrv|heart rate variability|rhr|resting heart rate|readiness)\b/],
  ["sleep", /\b(?:sleep|slept|sleeping|bedtime|wake time|woke up|last night)\b/],
  ["naps", /\b(?:nap|naps|napped|napping)\b/],
  ["strain", /\b(?:strain|exertion|kilojoules|calories burned)\b/],
  ["workouts", /\b(?:workout|workouts|trained|training|exercise|exercised|run|ran|lift|lifted|gym)\b/],
  ["steps", /\b(?:steps|step count)\b/],
  ["journal", /\b(?:journal|alcohol|caffeine|drinks?)\b/],
  ["plans", /\b(?:plan|plans|program|schedule)\b/],
];

const DOMAIN_TOOL: Record<RouteDomain, RoutableTool> = {
  recovery: "query_recovery",
  sleep: "query_sleep",
  naps: "query_naps",
  strain: "query_strain",
  workouts: "query_workouts",
  steps: "query_steps",
  journal: "query_journal",
  plans: "query_workout_plans",
};

const PERSONAL = /\b(?:my|me|i|i'm|im|i've|mine|am i|did i|have i|was i)\b/;
const EDUCATIONAL =
  /^(?:what(?:'s| is| are| does| do)|why (?:is|are|does|do)|how (?:does|do|is|are)|explain|define|tell me about|is it (?:true|bad|good|ok(?:ay)?))\b/;
const SNAPSHOT =
  /^(?:so |and )?(?:how am i (?:doing|looking)(?: today| right now| this morning)?|how(?:'s| is) my day(?: looking)?|give me (?:my|a) (?:daily )?(?:check-?in|snapshot|status|overview)|daily check-?in)[?.!]*$/;
const ANALYSIS =
  /\b(?:compare|comparison|vs\.?|versus|trend|trends|trending|correlat\w*|pattern|patterns|analy[sz]\w*|why|over time|breakdown|relationship|impact|affect\w*|average|improv\w*|worse|better than)\b/;
const WRITE_INTENT =
  /\b(?:save|create|build|make|generate|write|draft|design|update|delete|remove|log|record|sync|refresh|resync)\b/;
const DEEP = /\b(?:think (?:deeply|hard|carefully)|in[- ]depth|deep dive|thorough(?:ly)?|detailed analysis)\b/;
const QUICK = /\b(?:quick(?:ly)?|brief(?:ly)?|short answer|tl;?dr|one line|in a sentence)\b/;
// Conservative urgent-symptom list. A hit always forces the capable path; a
// miss proves nothing (the agentic default still covers unrecognized risk).
const HEALTH_RISK =
  /\b(?:chest (?:pain|pressure|tightness)|can'?t breathe|cannot breathe|short(?:ness)? of breath|trouble breathing|faint(?:ed|ing)?|passed out|blacked out|pass(?:ing)? out|suicid\w*|kill myself|self[- ]harm|overdos\w*|stroke|heart attack|seizure|numb(?:ness)?|palpitations?|irregular heartbeat|afib|arrhythmia|cough(?:ing)? (?:up )?blood|blood in|severe (?:pain|headache)|emergency|911|dizz(?:y|iness))\b/;

type Period = { label: string; start: number; end: number; days: number };

function parsePeriod(text: string): Period | null {
  const lastN = /\b(?:last|past|previous) (\d{1,3}) (day|days|week|weeks|month|months)\b/.exec(text);
  if (lastN) {
    const n = Number(lastN[1]);
    const unit = lastN[2].startsWith("day") ? 1 : lastN[2].startsWith("week") ? 7 : 30;
    const days = Math.max(1, n * unit);
    return { label: `last_${days}_days`, start: days - 1, end: 0, days };
  }
  if (/\b(?:last|past|this) week\b/.test(text)) return { label: "this_week", start: 6, end: 0, days: 7 };
  if (/\b(?:last|past|this) month\b/.test(text)) return { label: "last_30_days", start: 29, end: 0, days: 30 };
  if (/\byesterday\b/.test(text)) return { label: "yesterday", start: 1, end: 1, days: 1 };
  if (/\b(?:today|tonight|this morning|right now|currently|last night)\b/.test(text)) {
    return { label: "today", start: 0, end: 0, days: 1 };
  }
  return null;
}

function isoMinusDays(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip trailing punctuation/emoji and an optional "coach" addressee. */
function socialCore(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, "")
    .replace(/[\s!.?,~:;)(]+$/g, "")
    .replace(/^[\s!.?,~]+/g, "")
    .replace(/,?\s*coach$/, "")
    .trim();
}

function domainsIn(text: string): RouteDomain[] {
  return DOMAIN_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([domain]) => domain);
}

export function extractRouteFeatures(input: RouteInput): RouteFeatures & { body: string } {
  const raw = input.text ?? "";
  const text = normalize(raw);
  const multilineOrQuoted = /[\n\r]/.test(raw.trim()) || /["“”`]/.test(raw) || /^>/.test(raw.trim());

  let social: RouteFeatures["social"] = null;
  if (!multilineOrQuoted && text.length > 0 && text.length <= MAX_SOCIAL_CHARS) {
    const core = socialCore(text);
    social = SOCIAL_PATTERNS.find(([, pattern]) => pattern.test(core))?.[0] ?? null;
  }

  const prefix = social ? null : GREETING_PREFIX.exec(text);
  const body = prefix ? text.slice(prefix[0].length).trim() : text;

  let domains = domainsIn(body);
  const period = parsePeriod(body);
  // Follow-ups ("what about yesterday?", "and last week?") inherit the domain
  // of the most recent user turn that named one.
  let inherited = false;
  if (
    domains.length === 0 &&
    period &&
    /^(?:what about|how about|and|ok(?:ay)?,? (?:and|what about)|same for|now)\b/.test(body) &&
    body.length <= 40
  ) {
    for (const previous of [...(input.recentUserTexts ?? [])].reverse().slice(0, 3)) {
      const found = domainsIn(normalize(previous));
      if (found.length > 0) {
        domains = found;
        inherited = true;
        break;
      }
    }
  }

  return {
    body,
    chars: raw.length,
    has_images: Boolean(input.hasImages),
    social,
    greeting_prefix: Boolean(prefix),
    personal: PERSONAL.test(body) || inherited,
    educational: EDUCATIONAL.test(body),
    domains,
    inherited_domains: inherited,
    period: period?.label ?? null,
    snapshot: SNAPSHOT.test(body),
    analysis: ANALYSIS.test(body),
    write_intent: WRITE_INTENT.test(body),
    health_risk: HEALTH_RISK.test(text),
    depth: DEEP.test(text) ? "deep" : QUICK.test(text) ? "quick" : null,
    multiline_or_quoted: multilineOrQuoted,
  };
}

// ---------------------------------------------------------------------------
// Decision

const READ_TOOLS: RoutableTool[] = [
  "query_recovery", "query_sleep", "query_strain", "query_workouts",
  "query_journal", "query_naps", "query_steps", "query_daily_snapshot",
];

function agenticAuto(reasonCode: string, confidence: number, risk: "low" | "high" = "low"): CoachRoutePlan {
  return {
    lane: "agentic",
    domains: [],
    dateRange: null,
    reasoning: "high",
    toolEnvelope: "auto",
    allowedTools: [...ROUTABLE_TOOLS],
    risk,
    confidence,
    reasonCode,
  };
}

/** The safe default: today's full agentic path with every tool. */
export function fallbackRoutePlan(reasonCode = "fallback"): CoachRoutePlan {
  return agenticAuto(reasonCode, 0);
}

function candidatePlan(f: RouteFeatures & { body: string }, input: RouteInput): CoachRoutePlan {
  const period = parsePeriod(f.body);
  const dateRange = period
    ? { start_date: isoMinusDays(input.today, period.start), end_date: isoMinusDays(input.today, period.end) }
    : null;

  if (f.health_risk) return agenticAuto("health_risk", 0.95, "high");
  if (f.has_images) return agenticAuto("image_attached", 0.9);
  if (f.social) {
    return {
      lane: "local", domains: [], dateRange: null, reasoning: "minimal",
      toolEnvelope: "none", allowedTools: [], risk: "low", confidence: 0.98,
      reasonCode: `social_${f.social}`,
    };
  }
  if (f.chars === 0 || f.body.length === 0) return agenticAuto("empty", 0.5);

  if (f.write_intent) {
    const wantsSync = /\b(?:sync|refresh|resync)\b/.test(f.body);
    const wantsPlan = f.domains.includes("plans");
    if (wantsSync && !wantsPlan) {
      return {
        lane: "agentic", domains: [], dateRange, reasoning: "low", toolEnvelope: "subset",
        allowedTools: ["trigger_whoop_sync", ...READ_TOOLS], risk: "low", confidence: 0.85,
        reasonCode: "write_sync",
      };
    }
    if (wantsPlan) {
      return {
        lane: "agentic", domains: f.domains, dateRange, reasoning: "high", toolEnvelope: "subset",
        allowedTools: ["query_workout_plans", "save_workout_plan", ...READ_TOOLS], risk: "low",
        confidence: 0.85, reasonCode: "write_plan",
      };
    }
    return agenticAuto("write_intent", 0.8);
  }

  const reasoningFor = (base: CoachRoutePlan["reasoning"]) =>
    f.depth === "quick" ? "minimal" : base;

  if (f.snapshot && f.depth !== "deep") {
    return {
      lane: "simple_data", domains: ["recovery", "sleep", "strain", "workouts"],
      dateRange: { start_date: input.today, end_date: input.today },
      reasoning: reasoningFor("low"), toolEnvelope: "subset",
      allowedTools: ["query_daily_snapshot"], risk: "low", confidence: 0.9,
      reasonCode: "daily_snapshot",
    };
  }

  const dataDomains = f.domains.filter((domain) => domain !== "plans");
  if (f.personal && dataDomains.length > 0) {
    const tools = dataDomains.map((domain) => DOMAIN_TOOL[domain]);
    const longRange = period ? period.days > 7 : false;
    if (f.depth === "deep" || f.analysis || dataDomains.length > 1 || longRange) {
      return {
        lane: "agentic", domains: dataDomains, dateRange, reasoning: "high",
        toolEnvelope: "subset", allowedTools: tools, risk: "low", confidence: 0.85,
        reasonCode: dataDomains.length > 1 ? "multi_domain_analysis" : "single_domain_analysis",
      };
    }
    if (dateRange && dataDomains.length === 1) {
      return {
        lane: "simple_data", domains: dataDomains, dateRange, reasoning: reasoningFor("low"),
        toolEnvelope: "subset", allowedTools: tools, risk: "low",
        confidence: f.inherited_domains ? 0.8 : 0.9,
        reasonCode: f.inherited_domains ? "follow_up_lookup" : "single_domain_lookup",
      };
    }
    // Short single-domain question with no period ("how did I sleep?",
    // "what's my recovery?") means the latest day.
    if (dataDomains.length === 1 && f.body.length <= 60) {
      return {
        lane: "simple_data", domains: dataDomains,
        dateRange: { start_date: input.today, end_date: input.today },
        reasoning: reasoningFor("low"), toolEnvelope: "subset", allowedTools: tools,
        risk: "low", confidence: 0.8, reasonCode: "single_domain_latest",
      };
    }
    // Personal + domain but no recognizable period: plausible lookup, but the
    // range is the model's call. Below threshold, so it escalates.
    return {
      lane: "simple_data", domains: dataDomains, dateRange: null, reasoning: "low",
      toolEnvelope: "subset", allowedTools: tools, risk: "low", confidence: 0.6,
      reasonCode: "unbounded_lookup",
    };
  }

  if (!f.personal && f.educational && f.depth !== "deep") {
    return {
      lane: "fast_no_tools", domains: [], dateRange: null, reasoning: reasoningFor("low"),
      toolEnvelope: "none", allowedTools: [], risk: "low",
      // A recognized health term makes the topic clearly in-scope; a generic
      // question might still want personal context, so it stays below the gate.
      confidence: dataDomains.length > 0 ? 0.85 : 0.7,
      reasonCode: dataDomains.length > 0 ? "educational_health_term" : "educational_generic",
    };
  }

  return agenticAuto("ambiguous", 0.5);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Bound-check a plan from any source (this classifier or a future model router). */
export function validateRoutePlan(plan: unknown): plan is CoachRoutePlan {
  if (typeof plan !== "object" || plan === null) return false;
  const p = plan as Partial<CoachRoutePlan>;
  if (!ROUTE_LANES.includes(p.lane as RouteLane)) return false;
  if (!Array.isArray(p.domains) || !p.domains.every((d) => ROUTE_DOMAINS.includes(d))) return false;
  if (!Array.isArray(p.allowedTools) || !p.allowedTools.every((t) => ROUTABLE_TOOLS.includes(t))) return false;
  if (!["none", "subset", "auto"].includes(p.toolEnvelope as string)) return false;
  if (!["minimal", "low", "high"].includes(p.reasoning as string)) return false;
  if (p.risk !== "low" && p.risk !== "high") return false;
  if (typeof p.confidence !== "number" || !(p.confidence >= 0 && p.confidence <= 1)) return false;
  if (typeof p.reasonCode !== "string" || p.reasonCode.length === 0 || p.reasonCode.length > 64) return false;
  if (p.dateRange !== null) {
    if (typeof p.dateRange !== "object" || p.dateRange === undefined) return false;
    const { start_date, end_date } = p.dateRange;
    if (!ISO_DATE.test(start_date) || !ISO_DATE.test(end_date) || start_date > end_date) return false;
  }
  // Envelope / lane invariants.
  if (p.toolEnvelope === "none" && p.allowedTools.length > 0) return false;
  if (p.toolEnvelope !== "none" && p.allowedTools.length === 0) return false;
  if ((p.lane === "local" || p.lane === "fast_no_tools") && p.toolEnvelope !== "none") return false;
  if (p.lane === "simple_data" && (p.toolEnvelope !== "subset" || p.allowedTools.length !== 1)) return false;
  if (p.lane !== "agentic" && p.risk === "high") return false;
  if (p.lane !== "agentic" && p.allowedTools.some((t) => t === "save_workout_plan" || t === "trigger_whoop_sync")) {
    return false;
  }
  return true;
}

/** Classify a turn. Pure and synchronous; never throws on odd input. */
export function routeCoachTurn(input: RouteInput): RouteDecision {
  const extracted = extractRouteFeatures(input);
  const { body: _body, ...features } = extracted;
  void _body;
  const candidate = candidatePlan(extracted, input);
  const candidateLane = candidate.lane;
  if (!validateRoutePlan(candidate)) {
    return {
      plan: fallbackRoutePlan("invalid_plan"),
      features,
      escalated: true,
      candidateLane,
    };
  }
  if (candidate.lane !== "agentic" && candidate.confidence < CONFIDENCE_THRESHOLD) {
    return {
      plan: { ...agenticAuto(`low_confidence:${candidate.reasonCode}`, candidate.confidence) },
      features,
      escalated: true,
      candidateLane: candidate.lane,
    };
  }
  return { plan: candidate, features, escalated: false, candidateLane: candidate.lane };
}

// ---------------------------------------------------------------------------
// Shadow-mode receipt (chat_logs.details.routing)

export type CoachRoutingReceipt = {
  mode: "shadow";
  /** Lane the router chose. In shadow mode the turn still ran `agentic`. */
  lane: RouteLane;
  candidate_lane: RouteLane;
  executed_lane: "agentic";
  enforced: false;
  reason_code: string;
  confidence: number;
  escalated: boolean;
  fell_back: boolean;
  error?: string;
  tool_envelope: ToolEnvelope;
  allowed_tools: RoutableTool[];
  domains: RouteDomain[];
  date_range: CoachRoutePlan["dateRange"];
  reasoning: CoachRoutePlan["reasoning"];
  risk: CoachRoutePlan["risk"];
  router_ms: number;
  features: RouteFeatures;
};

export type ShadowRouteInput = RouteInput & { now?: () => number };

/**
 * Compute the routing receipt for a turn without changing how it executes.
 * Any classifier failure yields a fallback receipt instead of throwing, so the
 * shadow router can never break a live turn.
 */
export function shadowRouteCoachTurn(
  input: ShadowRouteInput,
  route: (input: RouteInput) => RouteDecision = routeCoachTurn,
): CoachRoutingReceipt {
  const now = input.now ?? (() => performance.now());
  const startedAt = now();
  let decision: RouteDecision;
  let error: string | undefined;
  try {
    decision = route(input);
    if (!validateRoutePlan(decision.plan)) throw new Error("router returned an invalid plan");
  } catch (err) {
    error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    decision = {
      plan: fallbackRoutePlan("router_error"),
      features: safeFeatures(input),
      escalated: true,
      candidateLane: "agentic",
    };
  }
  const routerMs = Math.round((now() - startedAt) * 1000) / 1000;
  const { plan } = decision;
  return {
    mode: "shadow",
    lane: plan.lane,
    candidate_lane: decision.candidateLane,
    executed_lane: "agentic",
    enforced: false,
    reason_code: plan.reasonCode,
    confidence: plan.confidence,
    escalated: decision.escalated,
    fell_back: error !== undefined,
    ...(error !== undefined ? { error } : {}),
    tool_envelope: plan.toolEnvelope,
    allowed_tools: plan.allowedTools,
    domains: plan.domains,
    date_range: plan.dateRange,
    reasoning: plan.reasoning,
    risk: plan.risk,
    router_ms: routerMs,
    features: decision.features,
  };
}

function safeFeatures(input: RouteInput): RouteFeatures {
  return {
    chars: typeof input.text === "string" ? input.text.length : 0,
    has_images: Boolean(input.hasImages),
    social: null,
    greeting_prefix: false,
    personal: false,
    educational: false,
    domains: [],
    inherited_domains: false,
    period: null,
    snapshot: false,
    analysis: false,
    write_intent: false,
    health_risk: false,
    depth: null,
    multiline_or_quoted: false,
  };
}

/** Visible text of prior user turns from stored conversation blocks. */
export function recentUserTextsFromBlocks(
  messages: Array<{ role: string; contentBlocks: unknown[] }>,
  limit = 3,
): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.contentBlocks
      .map((block) =>
        typeof block === "object" && block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) texts.push(text);
  }
  return texts.slice(-limit);
}
