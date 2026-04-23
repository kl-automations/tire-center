/**
 * Vehicle wheel-layout utilities.
 *
 * Determines how many road wheels a vehicle has and returns the canonical
 * wheel-position strings used as keys throughout the app
 * (e.g. in `OpenRequest.wheels`, `TirePopup`, `AxlesDiagram`).
 */

/** Road-wheel count from backend (4 = standard car, 6 = dual rear-axle vehicle). */
export type VehicleWheelCount = 4 | 6;

const ROAD_WHEELS_4 = ["front-right", "front-left", "rear-right", "rear-left"] as const;

/** Extra positions on a dual-rear (inner) axle — order matches AxlesDiagram rear rows. */
const REAR_INNER_6 = ["rear-right-inner", "rear-left-inner"] as const;

/**
 * Returns the ordered list of road-wheel position IDs for the given wheel count.
 * The spare tyre is intentionally excluded — it is handled separately.
 *
 * @param wheelCount - 4 for standard cars, 6 for dual-rear-axle vehicles.
 * @returns Array of position strings, e.g. `["front-right", "front-left", "rear-right", "rear-left"]`.
 */
export function getRoadWheelPositions(wheelCount: VehicleWheelCount): string[] {
  if (wheelCount === 6) {
    return [...ROAD_WHEELS_4, ...REAR_INNER_6];
  }
  return [...ROAD_WHEELS_4];
}

/**
 * Derives the wheel count from a licence plate string.
 *
 * **Mock implementation** — currently only plate `"123456"` (digits-only) returns 6.
 * Replace the body of this function with the `wheelCount` field from the
 * ERP car-lookup response once `POST /api/car` is wired up.
 *
 * @param licensePlate - The vehicle licence plate in any format.
 * @returns `6` for known 6-wheel plates, `4` otherwise.
 */
export function getVehicleWheelCountFromPlate(licensePlate: string): VehicleWheelCount {
  const digits = licensePlate.replace(/\D/g, "");
  if (digits === "123456") return 6;
  return 4;
}

/**
 * Returns the wheel count, preferring an explicit backend value over the
 * plate-derived mock.
 *
 * Use this everywhere in the UI — it gracefully degrades to the mock when
 * the backend value is not yet available.
 *
 * @param licensePlate - Vehicle plate (used as fallback via `getVehicleWheelCountFromPlate`).
 * @param explicit     - Wheel count from the API response (`car_data.wheel_count`), if available.
 * @returns The resolved `VehicleWheelCount`.
 */
export function resolveVehicleWheelCount(
  licensePlate: string,
  explicit?: VehicleWheelCount
): VehicleWheelCount {
  return explicit ?? getVehicleWheelCountFromPlate(licensePlate);
}
