export type InterpolationMethod = 'linear' | 'cubic-spline' | 'least-squares';

export interface DataPoint {
  id: string;
  x: number;
  y: number;
  xRaw?: string;
  yRaw?: string;
}

export interface SplineSegment {
  i: number;
  x0: number;
  x1: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface CalculationResult {
  targetX: number;
  targetY: number | null;
  method: InterpolationMethod;
  isExtrapolated: boolean;
  extrapolationType: 'none' | 'left' | 'right';
  segmentIndex?: number;
  segmentFormula?: string;
  slope?: number;
  status: 'success' | 'warning' | 'error';
  errorMessage?: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  // Polynomial Least Squares (NumPy polyfit) fields:
  polynomialDegree?: number;
  /**
   * Polynomial coefficients in descending order matching NumPy np.polyfit:
   * [c_d, c_{d-1}, ..., c_1, c_0]
   */
  polynomialCoefficients?: number[];
  rSquared?: number;
  rmse?: number;
  polynomialFormula?: string;
}

export interface QMessageBoxData {
  isOpen: boolean;
  type: 'critical' | 'warning' | 'information';
  title: string;
  text: string;
  detailedText?: string;
}

export interface PresetDataset {
  id: string;
  name: string;
  deviceType: 'test' | 'thyristor' | 'igbt' | 'mosfet';
  description: string;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  points: Array<{ x: number; y: number }>;
  defaultTargetX: number;
}

// ============================================================================
// Моделирование и расчёт силовых преобразователей.
// ============================================================================

export type TopologyType =
  | 'rectifier-1p'    // Однофазный мостовой выпрямитель (диодный / тиристорный)
  | 'rectifier-3p'    // Трехфазный мостовой выпрямитель (схема Ларионова)
  | 'buck'            // Импульсный понижающий регулятор постоянного напряжения (Buck)
  | 'boost'           // Импульсный повышающий регулятор (Boost)
  | 'buck-boost'      // Импульсный понижающе-повышающий регулятор (Buck-Boost)
  | 'inverter-1p';    // Автономный однофазный мостовой инвертор напряжения

export type SemiconductorType = 'thyristor' | 'diode' | 'igbt' | 'mosfet';

export interface PowerDevice {
  id: string;
  name: string;
  type: SemiconductorType;
  manufacturer: string;
  /** Номинальный средний или действующий ток I_ном, А */
  iNom: number;
  /** Предельный повторяющийся импульсный ток I_max,rep, А */
  iMaxRep: number;
  /** Номинальное блокирующее напряжение U_ном (V_DRM / V_RRM / V_DSS), В */
  uNom: number;
  /** Пороговое падение напряжения (V0 / V_ce(sat) / V_F), В */
  v0: number;
  /** Динамическое сопротивление открытого состояния Rd или R_ds(on), Ом */
  rd: number;
  /** Энергия потерь при включении E_on, мДж */
  eOn: number;
  /** Энергия потерь при выключении E_off, мДж */
  eOff: number;
  /** Время обратного восстановления t_rr, нс */
  tRecover: number;
  /** Максимально допустимая температура перехода T_j,max, °C */
  tjMax: number;
  /** Тепловое сопротивление кристалл-корпус R_th(j-c), °C/Вт */
  rthJC: number;
  /** Тепловое сопротивление корпус-охладитель R_th(c-s), °C/Вт */
  rthCS: number;
  /** Тепловое сопротивление охладитель-среда R_th(s-a), °C/Вт */
  rthSA: number;
  description: string;
}

export interface ConverterParameters {
  /** Действующее или постоянное входное напряжение U_in, В */
  uIn: number;
  /** Частота питающей сети f, Гц (для выпрямителей и инверторов) */
  freq: number;
  /** Сопротивление нагрузки R_load, Ом */
  rLoad: number;
  /** Индуктивность нагрузки L_load, Гн */
  lLoad: number;
  /** Емкость сглаживающего фильтра C_load, Ф */
  cLoad: number;
  /** Противо-ЭДС нагрузки E (постоянное напряжение двигателя / АКБ), В */
  eEmf: number;
  /** Угол управления тиристорами альфа, град (0..180) */
  alpha: number;
  /** Скважность ШИМ D (0..1) для импульсных регуляторов */
  dutyCycle: number;
  /** Частота коммутации ключей f_sw, Гц */
  fSwitch: number;
  /** Коэффициент запаса по пределу k_зап (1.1 .. 2.0, ГОСТ 1.2..1.5) */
  safetyFactor: number;
  /** Температура окружающей среды T_a, °C */
  tAmbient: number;
  /** Число отображаемых периодов (1..5) */
  displayCycles: number;
  /** Режим моделирования: установившийся период или пусковой переходный процесс */
  simulationMode: 'steady-state' | 'transient';
}

export interface SimulationPoint {
  /** Время от начала отсчета, с */
  t: number;
  /** Ток через исследуемый силовой ключ i_key(t), А */
  iKey: number;
  /** Напряжение на исследуемом ключе u_key(t), В */
  uKey: number;
  /** Ток в нагрузке i_load(t), А */
  iLoad: number;
  /** Напряжение на нагрузке u_load(t), В */
  uLoad: number;
  /** Сигнал управления затвором / отпирающий импульс тиристора (1/0) */
  gate: number;
  /** Ток через индуктивность цепи, А */
  iL?: number;
  /** Напряжение на емкости цепи, В */
  uC?: number;
}

export interface SimulationResult {
  points: SimulationPoint[];
  /** Длительность одного периода T, с */
  period: number;
  /** Временной шаг интегрирования dt, с */
  timeStep: number;
  /** Средний ток ключа I_mean, А */
  iMean: number;
  /** Действующий ток ключа I_rms, А */
  iRms: number;
  /** Максимальный импульсный ток I_max, А */
  iMax: number;
  /** Максимальное напряжение на ключе U_max (амплитуда обратного/прямого), В */
  uMax: number;
  /** Коэффициент формы тока k_f = I_rms / I_mean */
  formFactor: number;
  /** Среднее выпрямленное / выходное напряжение на нагрузке U_load,mean, В */
  uLoadMean: number;
  /** Действующее выходное напряжение U_load,rms, В */
  uLoadRms: number;
  /** Средний ток нагрузки I_load,mean, А */
  iLoadMean: number;
  /** Коэффициент пульсаций выходного напряжения k_пульс, % */
  uRipplePercent: number;
  /** Статическая мощность потерь проводимости P_cond, Вт */
  pCond: number;
  /** Динамическая мощность коммутационных потерь P_sw, Вт */
  pSw: number;
  /** Суммарная мощность тепловых потерь в ключе P_loss, Вт */
  pLoss: number;
  /** Мощность в нагрузке P_load, Вт */
  pLoad: number;
  /** Расчетная температура p-n перехода кристалла T_j, °C */
  tJunction: number;
}

export interface CheckItem {
  label: string;
  actual: number;
  limit: number;
  allowedWithMargin: number;
  unit: string;
  passed: boolean;
  marginPercent: number;
}

export interface DeviceVerification {
  status: 'ok' | 'warning' | 'danger';
  statusTitle: string;
  statusBadge: string;
  currentCheck: CheckItem;
  peakCurrentCheck: CheckItem;
  voltageCheck: CheckItem;
  thermalCheck: {
    actual: number;
    limit: number;
    passed: boolean;
    marginDeg: number;
    unit: string;
  };
  details: string[];
}

export interface AnalyticalBenchmarkResult {
  theoryIMean: number;
  theoryIRms: number;
  numericalIMean: number;
  numericalIRms: number;
  errorIMean: number;
  errorIRms: number;
  maxAllowedError: number;
  passed: boolean;
  notes: string;
}

// ============================================================================
// Интерактивный редактор схем и окно графиков.
// ============================================================================

export type ComponentCategory =
  | 'basic'        // Основные: Порт, Земля, R, L, C, Диод, Тиристор, Ключ
  | 'sources'      // Источники: U_DC, U_SIN, U_PULSE, I_DC
  | 'active'       // Активные: ОУ, ИНУН, ИТУН, Транзистор
  | 'functional'   // Функциональные блоки / логика: Компаратор, Сумматор
  | 'annotation';  // Текст, директивы (.define, .param)

export type ComponentType =
  | 'GND'         // Земля (0 В)
  | 'PORT'        // Элемент «Порт»
  | 'R'           // Резистор
  | 'L'           // Индуктивность
  | 'C'           // Конденсатор
  | 'TR3'         // Двухобмоточный трансформатор; имя TR3 оставлено для совместимости SCM
  | 'DIODE'       // Диод
  | 'THYRISTOR'   // Тиристор
  | 'SWITCH'      // Управляемый ключ / транзистор (VCK)
  | 'V_DC'        // Источник постоянного напряжения
  | 'V_AC'        // Источник синусоидального напряжения
  | 'V_PULSE'     // Источник прямоугольных импульсов (ШИМ)
  | 'I_DC'        // Источник постоянного тока
  | 'OPAMP'       // Операционный усилитель
  | 'COMPARATOR'  // Компаратор
  | 'NOT'         // Логический инвертор НЕ (NOT1)
  | 'AND'         // Логический элемент И (&)
  | 'OR'          // Логический элемент ИЛИ (1 / >=1)
  | 'XOR'         // Логический элемент исключающее ИЛИ (^)
  | 'RS_FF'       // RS-триггер
  | 'D_FF'        // D-триггер
  | 'JK_FF'       // JK-триггер
  | 'JUNCTION'    // Точка соединения / Узел (ГОСТ 2.702)
  | 'TEXT';       // Текст / Директива (.define, .param)

export interface CircuitPin {
  id: string;
  name: string;
  label?: string;
  x: number; // relative to component center (grid units or px)
  y: number;
}

export interface CircuitElement {
  id: string;
  type: ComponentType;
  name: string;         // e.g. "R1", "C_load", "U1", "OUT"
  x: number;            // X coordinate on canvas (snapped to 20px grid)
  y: number;            // Y coordinate on canvas
  rotation: number;     // degrees, including 45-degree increments
  flipH?: boolean;
  flipV?: boolean;
  /** Simulation treatment of this element while its wires remain connected. */
  isolation?: 'open' | 'short';
  // Parameters
  value: number;        // Primary value (e.g. 1000 for 1k)
  valueStr: string;     // Text presentation (e.g. "1k", "50n", "220")
  unit: string;         // "Ом", "Гн", "Ф", "В", "А", "Гц"
  secondaryValue?: number; // e.g. frequency 1000, dutyCycle 0.5, V_peak
  secondaryStr?: string;
  initialCondition?: number; // IC (начальное условие тока/напряжения)
  /** Parameters of the documented piecewise-linear semiconductor/control models. */
  modelParams?: {
    forwardVoltage?: number; // V, diode/thyristor conducting threshold
    onResistance?: number; // Ohm
    offResistance?: number; // Ohm
    gateThreshold?: number; // V, relative to terminal 2
    holdingCurrent?: number; // A, thyristor turn-off threshold
    outputLimit?: number; // V, op-amp symmetric output rail
    turnsRatio?: number; // secondary/primary winding turns, TR3
    couplingFactor?: number; // magnetic coupling, 0 < k < 1
    logicHigh?: number; // internally supplied high output rail, V
    logicLow?: number; // internally supplied low output rail, V
    logicThreshold?: number; // analog-to-digital switching level, V
    outputResistance?: number; // digital output's Thevenin resistance, Ohm
    propagationDelay?: number; // digital transition delay, s
    hysteresis?: number; // comparator differential hysteresis, V
  };
  portName?: string;    // Name of port (e.g. "IN", "OUT", "GATE")
  textDirective?: string; // Text content for TEXT component
}

export interface CircuitWire {
  id: string;
  fromCompId: string;
  fromPinId: string;
  toCompId: string;
  toPinId: string;
  /** Optional user-set horizontal, vertical, or 45-degree route points. */
  waypoints?: Array<{ x: number; y: number }>;
  /** Explicitly user-routed wire; also preserves a single straight 45-degree segment. */
  manual?: boolean;
}

export interface TransientSignalConfig {
  id: string;
  plotIndex: 1 | 2 | 3 | 4; // Номер графика (группировка кривых)
  exprX: string;            // Выражение по оси X (по умолчанию "t")
  exprY: string;            // Выражение по оси Y (например "U(out)", "I(VD1)", "P(R1)")
  color: string;            // Hex color (#2563eb, #dc2626, etc.)
  enabled: boolean;
}

export interface TransientSettings {
  tMax: number;             // Конечное время расчета, с
  tMaxStr: string;          // Например, "10m" или "tmax"
  step: number;             // Шаг расчета, с
  stepStr: string;          // "tmax/200" или "10u"
  eps: number;              // Погрешность (EPS), например 0.001
  initialConditionTransfer?: boolean; // Опция передачи конечных переменных состояния в качестве IC
  signals: TransientSignalConfig[];
}

export interface ACSignalConfig {
  id: string;
  plotIndex: 1 | 2;         // 1 - АЧХ (дБ), 2 - ФЧХ (град)
  exprX: string;            // "f"
  exprY: string;            // "db(U(OUT)/U(IN))", "phs(U(OUT)/U(IN))", "mag(...)"
  color: string;
  enabled: boolean;
}

export interface ACSettings {
  fMin: number;             // Начальная частота, Гц
  fMinStr?: string;         // "10"
  fMax: number;             // Конечная частота, Гц
  fMaxStr?: string;         // "100k"
  points: number;           // Число расчетных точек
  scaleType: 'log' | 'linear'; // Тип шкалы развертки
  signals: ACSignalConfig[];
}

export interface ParameterSweepSettings {
  elementId: string;        // ID или имя элемента, например "R3" или "U2"
  propertyName: string;     // 'R' | 'C' | 'L' | 'value' | 'frequency' | 'duty'
  startVal: number;
  startValStr?: string;
  endVal: number;
  endValStr?: string;
  steps: number;
  scaleType: 'linear' | 'log';
  signalExpr: string;       // например "U(OUT)"
}

export interface CircuitSimulationResults {
  elementVoltages?: Record<string, number[]>;
  derivation?: {
    method: string;
    notes: string[];
    steps: CalculationStep[][];
    signalSources: Record<string, string>;
  };
  model?: 'linear-mna' | 'topology-mna';
  time: number[];
  signals: Record<string, number[]>; // key: signal expression (e.g. "U(OUT)")
  nodeVoltages: Record<string, number[]>;
  branchCurrents: Record<string, number[]>;
  complexNodeVoltages?: Record<string, Array<{ re: number; im: number }>>;
  complexBranchCurrents?: Record<string, Array<{ re: number; im: number }>>;
  digitalStates?: Record<string, Array<0 | 1 | 'X'>>;
  isAC?: boolean;
  frequency?: number[];
  sweepInfo?: {
    paramName: string;
    values: number[];
  };
  summary: {
    durationMs: number;
    pointsCount: number;
    calculationTimeMs: number;
    stats: Record<string, {
      mean: number;
      rms: number;
      max: number;
      min: number;
      unit: string;
    }>;
  };
}

export interface CalculationStep {
  name: string;
  formula: string;
  substitution: string;
  value: number;
  unit: string;
}
