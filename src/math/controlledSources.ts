import type { CircuitElement } from '../types';
import { getCircuitPinIds } from './circuitSolver';

export const CONTROLLED_SOURCE_TYPES = new Set(['VCVS', 'VCCS', 'CCVS', 'CCCS']);
export const VOLTAGE_BRANCH_TYPES = new Set(['V_DC', 'V_AC', 'V_PULSE']);

/** A current-controlled source senses the signed current from pin 1 to pin 2
 * of an independent voltage source, as in SPICE F/H elements. */
export function controlBranch(element: CircuitElement, elements: CircuitElement[]): CircuitElement {
  const name = element.controlSource?.trim().toLocaleUpperCase();
  if (!name && !element.controlSourceId) throw new Error(`${element.name}: выберите управляющий независимый источник напряжения.`);
  const matches = elements.filter(candidate => element.controlSourceId
    ? candidate.id === element.controlSourceId : candidate.name.trim().toLocaleUpperCase() === name);
  const source = matches.length === 1 ? matches[0] : undefined;
  if (!source || !VOLTAGE_BRANCH_TYPES.has(source.type) || source.isolation) {
    throw new Error(`${element.name}: управляющий источник ${element.controlSource} не найден, изолирован или не является независимым источником напряжения.`);
  }
  return source;
}

/** Bind legacy names once, before an edit can remove or rename their target. */
export function bindCurrentControls(elements: CircuitElement[]): CircuitElement[] {
  return elements.map(element => {
    if (!['CCVS', 'CCCS'].includes(element.type) || element.controlSourceId) return element;
    try { return { ...element, controlSourceId: controlBranch(element, elements).id }; }
    catch { return element; } // Incomplete documents remain editable; the solver reports the error.
  });
}

export function replaceElementPreservingControls(elements: CircuitElement[], updated: CircuitElement): CircuitElement[] {
  return bindCurrentControls(elements).map(element => element.id === updated.id ? updated
    : element.controlSourceId === updated.id ? { ...element, controlSource: updated.name } : element);
}

export function validateControlledSources(elements: CircuitElement[], onlyId?: string) {
  for (const element of elements.filter(item => CONTROLLED_SOURCE_TYPES.has(item.type) && !item.isolation && (!onlyId || item.id === onlyId))) {
    if (!Number.isFinite(element.value)) throw new Error(`${element.name}: коэффициент передачи должен быть конечным числом.`);
    if (element.type === 'CCVS' || element.type === 'CCCS') controlBranch(element, elements);
    if (element.controlVoltage) {
      if (!['VCVS', 'VCCS'].includes(element.type)) throw new Error(`${element.name}: управление напряжением неприменимо к этой модели.`);
      for (const ref of [element.controlVoltage.positive, element.controlVoltage.negative]) {
        const target = elements.find(item => item.id === ref.elementId);
        if (!target || !getCircuitPinIds(target.type, target).includes(ref.pinId)) {
          throw new Error(`${element.name}: отсутствует контакт управляющего напряжения. Выберите его в свойствах.`);
        }
      }
    }
  }
}
