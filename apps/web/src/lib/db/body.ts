import "server-only";
import { hasTable, safeQuery } from "./connection";

export type BodyMeasurementRow = {
  height_meter: number | null;
  weight_kilogram: number | null;
  max_heart_rate: number | null;
  measured_at: string;
};

export function getBodyMeasurements(userId = 1): BodyMeasurementRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "body_measurements")) return null;
    const row = db
      .prepare(
        "SELECT height_meter, weight_kilogram, max_heart_rate, measured_at " +
          "FROM body_measurements WHERE user_id = ? " +
          "ORDER BY measured_at DESC LIMIT 1",
      )
      .get(userId) as BodyMeasurementRow | undefined;
    return row ?? null;
  });
}
