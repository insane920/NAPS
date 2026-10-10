import type { CircuitElement } from '../types';

export const CONTROLLED_SOURCE_TYPES = new Set(['VCVS', 'VCCS', 'CCVS', 'CCCS']);
export const VOLTAGE_BRANCH_TYPES = new Set(['V_DC', 'V_AC', 'V_PULSE']);

/** A current-controlled source senses the signed current from pin 1 to pin 2
 * of an independent voltage source, as in SPICE F/H elements. */
export function controlBranch(element: CircuitElement, elements: CircuitElement[]): CircuitElement {
  const name = element.controlSource?.trim().toLocaleUpperCase();
  if (!name) throw new Error(`${element.name}: выберите управляющий независимый источник напряжения.`);
  const source = elements.find(candidate => candidate.name.toLocaleUpperCase() === name);
  if (!source || !VOLTAGE_BRANCH_TYPES.has(source.type) || source.isolation) {
    throw new Error(`${element.name}: управляющий источник ${element.controlSource} не найден, изолирован или не является независимым источником напряжения.`);
  }
  return source;
}

export function validateControlledSources(elements: CircuitElement[]) {
  for (const element of elements.filter(item => CONTROLLED_SOURCE_TYPES.has(item.type) && !item.isolation)) {
    if (!Number.isFinite(element.value)) throw new Error(`${element.name}: коэффициент передачи должен быть конечным числом.`);
    if (element.type === 'CCVS' || element.type === 'CCCS') controlBranch(element, elements);
  }
}
