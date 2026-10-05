/** Shared drawing units for schematic symbols and their electrical terminals. */
export const SYMBOL_METRICS = {
  pinReach: 30,
  analogPinReach: 35,
  bodyHalfWidth: 18,
  passiveHalfHeight: 7,
  sourceRadius: 14,
  gateDrop: 25,
  logicInputOffset: 10,
  flipFlopInputOffset: 12,
  transformerWindingOffset: 15,
  groundPinOffset: 20,
  normalStroke: 1.75,
} as const;
