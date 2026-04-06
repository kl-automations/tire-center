/** Road-wheel count from backend (4 = standard car, 6 = dual rear). */

export type VehicleWheelCount = 4 | 6;

const ROAD_WHEELS_4 = ["front-right", "front-left", "rear-right", "rear-left"] as const;

/** Extra positions on dual-rear (inner) axle — order matches CarVisualization rear rows */
const REAR_INNER_6 = ["rear-right-inner", "rear-left-inner"] as const;

/** All road wheel position ids for relocation / tire popup (no spare) */
export function getRoadWheelPositions(wheelCount: VehicleWheelCount): string[] {
  if (wheelCount === 6) {
    return [...ROAD_WHEELS_4, ...REAR_INNER_6];
  }
  return [...ROAD_WHEELS_4];
}

/**
 * Mock: plate whose digits are `123456` is a 6-wheel vehicle.
 * Replace with API field when integrated (`wheelCount` on vehicle).
 */
export function getVehicleWheelCountFromPlate(licensePlate: string): VehicleWheelCount {
  const digits = licensePlate.replace(/\D/g, "");
  if (digits === "123456") return 6;
  return 4;
}

/** Prefer explicit backend value; otherwise derive from plate (mock) */
export function resolveVehicleWheelCount(
  licensePlate: string,
  explicit?: VehicleWheelCount
): VehicleWheelCount {
  return explicit ?? getVehicleWheelCountFromPlate(licensePlate);
}
