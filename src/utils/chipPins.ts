import type { CircuitElement } from '../types';

export const DEFAULT_CHIP_PINS: NonNullable<CircuitElement['chipPins']> = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  number: String(index + 1),
  label: '',
  side: index < 4 ? 'left' as const : 'right' as const,
}));

export function chipPins(element: CircuitElement): NonNullable<CircuitElement['chipPins']> {
  return element.chipPins ?? DEFAULT_CHIP_PINS;
}

export function validateChipPins(pins: NonNullable<CircuitElement['chipPins']>) {
  if (pins.length < 2 || pins.length > 32) throw new Error('Микросхема: допустимо от 2 до 32 выводов.');
  const ids = new Set<string>();
  const numbers = new Set<string>();
  for (const pin of pins) {
    if (!/^p[1-9]\d*$/.test(pin.id) || ids.has(pin.id) || !pin.number.trim() || numbers.has(pin.number.trim()) ||
      !['left', 'right'].includes(pin.side) || pin.label.length > 24) {
      throw new Error('Микросхема: проверьте уникальные номера, имена и стороны выводов.');
    }
    ids.add(pin.id); numbers.add(pin.number.trim());
  }
}
