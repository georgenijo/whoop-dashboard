import "server-only";

export type { User, Session } from "./auth";
export {
  getUserById,
  getSessionByToken,
  createSession,
  getPrimaryUser,
} from "./auth";

export type { RecoveryRow, DayOfWeekRecoveryRow } from "./recovery";
export {
  getLatestRecovery,
  getPreviousRecovery,
  getRecoveryTrend,
  getRecoveryRange,
  getRecoveryByDayOfWeek,
} from "./recovery";

export type { CycleRow } from "./strain";
export {
  getLatestCycle,
  getPreviousCycle,
  getStrainTrend,
  getStrainRange,
} from "./strain";

export type { SleepRow, NapRow } from "./sleep";
export {
  getLatestSleep,
  getPreviousSleep,
  getSleepTrend,
  getSleepRange,
  getFullSleepTrend,
  getNaps,
  getRecentNaps,
} from "./sleep";

export type { WorkoutRow } from "./workouts";
export { getWorkouts, getWorkoutsRange } from "./workouts";

export type { PRStats, PRValue, PRStreak } from "./prs";
export { getPRStats } from "./prs";

export type { JournalRow } from "./journal";
export { getJournalRange } from "./journal";

export type { BodyMeasurementRow } from "./body";
export { getBodyMeasurements } from "./body";

export type { DailySummaryRow, InsightRow, Overview } from "./summary";
export {
  getDailySummary,
  getLatestInsight,
  saveInsight,
  getLatestWhoopDataTimestamp,
  getOverview,
  getHealthContext,
} from "./summary";

export type {
  ChatThread,
  ChatThreadSummary,
  ChatMessage,
  ChatMessageInsert,
} from "./coach";
export {
  getChatThreads,
  getLatestChatThread,
  getChatThreadById,
  createChatThread,
  touchChatThread,
  setChatThreadTitle,
  deleteChatThread,
  resolveChatThread,
  getOrCreateChatThread,
  getChatThreadSummary,
  getChatThreadMessages,
  getChatThreadConversation,
  getChatMessages,
  getChatConversation,
  getLegacyChatThreadId,
  getLegacyChatMessages,
  getLegacyChatConversation,
  addChatMessage,
  addChatMessages,
  clearChatMessages,
} from "./coach";

export type { ChatLog, SyncLog, RouteLog } from "./logs";
export {
  addChatLog,
  getChatLogs,
  clearChatLogs,
  addSyncLog,
  getSyncLogs,
  addRouteLog,
  getRouteLogs,
} from "./logs";

export type { SettingLock } from "./settings";
export {
  getSetting,
  setSetting,
  isSettingLockActive,
  acquireSettingLock,
  releaseSettingLock,
} from "./settings";
