import type { CircuitElement, CircuitWire } from '../types';
import { getCircuitPinIds } from '../math/circuitSolver';

/** Reverse terminal roles while every attached conductor stays at the same physical point. */
export function swapElementTerminals(elements: CircuitElement[], wires: CircuitWire[], id: string) {
  const selected = elements.find(element => element.id === id);
  if (!selected || getCircuitPinIds(selected.type, selected).length !== 2) return { elements, wires };
  const swap = (pin: string) => pin === '1' ? '2' : pin === '2' ? '1' : pin;
  return {
    elements: elements.map(element => {
      let updated = element;
      if (element.id === id) updated = { ...element, flipH: !element.flipH,
        ...(['C', 'L'].includes(element.type) && element.initialCondition !== undefined ? { initialCondition: -element.initialCondition } : {}) };
      if (element.controlVoltage) updated = { ...updated, controlVoltage: {
        positive: { ...element.controlVoltage.positive, pinId: element.controlVoltage.positive.elementId === id ? swap(element.controlVoltage.positive.pinId) : element.controlVoltage.positive.pinId },
        negative: { ...element.controlVoltage.negative, pinId: element.controlVoltage.negative.elementId === id ? swap(element.controlVoltage.negative.pinId) : element.controlVoltage.negative.pinId },
      } };
      return updated;
    }),
    wires: wires.map(wire => ({ ...wire,
      fromPinId: wire.fromCompId === id ? swap(wire.fromPinId) : wire.fromPinId,
      toPinId: wire.toCompId === id ? swap(wire.toPinId) : wire.toPinId,
    })),
  };
}
