import "server-only";
import { dateRangeClause, hasColumn, hasTable, safeQuery } from "./connection";

// Issue #494 (resolves the former Phase-E TODO): journal reads are now
// tenant-scoped. The `journal` table is optional and externally populated —
// it does not exist in the current production DB, and this app never writes
// it — so `openWrite()` only ALTERs in `user_id` when the table is present,
// and this read degrades to [] when it isn't.
//
// Scoping is a plain `user_id = ?` filter rather than `forUser()`: the wrapper
// (src/lib/db/scoped.ts) is the Phase-D contract for the five Whoop domain
// tables, and its invariant — user_id must be the trailing positional `?` —
// doesn't compose with this module's runtime column sniffing. Safety comes
// from `userId` being a required leading parameter instead.

export type JournalRow = {
  date: string;
  title: string | null;
  content: string | null;
  mood: string | null;
  tags: string | null;
};

export function getJournalRange(
  userId: number,
  startDate: string,
  endDate: string
): JournalRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "journal")) return [];
      // Fail closed: an un-migrated journal table can't be attributed to a
      // tenant, so it reads as empty rather than as everyone's.
      if (!hasColumn(db, "journal", "user_id")) return [];
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
          `SELECT date, ${title}, ${content}, ${mood}, ${tags} FROM journal WHERE ${range.clause} AND user_id = ? ORDER BY date ASC`
        )
        .all(...range.params, userId) as JournalRow[];
    }) ?? []
  );
}
