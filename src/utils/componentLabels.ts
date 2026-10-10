export interface ComponentLabelPoint {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface ComponentLabelLayout {
  name: ComponentLabelPoint;
  value: ComponentLabelPoint;
  isolation: ComponentLabelPoint;
}

interface ComponentLabelOptions {
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  showName?: boolean;
}

/** Positions labels with the component while keeping the text itself upright. */
export function getComponentLabelLayout({
  rotation = 0,
  flipH = false,
  flipV = false,
  showName = true,
}: ComponentLabelOptions): ComponentLabelLayout {
  const normalized = ((rotation % 360) + 360) % 360;
  const radians = normalized * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const transform = (x: number, y: number): ComponentLabelPoint => {
    const localX = flipH ? -x : x;
    const localY = flipV ? -y : y;
    const transformedX = localX * cos - localY * sin;
    const transformedY = localX * sin + localY * cos;
    return {
      x: Math.round(transformedX * 10) / 10,
      y: Math.round(transformedY * 10) / 10,
      anchor: 'middle',
    };
  };

  return {
    name: transform(0, -36),
    value: transform(0, showName ? 38 : -36),
    isolation: transform(0, showName ? -52 : 52),
  };
}
import type { CircuitElement } from '../types';
import { normalizeEngNotation } from '../math/circuitSolver';


/** A schematic value describes a model parameter, never repeats the symbol's type name. */
export function getComponentValueLabel(element: CircuitElement): string {
  const parameter = (value: number) => normalizeEngNotation(String(value));
  switch (element.type) {
    case 'DIODE':
      if (element.diodeModel === 'ideal') return 'идеальный';
    case 'THYRISTOR':
      return `${parameter(element.modelParams?.forwardVoltage ?? (element.value > 0 ? element.value : 0.7))}В`;
    case 'SWITCH':
      return `Rвкл=${parameter(element.modelParams?.onResistance ?? 0.01)}Ω`;
    case 'NPN': case 'PNP':
      return `${element.type} · β=${parameter(element.modelParams?.betaForward ?? 100)}`;
    case 'NMOS': case 'PMOS':
      return `${element.type} · Vth=${parameter(element.modelParams?.thresholdVoltage ?? 2)}В`;
    case 'COMPARATOR':
      return `Uпор=${parameter(element.modelParams?.logicThreshold ?? 2.5)}В`;
    case 'TR3':
      return `L1=${normalizeEngNotation(element.valueStr || String(element.value)).replace(/\s*(Гн|H)\s*$/iu, '')}Гн · n=${parameter(element.modelParams?.turnsRatio ?? element.secondaryValue ?? 1)}`;
    case 'NOT': case 'AND': case 'OR': case 'XOR':
    case 'RS_FF': case 'D_FF': case 'JK_FF':
    case 'PORT': case 'GND': case 'JUNCTION': case 'TEXT': case 'CHIP':
      return '';
    default:
      return element.valueStr ? normalizeEngNotation(element.valueStr) : '';
  }
}
