import "server-only";
import { forUser } from "./scoped";

export type BodyMeasurementRow = {
  height_meter: number | null;
  weight_kilogram: number | null;
  max_heart_rate: number | null;
  measured_at: string;
};

export function getBodyMeasurements(userId: number): BodyMeasurementRow | null {
  const row = forUser(userId).get<BodyMeasurementRow>(
    "SELECT height_meter, weight_kilogram, max_heart_rate, measured_at " +
      "FROM body_measurements WHERE user_id = ? " +
      "ORDER BY measured_at DESC LIMIT 1",
  );
  return row ?? null;
}
