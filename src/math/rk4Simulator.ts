import {
  AnalyticalBenchmarkResult,
  ConverterParameters,
  DeviceVerification,
  PowerDevice,
  SimulationPoint,
  SimulationResult,
  TopologyType,
} from '../types';

/**
 * Численный симулятор электромагнитных процессов в вентильных преобразователях
 * Модели переходных процессов и контрольный сценарий RK4.
 */

export function simulateConverter(
  topology: TopologyType,
  params: ConverterParameters,
  device: PowerDevice
): SimulationResult {
  const {
    uIn,
    freq,
    rLoad,
    lLoad,
    cLoad,
    eEmf,
    alpha,
    dutyCycle,
    fSwitch,
    tAmbient,
    displayCycles,
    simulationMode,
  } = params;

  // Базовый период процесса
  const baseFreq = (topology === 'buck' || topology === 'boost' || topology === 'buck-boost')
    ? fSwitch
    : freq;
  const T = 1 / Math.max(1, baseFreq);

  // Шаг моделирования: не менее 1200 точек на отображаемый интервал
  const totalCycles = simulationMode === 'steady-state' ? 8 + displayCycles : displayCycles;
  const pointsPerCycle = 600;
  const dt = T / pointsPerCycle;
  const totalSteps = totalCycles * pointsPerCycle;

  // Состояние цепи: ток индуктивности iL, напряжение емкости uC
  let iL = 0;
  // Для схем с емкостью инициализируем uC близким к установившемуся, если steady-state
  let uC = 0;
  if (simulationMode === 'steady-state') {
    if (topology === 'rectifier-1p') {
      uC = Math.max(0, uIn * 0.9);
      iL = Math.max(0, (uC - eEmf) / Math.max(0.1, rLoad));
    } else if (topology === 'rectifier-3p') {
      uC = Math.max(0, uIn * 1.35);
      iL = Math.max(0, (uC - eEmf) / Math.max(0.1, rLoad));
    } else if (topology === 'buck') {
      uC = uIn * dutyCycle;
      iL = uC / Math.max(0.1, rLoad);
    } else if (topology === 'boost') {
      uC = uIn / Math.max(0.05, 1 - dutyCycle);
      iL = (uC * (uC / Math.max(0.1, rLoad))) / Math.max(1, uIn);
    } else if (topology === 'buck-boost') {
      uC = (uIn * dutyCycle) / Math.max(0.05, 1 - dutyCycle);
      iL = (uC * (uC / Math.max(0.1, rLoad))) / Math.max(1, uIn);
    }
  }

  const v0 = device.v0;
  const rd = Math.max(0.0001, device.rd);
  const alphaRad = (alpha * Math.PI) / 180;
  const omega = 2 * Math.PI * freq;

  // Массив точек только для финального отображаемого окна
  const recordedPoints: SimulationPoint[] = [];
  const startRecordingStep = (totalCycles - displayCycles) * pointsPerCycle;

  for (let step = 0; step < totalSteps; step++) {
    const t = step * dt;
    const tInCycle = t % T;
    const phase = (omega * t) % (2 * Math.PI);

    let iKey = 0;
    let uKey = 0;
    let iLoad = 0;
    let uLoad = 0;
    let gate = 0;

    switch (topology) {
      // ====================================================================
      // 1. ОДНОФАЗНЫЙ МОСТОВОЙ ВЫПРЯМИТЕЛЬ (1-Phase Bridge)
      // ====================================================================
      case 'rectifier-1p': {
        const uSrc = Math.SQRT2 * uIn * Math.sin(omega * t);
        const absUSrc = Math.abs(uSrc);
        const halfPeriodPhase = (omega * t) % Math.PI;

        // Условие отпирания вентиля (тиристорный угол alpha или диодный естественный)
        const isTriggered = halfPeriodPhase >= alphaRad;
        const forwardVoltageAvailable = absUSrc > (2 * v0 + eEmf + (cLoad > 0 ? uC : 0));

        let conducts = false;
        if (isTriggered && (forwardVoltageAvailable || iL > 0.001)) {
          conducts = true;
        }

        if (conducts) {
          // Дифференциальное уравнение: L di/dt + R*i = |uSrc| - 2*V0 - 2*rd*i - E
          const drivingV = absUSrc - 2 * v0 - eEmf;
          const effectiveR = rLoad + 2 * rd;

          if (lLoad > 1e-6) {
            // RK4 для diL/dt = (drivingV - effectiveR * iL) / lLoad
            const f = (current: number) => (drivingV - effectiveR * current) / lLoad;
            const k1 = f(iL);
            const k2 = f(iL + 0.5 * dt * k1);
            const k3 = f(iL + 0.5 * dt * k2);
            const k4 = f(iL + dt * k3);
            iL += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
            if (iL < 0) iL = 0;
          } else {
            // Чисто активная нагрузка L = 0
            iL = Math.max(0, drivingV / effectiveR);
          }
        } else {
          // Вентили закрыты
          if (lLoad > 1e-6) {
            iL = Math.max(0, iL * Math.exp(-dt * (rLoad / lLoad)));
          } else {
            iL = 0;
          }
        }

        iLoad = iL;
        uLoad = cLoad > 0 ? uC : Math.max(0, iLoad * rLoad + eEmf);

        // Фильтрующий конденсатор (если задан)
        if (cLoad > 1e-6) {
          const ic = (conducts ? iL : 0) - uC / rLoad;
          uC += (dt / cLoad) * ic;
          if (uC < 0) uC = 0;
        }

        // Ключ плеча 1 (исследуемый полупроводниковый прибор)
        // Проводит ток в положительный полупериод uSrc > 0
        const isPosHalf = uSrc > 0;
        gate = isTriggered ? 1 : 0;

        if (isPosHalf && conducts && iL > 0) {
          iKey = iL;
          uKey = v0 + rd * iKey;
        } else if (isPosHalf && !conducts) {
          iKey = 0;
          uKey = uSrc; // Прямое блокирующее напряжение до подачи отпирающего импульса
        } else {
          // Отрицательный полупериод — обратное блокирующее напряжение
          iKey = 0;
          uKey = -absUSrc;
        }
        break;
      }

      // ====================================================================
      // 2. ТРЕХФАЗНЫЙ МОСТОВОЙ ВЫПРЯМИТЕЛЬ (Ларионов, 6-пульсный)
      // ====================================================================
      case 'rectifier-3p': {
        const uPhasePeak = Math.SQRT2 * (uIn / Math.sqrt(3));
        const ua = uPhasePeak * Math.sin(omega * t);
        const ub = uPhasePeak * Math.sin(omega * t - (2 * Math.PI) / 3);
        const uc = uPhasePeak * Math.sin(omega * t + (2 * Math.PI) / 3);

        // Линейные напряжения
        const uab = ua - ub;
        const ubc = ub - uc;
        const uca = uc - ua;
        const uba = -uab;
        const ucb = -ubc;
        const uac = -uca;

        // Мгновенная огибающая 6-пульсного выпрямителя со сдвигом alpha
        const shiftedT = t - alphaRad / omega;
        const shiftedPhase = (omega * shiftedT) % ((2 * Math.PI) / 6);
        const uLinePeak = Math.SQRT2 * uIn;
        const instantaneousRectU = uLinePeak * Math.cos(shiftedPhase - Math.PI / 6);

        const drivingV = instantaneousRectU - 2 * v0 - eEmf;
        const effectiveR = rLoad + 2 * rd;

        if (lLoad > 1e-6) {
          const f = (current: number) => (drivingV - effectiveR * current) / lLoad;
          const k1 = f(iL);
          const k2 = f(iL + 0.5 * dt * k1);
          const k3 = f(iL + 0.5 * dt * k2);
          const k4 = f(iL + dt * k3);
          iL += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
          if (iL < 0) iL = 0;
        } else {
          iL = Math.max(0, drivingV / effectiveR);
        }

        iLoad = iL;
        uLoad = Math.max(0, iLoad * rLoad + eEmf);

        // Исследуемый вентиль (фаза A, катодная группа, открыт 120 электрических градусов)
        const valve1Phase = ((omega * t - alphaRad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const conductsValve1 = valve1Phase >= Math.PI / 6 && valve1Phase <= (5 * Math.PI) / 6;

        gate = conductsValve1 ? 1 : 0;
        if (conductsValve1 && iL > 0) {
          iKey = iL;
          uKey = v0 + rd * iKey;
        } else {
          iKey = 0;
          // В закрытом состоянии напряжение на вентиле равно разности фазного напряжения и потенциала общей шины
          uKey = -uLinePeak * Math.abs(Math.sin(valve1Phase));
        }
        break;
      }

      // ====================================================================
      // 3. ПОНИЖАЮЩИЙ РЕГУЛЯТОР (BUCK CONVERTER)
      // ====================================================================
      case 'buck': {
        const switchOn = tInCycle < dutyCycle * T;
        gate = switchOn ? 1 : 0;

        // RK4 для переменных состояния цепи [iL, uC]
        const dState = (ilVal: number, ucVal: number) => {
          let dil: number;
          if (switchOn) {
            dil = (uIn - ucVal - (v0 + rd * ilVal)) / Math.max(1e-6, lLoad);
          } else {
            // Диод проводит ток дросселя при выключенном ключе
            if (ilVal > 0) {
              dil = (-ucVal - 0.7) / Math.max(1e-6, lLoad);
            } else {
              dil = 0;
            }
          }
          const duc = (ilVal - ucVal / Math.max(0.1, rLoad)) / Math.max(1e-6, cLoad);
          return { dil, duc };
        };

        const s1 = dState(iL, uC);
        const s2 = dState(iL + 0.5 * dt * s1.dil, uC + 0.5 * dt * s1.duc);
        const s3 = dState(iL + 0.5 * dt * s2.dil, uC + 0.5 * dt * s2.duc);
        const s4 = dState(iL + dt * s3.dil, uC + dt * s3.duc);

        iL += (dt / 6) * (s1.dil + 2 * s2.dil + 2 * s3.dil + s4.dil);
        uC += (dt / 6) * (s1.duc + 2 * s2.duc + 2 * s3.duc + s4.duc);
        if (iL < 0) iL = 0;
        if (uC < 0) uC = 0;

        iLoad = uC / Math.max(0.1, rLoad);
        uLoad = uC;

        if (switchOn) {
          iKey = iL;
          uKey = v0 + rd * iKey;
        } else {
          iKey = 0;
          uKey = uIn; // Напряжение на ключе равно входному напряжению
        }
        break;
      }

      // ====================================================================
      // 4. ПОВЫШАЮЩИЙ РЕГУЛЯТОР (BOOST CONVERTER)
      // ====================================================================
      case 'boost': {
        const switchOn = tInCycle < dutyCycle * T;
        gate = switchOn ? 1 : 0;

        const dState = (ilVal: number, ucVal: number) => {
          let dil: number;
          let duc: number;
          if (switchOn) {
            dil = (uIn - rd * ilVal) / Math.max(1e-6, lLoad);
            duc = -ucVal / (Math.max(0.1, rLoad) * Math.max(1e-6, cLoad));
          } else {
            if (ilVal > 0) {
              dil = (uIn - ucVal - 0.7) / Math.max(1e-6, lLoad);
              duc = (ilVal - ucVal / Math.max(0.1, rLoad)) / Math.max(1e-6, cLoad);
            } else {
              dil = 0;
              duc = -ucVal / (Math.max(0.1, rLoad) * Math.max(1e-6, cLoad));
            }
          }
          return { dil, duc };
        };

        const s1 = dState(iL, uC);
        const s2 = dState(iL + 0.5 * dt * s1.dil, uC + 0.5 * dt * s1.duc);
        const s3 = dState(iL + 0.5 * dt * s2.dil, uC + 0.5 * dt * s2.duc);
        const s4 = dState(iL + dt * s3.dil, uC + dt * s3.duc);

        iL += (dt / 6) * (s1.dil + 2 * s2.dil + 2 * s3.dil + s4.dil);
        uC += (dt / 6) * (s1.duc + 2 * s2.duc + 2 * s3.duc + s4.duc);
        if (iL < 0) iL = 0;
        if (uC < 0) uC = 0;

        iLoad = uC / Math.max(0.1, rLoad);
        uLoad = uC;

        if (switchOn) {
          iKey = iL;
          uKey = rd * iKey;
        } else {
          iKey = 0;
          uKey = uC; // При выключении напряжение на ключе = выходному
        }
        break;
      }

      // ====================================================================
      // 5. ПОНИЖАЮЩЕ-ПОВЫШАЮЩИЙ РЕГУЛЯТОР (BUCK-BOOST)
      // ====================================================================
      case 'buck-boost': {
        const switchOn = tInCycle < dutyCycle * T;
        gate = switchOn ? 1 : 0;

        const dState = (ilVal: number, ucVal: number) => {
          let dil: number;
          let duc: number;
          if (switchOn) {
            dil = (uIn - rd * ilVal) / Math.max(1e-6, lLoad);
            duc = -ucVal / (Math.max(0.1, rLoad) * Math.max(1e-6, cLoad));
          } else {
            if (ilVal > 0) {
              dil = (-ucVal - 0.7) / Math.max(1e-6, lLoad);
              duc = (ilVal - ucVal / Math.max(0.1, rLoad)) / Math.max(1e-6, cLoad);
            } else {
              dil = 0;
              duc = -ucVal / (Math.max(0.1, rLoad) * Math.max(1e-6, cLoad));
            }
          }
          return { dil, duc };
        };

        const s1 = dState(iL, uC);
        const s2 = dState(iL + 0.5 * dt * s1.dil, uC + 0.5 * dt * s1.duc);
        const s3 = dState(iL + 0.5 * dt * s2.dil, uC + 0.5 * dt * s2.duc);
        const s4 = dState(iL + dt * s3.dil, uC + dt * s3.duc);

        iL += (dt / 6) * (s1.dil + 2 * s2.dil + 2 * s3.dil + s4.dil);
        uC += (dt / 6) * (s1.duc + 2 * s2.duc + 2 * s3.duc + s4.duc);
        if (iL < 0) iL = 0;
        if (uC < 0) uC = 0;

        iLoad = uC / Math.max(0.1, rLoad);
        uLoad = uC;

        if (switchOn) {
          iKey = iL;
          uKey = rd * iKey;
        } else {
          iKey = 0;
          uKey = uIn + uC; // Сумма входного и выходного напряжений
        }
        break;
      }

      // ====================================================================
      // 6. ОДНОФАЗНЫЙ АВТОНОМНЫЙ ИНВЕРТОР НАПРЯЖЕНИЯ (АИН)
      // ====================================================================
      case 'inverter-1p': {
        // Синусоидальная ШИМ (SPWM)
        const carrier = (2 * Math.abs((t * fSwitch) % 1 - 0.5)) * 2 - 1; // Треугольная несущая [-1, 1]
        const reference = Math.sin(omega * t); // Модулирующая синусоида
        const pwmHigh = reference > carrier;

        const uBridge = pwmHigh ? uIn : -uIn;
        gate = pwmHigh ? 1 : 0;

        // RL нагрузка: L di/dt + R*i = uBridge
        const f = (current: number) => (uBridge - (rLoad + 2 * rd) * current) / Math.max(1e-6, lLoad);
        const k1 = f(iL);
        const k2 = f(iL + 0.5 * dt * k1);
        const k3 = f(iL + 0.5 * dt * k2);
        const k4 = f(iL + dt * k3);
        iL += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);

        iLoad = iL;
        uLoad = uBridge;

        // Исследуемый транзистор VT1 верхней группы
        if (pwmHigh && iL > 0) {
          iKey = iL;
          uKey = v0 + rd * iKey;
        } else if (!pwmHigh) {
          iKey = 0;
          uKey = uIn;
        } else {
          // Обратный диод ключа проводит реактивный ток
          iKey = 0;
          uKey = -0.8;
        }
        break;
      }
    }

    // Сохраняем точку, если наступило окно записи
    if (step >= startRecordingStep) {
      recordedPoints.push({
        t: (step - startRecordingStep) * dt,
        iKey: Number(iKey.toFixed(4)),
        uKey: Number(uKey.toFixed(2)),
        iLoad: Number(iLoad.toFixed(4)),
        uLoad: Number(uLoad.toFixed(2)),
        gate,
        iL: Number(iL.toFixed(4)),
        uC: Number(uC.toFixed(2)),
      });
    }
  }

  // ========================================================================
  // РАСЧЕТ ИНТЕГРАЛЬНЫХ ВЕЛИЧИН ЗА 1 УСТАНОВИВШИЙСЯ ПЕРИОД T (РАЗДЕЛ 3.2 ТЗ)
  // ========================================================================
  const pointsInOneCycle = recordedPoints.slice(0, pointsPerCycle);
  const n = pointsInOneCycle.length;

  let sumI = 0;
  let sumI2 = 0;
  let maxI = 0;
  let maxU = 0;
  let sumULoad = 0;
  let sumULoad2 = 0;
  let sumILoad = 0;
  let minULoad = Infinity;
  let maxULoad = -Infinity;

  for (let i = 0; i < n; i++) {
    const pt = pointsInOneCycle[i];
    sumI += pt.iKey;
    sumI2 += pt.iKey * pt.iKey;
    if (pt.iKey > maxI) maxI = pt.iKey;

    const absUKey = Math.abs(pt.uKey);
    if (absUKey > maxU) maxU = absUKey;

    sumULoad += pt.uLoad;
    sumULoad2 += pt.uLoad * pt.uLoad;
    sumILoad += pt.iLoad;

    if (pt.uLoad < minULoad) minULoad = pt.uLoad;
    if (pt.uLoad > maxULoad) maxULoad = pt.uLoad;
  }

  // Интегралы методом трапеций: 1/T int_0^T f(t) dt approx (1/n) * sum
  const iMean = sumI / n;
  const iRms = Math.sqrt(sumI2 / n);
  const formFactor = iMean > 1e-4 ? iRms / iMean : 1;
  const uLoadMean = sumULoad / n;
  const uLoadRms = Math.sqrt(sumULoad2 / n);
  const iLoadMean = sumILoad / n;

  // Пульсации выходного напряжения: k_пульс = (Umax - Umin) / (2 * Umean) * 100%
  const uRipplePercent = Math.abs(uLoadMean) > 1e-3
    ? Math.min(100, Math.max(0, ((maxULoad - minULoad) / (2 * Math.abs(uLoadMean))) * 100))
    : 0;

  // Мощность статических потерь проводимости: P_cond = V0 * I_mean + Rd * I_rms^2
  const pCond = v0 * iMean + rd * iRms * iRms;

  // Мощность динамических коммутационных потерь:
  // Для транзисторов (IGBT, MOSFET): P_sw = (E_on + E_off) * 1e-3 * f_sw * (I_mean / I_nom)
  // Для диодов/тиристоров: потери выключения за счет Q_rr
  let pSw = 0;
  if (device.type === 'igbt' || device.type === 'mosfet') {
    const swFreq = (topology === 'buck' || topology === 'boost' || topology === 'buck-boost')
      ? fSwitch
      : (topology === 'inverter-1p' ? fSwitch : freq);
    const scaling = Math.min(2, Math.max(0.1, iMean / Math.max(1, device.iNom)));
    pSw = (device.eOn + device.eOff) * 1e-3 * swFreq * scaling;
  } else {
    // Тиристоры / Диоды: низкочастотные коммутационные потери
    pSw = 0.5 * maxU * (device.tRecover * 1e-9) * Math.max(1, iMean) * freq;
  }

  const pLoss = pCond + pSw;
  const pLoad = Math.abs(uLoadMean * iLoadMean);

  // Тепловой расчет кристалла: T_j = T_a + P_loss * (R_th_jc + R_th_cs + R_th_sa)
  const rthTotal = device.rthJC + device.rthCS + device.rthSA;
  const tJunction = tAmbient + pLoss * rthTotal;

  return {
    points: recordedPoints,
    period: T,
    timeStep: dt,
    iMean: Number(iMean.toFixed(3)),
    iRms: Number(iRms.toFixed(3)),
    iMax: Number(maxI.toFixed(2)),
    uMax: Number(maxU.toFixed(1)),
    formFactor: Number(formFactor.toFixed(3)),
    uLoadMean: Number(uLoadMean.toFixed(2)),
    uLoadRms: Number(uLoadRms.toFixed(2)),
    iLoadMean: Number(iLoadMean.toFixed(3)),
    uRipplePercent: Number(uRipplePercent.toFixed(2)),
    pCond: Number(pCond.toFixed(2)),
    pSw: Number(pSw.toFixed(2)),
    pLoss: Number(pLoss.toFixed(2)),
    pLoad: Number(pLoad.toFixed(1)),
    tJunction: Number(tJunction.toFixed(1)),
  };
}

/**
 * Верификация прибора по предельным параметрам с учетом коэффициента запаса k_зап
 * (Раздел 3.3 ТЗ)
 */
export function verifyDeviceSafety(
  sim: SimulationResult,
  device: PowerDevice,
  safetyFactor: number
): DeviceVerification {
  const k = safetyFactor;

  // 1. Проверка по току (для тиристоров/диодов проверяем средний ток, для транзисторов - действующий)
  const isTransistor = device.type === 'igbt' || device.type === 'mosfet';
  const actualCurrent = isTransistor ? sim.iRms : sim.iMean;
  const currentLimit = device.iNom;
  const currentAllowed = currentLimit / k;
  const currentPassed = actualCurrent <= currentAllowed;
  const currentMargin = ((currentAllowed - actualCurrent) / currentAllowed) * 100;

  // 2. Проверка по импульсному пиковому току
  const actualPeak = sim.iMax;
  const peakLimit = device.iMaxRep;
  const peakAllowed = peakLimit / k;
  const peakPassed = actualPeak <= peakAllowed;
  const peakMargin = ((peakAllowed - actualPeak) / peakAllowed) * 100;

  // 3. Проверка по блокирующему напряжению
  const actualVoltage = sim.uMax;
  const voltageLimit = device.uNom;
  const voltageAllowed = voltageLimit / k;
  const voltagePassed = actualVoltage <= voltageAllowed;
  const voltageMargin = ((voltageAllowed - actualVoltage) / voltageAllowed) * 100;

  // 4. Проверка по тепловому режиму
  const actualTemp = sim.tJunction;
  const tempLimit = device.tjMax;
  const tempPassed = actualTemp <= tempLimit;
  const tempMargin = tempLimit - actualTemp;

  const allPassed = currentPassed && peakPassed && voltagePassed && tempPassed;
  const hasCriticalDanger = !currentPassed || !voltagePassed || !tempPassed;

  let status: 'ok' | 'warning' | 'danger' = 'ok';
  let statusTitle = 'Режим допустим (соответствует требованиям ТЗ)';
  let statusBadge = 'РЕЖИМ ДОПУСТИМ';

  if (hasCriticalDanger) {
    status = 'danger';
    statusTitle = 'Превышение предельных параметров ключа!';
    statusBadge = 'ПРЕВЫШЕНИЕ ПРЕДЕЛЬНЫХ ПАРАМЕТРОВ';
  } else if (!peakPassed) {
    status = 'warning';
    statusTitle = 'Внимание: превышен запас по пиковому току';
    statusBadge = 'ПРЕДУПРЕЖДЕНИЕ: МАЛЫЙ ЗАПАС';
  }

  const details: string[] = [];
  if (!currentPassed) {
    details.push(
      `Перегрузка по току: расчетное значение ${actualCurrent.toFixed(1)} А превышает допустимый предел с запасом k_зап=${k} (${currentAllowed.toFixed(1)} А).`
    );
  }
  if (!voltagePassed) {
    details.push(
      `Перенапряжение на ключе: пиковое напряжение ${actualVoltage.toFixed(1)} В превышает допустимое U_ном/k_зап = ${voltageAllowed.toFixed(1)} В.`
    );
  }
  if (!peakPassed) {
    details.push(
      `Импульсный ток I_max = ${actualPeak.toFixed(1)} А превышает безопасный предел I_max,rep/k_зап = ${peakAllowed.toFixed(1)} А.`
    );
  }
  if (!tempPassed) {
    details.push(
      `Тепловой пробой: расчетная температура кристалла T_j = ${actualTemp.toFixed(1)} °C превышает абсолютный максимум T_j,max = ${tempLimit} °C.`
    );
  }
  if (allPassed) {
    details.push(
      `Все электрические и тепловые параметры силового ключа укладываются в нормы с коэффициентом запаса k_зап = ${k.toFixed(2)}. Ресурс надежности обеспечен.`
    );
  }

  return {
    status,
    statusTitle,
    statusBadge,
    currentCheck: {
      label: isTransistor ? 'Действующий ток ключа I_rms' : 'Средний ток ключа I_mean',
      actual: actualCurrent,
      limit: currentLimit,
      allowedWithMargin: currentAllowed,
      unit: 'А',
      passed: currentPassed,
      marginPercent: Number(currentMargin.toFixed(1)),
    },
    peakCurrentCheck: {
      label: 'Максимальный пиковый ток I_max',
      actual: actualPeak,
      limit: peakLimit,
      allowedWithMargin: peakAllowed,
      unit: 'А',
      passed: peakPassed,
      marginPercent: Number(peakMargin.toFixed(1)),
    },
    voltageCheck: {
      label: 'Амплитуда напряжения на ключе U_max',
      actual: actualVoltage,
      limit: voltageLimit,
      allowedWithMargin: voltageAllowed,
      unit: 'В',
      passed: voltagePassed,
      marginPercent: Number(voltageMargin.toFixed(1)),
    },
    thermalCheck: {
      actual: actualTemp,
      limit: tempLimit,
      passed: tempPassed,
      marginDeg: Number(tempMargin.toFixed(1)),
      unit: '°C',
    },
    details,
  };
}

/**
 * Контрольные испытания: Тест 1 (Аналитический эталон)
 * Контрольный сценарий для RK4.
 * Моделирование классического однофазного выпрямителя на активную нагрузку.
 * Сравнение вычисленных I_mean и I_rms с классическими формулами из ТОЭ:
 * I_mean(диод) = sqrt(2) * U_in / (pi * R)
 * I_rms(диод) = sqrt(2) * U_in / (2 * R) = U_in / (sqrt(2) * R)
 * Допустимая погрешность: <= 1.5%
 */
export function runAnalyticalBenchmark(uIn = 220, rLoad = 10): AnalyticalBenchmarkResult {
  // Теоретические формулы для идеального вентиля
  const uPeak = Math.SQRT2 * uIn;
  const theoryIMean = uPeak / (Math.PI * rLoad); // approx 9.903 A
  const theoryIRms = uPeak / (2 * rLoad);        // approx 15.556 A

  // Численный симулятор для идеализированного диода (v0 = 0, rd = 0, L = 0)
  const idealDevice: PowerDevice = {
    id: 'ideal-diode',
    name: 'Идеальный диод (Эталон)',
    type: 'diode',
    manufacturer: 'ГОСТ Эталон',
    iNom: 1000,
    iMaxRep: 3000,
    uNom: 2000,
    v0: 0.0,
    rd: 0.00001,
    eOn: 0,
    eOff: 0,
    tRecover: 0,
    tjMax: 200,
    rthJC: 0.01,
    rthCS: 0.01,
    rthSA: 0.01,
    description: 'Математически идеализированный вентиль без потерь.',
  };

  const simParams: ConverterParameters = {
    uIn,
    freq: 50,
    rLoad,
    lLoad: 0,
    cLoad: 0,
    eEmf: 0,
    alpha: 0,
    dutyCycle: 0.5,
    fSwitch: 50,
    safetyFactor: 1.3,
    tAmbient: 25,
    displayCycles: 2,
    simulationMode: 'steady-state',
  };

  const simResult = simulateConverter('rectifier-1p', simParams, idealDevice);

  const numericalIMean = simResult.iMean;
  const numericalIRms = simResult.iRms;

  const errorIMean = Math.abs((numericalIMean - theoryIMean) / theoryIMean) * 100;
  const errorIRms = Math.abs((numericalIRms - theoryIRms) / theoryIRms) * 100;

  const maxAllowedError = 1.5; // Погрешность численного метода не более 1.5% по ТЗ
  const passed = errorIMean <= maxAllowedError && errorIRms <= maxAllowedError;

  return {
    theoryIMean: Number(theoryIMean.toFixed(4)),
    theoryIRms: Number(theoryIRms.toFixed(4)),
    numericalIMean: Number(numericalIMean.toFixed(4)),
    numericalIRms: Number(numericalIRms.toFixed(4)),
    errorIMean: Number(errorIMean.toFixed(3)),
    errorIRms: Number(errorIRms.toFixed(3)),
    maxAllowedError,
    passed,
    notes: passed
      ? `Контрольные испытания пройдены успешно: погрешность I_mean (${errorIMean.toFixed(2)}%) и I_rms (${errorIRms.toFixed(2)}%) строго укладывается в норматив ГОСТ <= ${maxAllowedError}%.`
      : `Внимание: погрешность превысила норматив ${maxAllowedError}%.`,
  };
}
