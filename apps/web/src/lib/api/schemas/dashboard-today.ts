import { z } from "@hono/zod-openapi";

/**
 * Zod contract for `GET /api/dashboard/today` (#233 phase 1).
 *
 * This is the single source of truth for the response shape: the TypeScript
 * type is inferred from it, the Hono route validates against it, and the
 * draft OpenAPI document is generated from it. The shape must stay
 * byte-identical to the live Next handler's (a parity test enforces it),
 * so treat every field here as a wire contract, not an internal type.
 */

const nullableNumber = z.number().nullable();

export const DashboardTodayQuerySchema = z.object({
  date: z
    .string()
    .optional()
    .openapi({
      param: { name: "date", in: "query" },
      description:
        "Calendar day to report, YYYY-MM-DD. Omitted or empty means the server's local today.",
      example: "2026-11-27",
    }),
});

export const DashboardTodayResponseSchema = z
  .object({
    requested_date: z.string().openapi({ example: "2026-11-27" }),
    data_date: z.string().nullable().openapi({
      description:
        "Date whose data is returned. Null only when the 7-day lookback is empty (fresh install).",
    }),
    is_fallback: z.boolean(),
    recovery: z
      .object({
        score: nullableNumber,
        hrv_ms: nullableNumber,
        rhr_bpm: nullableNumber,
        spo2_pct: nullableNumber,
        skin_temp_c: nullableNumber,
      })
      .nullable(),
    sleep: z
      .object({
        duration_min: nullableNumber,
        perf_pct: nullableNumber,
        efficiency_pct: nullableNumber,
        debt_min: nullableNumber,
      })
      .nullable(),
    strain: z
      .object({
        score: nullableNumber,
        kj: nullableNumber,
        avg_hr: nullableNumber,
        max_hr: nullableNumber,
      })
      .nullable(),
    signals: z.object({
      ots: z
        .object({
          score: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
          severity: z.string(),
        })
        .nullable(),
      illness: z.object({ risk: z.string() }).nullable(),
      apnea: z.object({ high_risk_nights_7d: z.number() }).nullable(),
    }),
  })
  .openapi("DashboardToday");

export type DashboardTodayResponse = z.infer<typeof DashboardTodayResponseSchema>;

export const ErrorResponseSchema = z
  .object({ error: z.string() })
  .openapi("Error");
