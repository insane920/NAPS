import { ConverterParameters, TopologyType } from '../types';

export interface ConverterTopologyMeta {
  type: TopologyType;
  title: string;
  shortTitle: string;
  category: 'rectifier' | 'dcdc' | 'inverter';
  defaultDevice: string;
  defaultParams: ConverterParameters;
  description: string;
  theoreticalFormulaHint: string;
}

export const CONVERTER_TOPOLOGIES: ConverterTopologyMeta[] = [
  {
    type: 'rectifier-1p',
    title: 'Однофазный мостовой выпрямитель',
    shortTitle: '1-Ф Мост',
    category: 'rectifier',
    defaultDevice: 'd161-200',
    defaultParams: {
      uIn: 220,          // В (действующее напряжение сети)
      freq: 50,          // Гц
      rLoad: 10,         // Ом
      lLoad: 0.05,       // Гн
      cLoad: 0.001,      // 1000 мкФ
      eEmf: 0,           // В
      alpha: 0,          // град (0 = диодный, >0 = тиристорный)
      dutyCycle: 0.5,
      fSwitch: 50,
      safetyFactor: 1.3,
      tAmbient: 25,
      displayCycles: 2,
      simulationMode: 'steady-state',
    },
    description: 'Двухполупериодная однофазная мостовая схема выпрямления с емкостно-индуктивным сглаживанием или противо-ЭДС.',
    theoreticalFormulaHint: 'I_mean(диод) = 0.45·U_in / R_нагр (для активной нагрузки)',
  },
  {
    type: 'rectifier-3p',
    title: 'Трехфазный мостовой выпрямитель (Ларионов)',
    shortTitle: '3-Ф Ларионов',
    category: 'rectifier',
    defaultDevice: 't161-160',
    defaultParams: {
      uIn: 380,          // В (линейное)
      freq: 50,          // Гц
      rLoad: 5,          // Ом
      lLoad: 0.02,       // Гн
      cLoad: 0.002,      // Ф
      eEmf: 200,         // Противо-ЭДС тягового двигателя
      alpha: 30,         // Угол управления
      dutyCycle: 0.5,
      fSwitch: 50,
      safetyFactor: 1.3,
      tAmbient: 30,
      displayCycles: 2,
      simulationMode: 'steady-state',
    },
    description: 'Шестипульсная мостовая схема выпрямления Ларионова (6 вентилей) для мощных промышленных нагрузок.',
    theoreticalFormulaHint: 'U_d0 = 2.34·U_ф = 1.35·U_лин (при alpha=0)',
  },
  {
    type: 'buck',
    title: 'Импульсный понижающий регулятор (Buck Converter)',
    shortTitle: 'DC-DC Buck',
    category: 'dcdc',
    defaultDevice: 'ipw65r019c7',
    defaultParams: {
      uIn: 400,          // В (постоянное входное)
      freq: 20000,       // Гц
      rLoad: 4,          // Ом
      lLoad: 0.001,      // 1 мГн
      cLoad: 0.00047,    // 470 мкФ
      eEmf: 0,
      alpha: 0,
      dutyCycle: 0.4,    // D = 0.4 -> U_out approx 160 В
      fSwitch: 20000,    // 20 кГц
      safetyFactor: 1.4,
      tAmbient: 35,
      displayCycles: 3,
      simulationMode: 'steady-state',
    },
    description: 'Понижающий импульсный чоппер с LC-фильтром: U_вых = D·U_вх, I_key,mean = D·I_нагр.',
    theoreticalFormulaHint: 'U_out = D · U_in;  I_key,rms = sqrt(D) · I_out',
  },
  {
    type: 'boost',
    title: 'Импульсный повышающий регулятор (Boost Converter)',
    shortTitle: 'DC-DC Boost',
    category: 'dcdc',
    defaultDevice: 'c3m0065090d',
    defaultParams: {
      uIn: 200,          // В
      freq: 40000,       // Гц
      rLoad: 25,         // Ом
      lLoad: 0.0008,     // 0.8 мГн
      cLoad: 0.00022,    // 220 мкФ
      eEmf: 0,
      alpha: 0,
      dutyCycle: 0.5,    // D = 0.5 -> U_out approx 400 В
      fSwitch: 40000,    // 40 кГц
      safetyFactor: 1.4,
      tAmbient: 30,
      displayCycles: 3,
      simulationMode: 'steady-state',
    },
    description: 'Повышающий регулятор постоянного напряжения: накопление энергии в индукторе при включении ключа.',
    theoreticalFormulaHint: 'U_out = U_in / (1 - D);  U_key,max = U_out',
  },
  {
    type: 'buck-boost',
    title: 'Понижающе-повышающий регулятор (Buck-Boost)',
    shortTitle: 'DC-DC Buck-Boost',
    category: 'dcdc',
    defaultDevice: 'c3m0065090d',
    defaultParams: {
      uIn: 300,          // В
      freq: 30000,       // Гц
      rLoad: 15,         // Ом
      lLoad: 0.0015,     // 1.5 мГн
      cLoad: 0.00033,    // 330 мкФ
      eEmf: 0,
      alpha: 0,
      dutyCycle: 0.45,   // D = 0.45
      fSwitch: 30000,
      safetyFactor: 1.4,
      tAmbient: 35,
      displayCycles: 3,
      simulationMode: 'steady-state',
    },
    description: 'Инвертирующий регулятор с передаточной характеристикой U_вых = -U_вх · D / (1 - D).',
    theoreticalFormulaHint: '|U_out| = U_in · D / (1 - D);  U_key,max = U_in + |U_out|',
  },
  {
    type: 'inverter-1p',
    title: 'Однофазный мостовой инвертор напряжения',
    shortTitle: 'АИН Мост',
    category: 'inverter',
    defaultDevice: 'skm200gb12t4',
    defaultParams: {
      uIn: 350,          // В DC
      freq: 50,          // Гц (выходная частота переменного тока)
      rLoad: 8,          // Ом
      lLoad: 0.02,       // Гн
      cLoad: 0.00005,    // 50 мкФ
      eEmf: 0,
      alpha: 0,
      dutyCycle: 0.5,
      fSwitch: 5000,     // 5 кГц ШИМ
      safetyFactor: 1.35,
      tAmbient: 25,
      displayCycles: 2,
      simulationMode: 'steady-state',
    },
    description: 'Четырехключевой мостовой инвертор (АИН) с ШИМ модуляцией для питания индуктивной нагрузки.',
    theoreticalFormulaHint: 'U_1m = 4/pi · U_d (прямоугольная модуляция) или M · U_d (ШИМ)',
  },
];

export interface PresetScenario {
  id: string;
  name: string;
  topology: TopologyType;
  deviceId: string;
  params: ConverterParameters;
  description: string;
}

export const PRESET_SCENARIOS: PresetScenario[] = [
  {
    id: 'benchmark-ideal-rectifier',
    name: 'Тест 1: Аналитический эталон (ГОСТ раздел 5)',
    topology: 'rectifier-1p',
    deviceId: 'v200',
    params: {
      uIn: 220,
      freq: 50,
      rLoad: 10,
      lLoad: 0,          // Чисто активная нагрузка для точного совпадения с ТОЭ
      cLoad: 0,
      eEmf: 0,
      alpha: 0,
      dutyCycle: 0.5,
      fSwitch: 50,
      safetyFactor: 1.3,
      tAmbient: 25,
      displayCycles: 2,
      simulationMode: 'steady-state',
    },
    description: 'Классический эталон раздела 5 ТЗ: однофазный выпрямитель на чисто активную нагрузку R=10 Ом. Погрешность с теорией <= 1.5%.',
  },
  {
    id: 'thyristor-dc-drive',
    name: 'Тиристорный выпрямитель привода ДПТ (R-L-E)',
    topology: 'rectifier-1p',
    deviceId: 't161-160',
    params: {
      uIn: 220,
      freq: 50,
      rLoad: 2.5,
      lLoad: 0.08,
      cLoad: 0,
      eEmf: 120,         // Противо-ЭДС якоря электродвигателя
      alpha: 45,         // Угол фазового регулирования 45 град
      dutyCycle: 0.5,
      fSwitch: 50,
      safetyFactor: 1.4,
      tAmbient: 30,
      displayCycles: 2,
      simulationMode: 'steady-state',
    },
    description: 'Управляемый тиристорный электропривод постоянного тока с противо-ЭДС вращения якоря E=120 В и сглаживающим дросселем.',
  },
  {
    id: 'larionov-industrial',
    name: 'Промышленный выпрямитель Ларионова 380В',
    topology: 'rectifier-3p',
    deviceId: 't253-800',
    params: {
      uIn: 380,
      freq: 50,
      rLoad: 1.8,
      lLoad: 0.03,
      cLoad: 0.005,
      eEmf: 350,
      alpha: 20,
      dutyCycle: 0.5,
      fSwitch: 50,
      safetyFactor: 1.3,
      tAmbient: 35,
      displayCycles: 2,
      simulationMode: 'steady-state',
    },
    description: 'Мощный трехфазный преобразователь на таблеточных тиристорах Т253-800 для гальванического цеха.',
  },
  {
    id: 'buck-chopper-high-power',
    name: 'Импульсный понижающий чоппер 400В -> 160В',
    topology: 'buck',
    deviceId: 'ipw65r019c7',
    params: {
      uIn: 400,
      freq: 20000,
      rLoad: 4,
      lLoad: 0.0012,
      cLoad: 0.00047,
      eEmf: 0,
      alpha: 0,
      dutyCycle: 0.4,
      fSwitch: 20000,
      safetyFactor: 1.35,
      tAmbient: 30,
      displayCycles: 3,
      simulationMode: 'steady-state',
    },
    description: 'Высокочастотный импульсный преобразователь на суперджанкшн MOSFET CoolMOS C7.',
  },
  {
    id: 'boost-pfc-solar',
    name: 'Повышающий Boost-преобразователь (SiC 40 кГц)',
    topology: 'boost',
    deviceId: 'c3m0065090d',
    params: {
      uIn: 200,
      freq: 40000,
      rLoad: 25,
      lLoad: 0.0008,
      cLoad: 0.00022,
      eEmf: 0,
      alpha: 0,
      dutyCycle: 0.5,
      fSwitch: 40000,
      safetyFactor: 1.4,
      tAmbient: 35,
      displayCycles: 3,
      simulationMode: 'steady-state',
    },
    description: 'Повышающий преобразователь солнечной генерации / ККМ на карбидокремниевом SiC MOSFET Wolfspeed.',
  },
  {
    id: 'inverter-sinusoidal-drive',
    name: 'Автономный инвертор напряжения АИН 350В',
    topology: 'inverter-1p',
    deviceId: 'skm200gb12t4',
    params: {
      uIn: 350,
      freq: 50,
      rLoad: 6,
      lLoad: 0.025,
      cLoad: 0.00005,
      eEmf: 0,
      alpha: 0,
      dutyCycle: 0.5,
      fSwitch: 4000,
      safetyFactor: 1.3,
      tAmbient: 25,
      displayCycles: 2,
      simulationMode: 'steady-state',
    },
    description: 'Мостовой инвертор на IGBT модуле Semikron SKM200GB12T4 для питания индуктивной нагрузки.',
  },
];
