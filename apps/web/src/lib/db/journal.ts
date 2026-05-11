import "server-only";
import { dateRangeClause, hasColumn, hasTable, safeQuery } from "./connection";

// TODO(phase-e): the `journal` table has no `user_id` column. This read is
// unscoped — every authenticated user sees the same maintainer journal. Add
// `user_id` to the table + thread it through here when Phase E (onboarding +
// per-user journaling UI) lands. See docs/decisions/DECISIONS.md 2026-05-11
// "Phase D kickoff" — journal was explicitly deferred out of Phase D scope.

export type JournalRow = {
  date: string;
  title: string | null;
  content: string | null;
  mood: string | null;
  tags: string | null;
};

export function getJournalRange(startDate: string, endDate: string): JournalRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "journal")) return [];
      const hasTitle = hasColumn(db, "journal", "title");
      const hasContent = hasColumn(db, "journal", "content");
      const hasMood = hasColumn(db, "journal", "mood");
      const hasTags = hasColumn(db, "journal", "tags");
      const title = hasTitle ? "title" : "NULL AS title";
      const content = hasContent ? "content" : "NULL AS content";
      const mood = hasMood ? "mood" : "NULL AS mood";
      const tags = hasTags ? "tags" : "NULL AS tags";
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT date, ${title}, ${content}, ${mood}, ${tags} FROM journal WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as JournalRow[];
    }) ?? []
  );
}
