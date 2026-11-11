/** Shared drawing units for schematic symbols and their electrical terminals. */
export const SYMBOL_METRICS = {
  pinReach: 30,
  analogPinReach: 35,
  bodyHalfWidth: 20,
  passiveHalfHeight: 8,
  capacitorPlateHalfLength: 16,
  capacitorPlateHalfGap: 3,
  sourceRadius: 14,
  gateDrop: 25,
  logicInputOffset: 10,
  flipFlopInputOffset: 12,
  transformerWindingOffset: 15,
  groundPinOffset: 20,
  normalStroke: 2,
} as const;
