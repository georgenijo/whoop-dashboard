import { describe, expect, it } from "vitest";
import {
  ALL_CSV_COLUMNS,
  EXPORT_COLUMNS,
  MAX_RANGE_DAYS,
  addDays,
  capRows,
  csvCell,
  daysInclusive,
  exportFilename,
  isValidIsoDate,
  parseExportParams,
  projectRows,
  toCombinedCsv,
  toCsv,
  toJsonEnvelope,
  todayInTimeZone,
} from "./data-export";

const sp = (qs: string) => new URLSearchParams(qs);
const TODAY = "2026-11-27";

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-1-01")).toBe(false);
    expect(isValidIsoDate("2026-01-01T00:00")).toBe(false);
  });

  it("addDays / daysInclusive cross month, year and DST boundaries", () => {
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST start
    expect(daysInclusive("2026-03-01", "2026-03-01")).toBe(1);
    expect(daysInclusive("2026-03-07", "2026-03-09")).toBe(3);
    expect(daysInclusive("2024-01-01", "2024-12-31")).toBe(366);
  });

  it("todayInTimeZone uses the user's zone across midnight", () => {
    const now = new Date("2026-11-28T03:30:00Z"); // 22:30 previous day in New York
    expect(todayInTimeZone(now, "America/New_York")).toBe("2026-11-27");
    expect(todayInTimeZone(now, "Asia/Tokyo")).toBe("2026-11-28");
    expect(todayInTimeZone(now, null)).toBe("2026-11-28");
    expect(todayInTimeZone(now, "Not/AZone")).toBe("2026-11-28");
  });
});

describe("parseExportParams", () => {
  it("defaults: kind=all, csv, last 90 days ending today", () => {
    const r = parseExportParams(sp(""), TODAY);
    expect(r).toEqual({
      ok: true,
      params: { kind: "all", format: "csv", range: { from: "2026-08-30", to: TODAY, days: 90 } },
    });
  });

  it("blank strings count as absent", () => {
    const r = parseExportParams(sp("from=&to=%20&kind=&format="), TODAY);
    expect(r.ok && r.params.range.days).toBe(90);
  });

  it("only `to` → 90 days ending at `to`; only `from` → through today", () => {
    const a = parseExportParams(sp("to=2026-01-31"), TODAY);
    expect(a.ok && a.params.range).toEqual({ from: "2025-11-03", to: "2026-01-31", days: 90 });
    const b = parseExportParams(sp("from=2026-11-01"), TODAY);
    expect(b.ok && b.params.range).toEqual({ from: "2026-11-01", to: TODAY, days: 27 });
  });

  it("single day is allowed", () => {
    const r = parseExportParams(sp("from=2026-05-05&to=2026-05-05"), TODAY);
    expect(r.ok && r.params.range.days).toBe(1);
  });

  it(`enforces the ${MAX_RANGE_DAYS}-day cap at the boundary`, () => {
    const ok = parseExportParams(sp(`from=${addDays("2026-06-01", -(MAX_RANGE_DAYS - 1))}&to=2026-06-01`), TODAY);
    expect(ok.ok).toBe(true);
    const bad = parseExportParams(sp(`from=${addDays("2026-06-01", -MAX_RANGE_DAYS)}&to=2026-06-01`), TODAY);
    expect(bad).toEqual({ ok: false, error: "range is limited to 400 days (got 401)" });
    // `from` alone far in the past also hits the cap
    expect(parseExportParams(sp("from=2020-01-01"), TODAY).ok).toBe(false);
  });

  it("rejects unknown kind/format, bad dates, inverted range", () => {
    for (const qs of ["kind=integrations", "kind=ALL", "format=xlsx", "from=2026-02-31", "to=x", "from=2026-05-02&to=2026-05-01"]) {
      expect(parseExportParams(sp(qs), TODAY).ok).toBe(false);
    }
  });
});

describe("projectRows", () => {
  it("allow-lists columns in contract order and drops everything else", () => {
    const rows = projectRows("cycles", [
      { user_id: 7, id: "x", raw: "{}", max_hr: 170, date: "2026-01-01", strain: 9.1, token: "t" },
    ]);
    expect(Object.keys(rows[0])).toEqual(EXPORT_COLUMNS.cycles);
    expect(rows[0]).toEqual({ date: "2026-01-01", strain: 9.1, kilojoule: null, avg_hr: null, max_hr: 170 });
  });

  it("empty input → empty output", () => {
    expect(projectRows("recovery", [])).toEqual([]);
  });

  it("no dataset exports an identifier or user column", () => {
    for (const cols of [...Object.values(EXPORT_COLUMNS), ALL_CSV_COLUMNS]) {
      for (const c of cols) expect(c).not.toMatch(/^(id|user_id|sleep_id|cycle_id|raw)$|token|key/);
    }
  });
});

describe("capRows", () => {
  it("truncates over the cap and reports the total", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ date: `d${i}` }));
    expect(capRows(rows, 3)).toEqual({ rows: rows.slice(0, 3), truncated: true, total: 5 });
    expect(capRows(rows, 5).truncated).toBe(false);
  });
});

describe("csvCell / toCsv", () => {
  it("handles null, numbers, booleans", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(-0.4)).toBe("-0.4"); // genuine negatives stay numeric
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  it("quotes per RFC 4180", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("x\r\ny")).toBe('"x\r\ny"');
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"])("neutralises formula trigger %j", (s) => {
    const out = csvCell(s);
    expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("combines neutralising and quoting", () => {
    expect(csvCell('=HYPERLINK("u","x")')).toBe(`"'=HYPERLINK(""u"",""x"")"`);
  });

  it("header-only for no rows; CRLF everywhere", () => {
    expect(toCsv(["date", "x"], [])).toBe("date,x\r\n");
    expect(toCsv(["date", "x"], [{ date: "2026-01-01", x: 1 }, { date: "2026-01-02", x: null }])).toBe(
      "date,x\r\n2026-01-01,1\r\n2026-01-02,\r\n",
    );
  });

  it("combined CSV: dataset column first, blanks for foreign columns", () => {
    const csv = toCombinedCsv({
      recovery: { rows: [{ date: "2026-01-01", recovery_score: 50 }], truncated: false, total: 1 },
      steps: { rows: [{ date: "2026-01-01", steps: 100, source: "whoop" }], truncated: false, total: 1 },
    });
    const [header, r1, r2] = csv.split("\r\n");
    expect(header.split(",")).toEqual(ALL_CSV_COLUMNS);
    expect(new Set(header.split(",")).size).toBe(ALL_CSV_COLUMNS.length);
    expect(r1.startsWith("recovery,2026-01-01,50,")).toBe(true);
    expect(r2.startsWith("steps,2026-01-01,")).toBe(true);
    expect(r2.split(",")).toHaveLength(ALL_CSV_COLUMNS.length);
  });
});

describe("toJsonEnvelope", () => {
  const range = { from: "2026-01-01", to: "2026-01-02", days: 2 };
  const now = new Date("2026-01-03T00:00:00Z");

  it("single dataset", () => {
    const env = toJsonEnvelope("cycles", range, {
      cycles: { rows: [{ date: "2026-01-01", strain: 1 }], truncated: true, total: 9 },
    }, now);
    expect(env).toEqual({
      version: 1,
      generated_at: "2026-01-03T00:00:00.000Z",
      user_scope: "self",
      kind: "cycles",
      range,
      truncated: true,
      columns: EXPORT_COLUMNS.cycles,
      rows: [{ date: "2026-01-01", strain: 1 }],
    });
  });

  it("all: every dataset key present even when empty", () => {
    const env = toJsonEnvelope("all", range, {}, now);
    expect(Object.keys(env.rows)).toEqual(["recovery", "sleep", "workouts", "cycles", "steps"]);
    expect(env.truncated).toBe(false);
  });
});

it("exportFilename", () => {
  expect(exportFilename("all", { from: "2026-01-01", to: "2026-03-31", days: 90 }, "json")).toBe(
    "whoop-export-all-2026-01-01_to_2026-03-31.json",
  );
});
