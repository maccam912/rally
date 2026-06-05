/** Road / ground surface types. Order matters: the numeric value is what gets
 * synced over the wire in the car/track schema. */
export enum Surface {
  Tarmac = 0,
  Gravel = 1,
  Sand = 2,
  Snow = 3,
  Offroad = 4, // grass / out of bounds — you don't want to be here
}

export interface SurfaceParams {
  /** lateral grip coefficient — how fast sideways slide is killed (per second).
   * Higher = grippier = harder to drift but more controllable. */
  grip: number;
  /** multiplier on top speed for this surface */
  speedMult: number;
  /** rolling resistance applied to forward velocity (per second) */
  drag: number;
  /** display label */
  label: string;
}

export const SURFACE_PARAMS: Record<Surface, SurfaceParams> = {
  [Surface.Tarmac]: { grip: 2.4, speedMult: 1.0, drag: 0.35, label: "Tarmac" },
  [Surface.Gravel]: { grip: 1.7, speedMult: 0.93, drag: 0.6, label: "Gravel" },
  [Surface.Sand]: { grip: 1.5, speedMult: 0.82, drag: 0.95, label: "Sand" },
  [Surface.Snow]: { grip: 1.05, speedMult: 0.88, drag: 0.45, label: "Snow" },
  [Surface.Offroad]: { grip: 1.8, speedMult: 0.5, drag: 2.4, label: "Off-road" },
};

/** Surfaces that can be assigned to road sections of a procedural track. */
export const ROAD_SURFACES: readonly Surface[] = [
  Surface.Tarmac,
  Surface.Gravel,
  Surface.Sand,
  Surface.Snow,
];
