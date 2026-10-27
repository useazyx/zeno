import type * as THREE from "three"
import { createVehicleModel, disposeVehicleModel, updateVehicleModel } from "./vehicle-models"
import type { VehicleModelFrame, VehicleModelOptions } from "./vehicle-models"

export function createFireTruckModel(variant: "normal" | "ai" | "distance" = "normal", options?: Partial<VehicleModelOptions>) {
  return createVehicleModel({ type: "ABT", isolatedGeometry: !options, ...options, routeVariant: variant })
}

/** Compatibility API: the map's existing repaint owns all animation. */
export function updateFireTruckSignals(root: THREE.Object3D, seconds: number, moving: boolean, reducedMotion: boolean, frame?: Partial<VehicleModelFrame>) {
  updateVehicleModel(root, { ...frame, seconds, moving, reducedMotion })
}

export const disposeFireTruckModel = disposeVehicleModel
