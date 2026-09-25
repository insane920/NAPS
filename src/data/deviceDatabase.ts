import { PowerDevice } from '../types';

export const POWER_DEVICES: PowerDevice[] = [
  // =================== ТИРИСТОРЫ (THYRISTORS) ===================
  {
    id: 't161-160',
    name: 'Т161-160 (Протон-Электротекс)',
    type: 'thyristor',
    manufacturer: 'Протон-Электротекс',
    iNom: 160,          // I_T(AV) = 160 A
    iMaxRep: 480,       // I_TRM = 480 A
    uNom: 1600,         // V_DRM / V_RRM = 1600 В
    v0: 1.15,           // V_T(TO) = 1.15 В
    rd: 0.0018,         // r_T = 1.8 мОм
    eOn: 45,            // мДж
    eOff: 80,           // мДж
    tRecover: 150000,   // t_q = 150 мкс
    tjMax: 125,         // °C
    rthJC: 0.17,        // °C/Вт
    rthCS: 0.08,
    rthSA: 0.25,
    description: 'Силовой штыревой тиристор низкочастотный для выпрямителей и приводов постоянного тока.',
  },
  {
    id: 't253-800',
    name: 'Т253-800 (Таблеточный)',
    type: 'thyristor',
    manufacturer: 'Протон-Электротекс',
    iNom: 800,          // I_T(AV) = 800 A
    iMaxRep: 2500,      // I_TRM = 2500 A
    uNom: 1800,         // V_DRM = 1800 В
    v0: 1.05,
    rd: 0.00035,        // 0.35 мОм
    eOn: 150,
    eOff: 350,
    tRecover: 250000,
    tjMax: 125,
    rthJC: 0.035,
    rthCS: 0.015,
    rthSA: 0.08,
    description: 'Мощный таблеточный тиристор для тяговых преобразователей и сварочных выпрямителей.',
  },
  {
    id: 'skt-250-16e',
    name: 'SKT 250/16E (Semikron)',
    type: 'thyristor',
    manufacturer: 'Semikron Danfoss',
    iNom: 250,
    iMaxRep: 750,
    uNom: 1600,
    v0: 1.08,
    rd: 0.00095,
    eOn: 60,
    eOff: 110,
    tRecover: 180000,
    tjMax: 130,
    rthJC: 0.12,
    rthCS: 0.05,
    rthSA: 0.18,
    description: 'Европейский стандартный фазовый тиристор для промышленных сетей 380/660 В.',
  },

  // =================== СИЛОВЫЕ ДИОДЫ (DIODES) ===================
  {
    id: 'v200',
    name: 'В200 (Силовой вентиль)',
    type: 'diode',
    manufacturer: 'Саранск ОАО Электровыпрямитель',
    iNom: 200,          // I_F(AV) = 200 A
    iMaxRep: 600,
    uNom: 1200,         // V_RRM = 1200 В
    v0: 0.92,
    rd: 0.0011,
    eOn: 0,
    eOff: 15,
    tRecover: 8000,     // 8 мкс
    tjMax: 140,
    rthJC: 0.14,
    rthCS: 0.06,
    rthSA: 0.22,
    description: 'Классический силовой выпрямительный диод штыревого типа для мостовых схем.',
  },
  {
    id: 'd161-200',
    name: 'Д161-200 (Протон-Электротекс)',
    type: 'diode',
    manufacturer: 'Протон-Электротекс',
    iNom: 200,
    iMaxRep: 620,
    uNom: 1600,
    v0: 0.88,
    rd: 0.00095,
    eOn: 0,
    eOff: 20,
    tRecover: 6000,
    tjMax: 150,
    rthJC: 0.13,
    rthCS: 0.05,
    rthSA: 0.20,
    description: 'Надежный диффузионный диод широкого применения для выпрямительных агрегатов.',
  },
  {
    id: 'skn-240-16',
    name: 'SKN 240/16 (Semikron)',
    type: 'diode',
    manufacturer: 'Semikron Danfoss',
    iNom: 240,
    iMaxRep: 720,
    uNom: 1600,
    v0: 0.85,
    rd: 0.0008,
    eOn: 0,
    eOff: 25,
    tRecover: 5000,
    tjMax: 180,
    rthJC: 0.11,
    rthCS: 0.04,
    rthSA: 0.16,
    description: 'Высокотемпературный мощный диод с предельной температурой кристалла до 180°C.',
  },

  // =================== IGBT МОДУЛИ И ТРАНЗИСТОРЫ ===================
  {
    id: 'ff450r12ke4',
    name: 'FF450R12KE4 (Infineon)',
    type: 'igbt',
    manufacturer: 'Infineon Technologies',
    iNom: 450,          // I_C = 450 A
    iMaxRep: 900,       // I_CRM = 900 A
    uNom: 1200,         // V_CES = 1200 В
    v0: 1.15,           // V_CE0 = 1.15 В
    rd: 0.0016,         // r_CE = 1.6 мОм (V_CE(sat) typ 1.75V @ 450A)
    eOn: 40,            // 40 мДж
    eOff: 45,           // 45 мДж
    tRecover: 350,      // 350 нс
    tjMax: 150,
    rthJC: 0.085,
    rthCS: 0.035,
    rthSA: 0.12,
    description: 'Сдвоенный полумостовой 62mm IGBT-модуль 1200V 450A 4-го поколения Trench/Fieldstop.',
  },
  {
    id: 'skm200gb12t4',
    name: 'SKM200GB12T4 (Semikron)',
    type: 'igbt',
    manufacturer: 'Semikron Danfoss',
    iNom: 200,
    iMaxRep: 400,
    uNom: 1200,
    v0: 1.20,
    rd: 0.0035,
    eOn: 18,
    eOff: 22,
    tRecover: 280,
    tjMax: 175,
    rthJC: 0.15,
    rthCS: 0.05,
    rthSA: 0.20,
    description: 'Популярный полумостовой модуль SEMITRANS 2 для ЧРП и автономных инверторов.',
  },
  {
    id: 'cm300dx-24s',
    name: 'CM300DX-24S (Mitsubishi)',
    type: 'igbt',
    manufacturer: 'Mitsubishi Electric',
    iNom: 300,
    iMaxRep: 600,
    uNom: 1200,
    v0: 1.10,
    rd: 0.0022,
    eOn: 24,
    eOff: 28,
    tRecover: 300,
    tjMax: 150,
    rthJC: 0.11,
    rthCS: 0.04,
    rthSA: 0.14,
    description: 'Высоконадежный промышленный модуль 6-го поколения NX-серии.',
  },

  // =================== MOSFET И SiC ТРАНЗИСТОРЫ ===================
  {
    id: 'irfp460',
    name: 'IRFP460 (Vishay / IR)',
    type: 'mosfet',
    manufacturer: 'Vishay Siliconix',
    iNom: 20,           // I_D = 20 A
    iMaxRep: 80,        // I_DM = 80 A
    uNom: 500,          // V_DSS = 500 В
    v0: 0.0,
    rd: 0.27,           // R_DS(on) = 0.27 Ом
    eOn: 0.8,           // мДж
    eOff: 0.7,
    tRecover: 570,
    tjMax: 150,
    rthJC: 0.45,
    rthCS: 0.24,
    rthSA: 0.85,
    description: 'Классический дискретный N-канальный кремниевый MOSFET в корпусе TO-247AC.',
  },
  {
    id: 'ipw65r019c7',
    name: 'IPW65R019C7 CoolMOS (Infineon)',
    type: 'mosfet',
    manufacturer: 'Infineon Technologies',
    iNom: 75,
    iMaxRep: 235,
    uNom: 650,          // V_DSS = 650 В
    v0: 0.0,
    rd: 0.019,          // R_DS(on) = 19 мОм!
    eOn: 0.15,
    eOff: 0.12,
    tRecover: 120,
    tjMax: 150,
    rthJC: 0.32,
    rthCS: 0.15,
    rthSA: 0.60,
    description: 'Суперджанкшн CoolMOS C7 с рекордно низким R_DS(on) для высокочастотных преобразователей.',
  },
  {
    id: 'c3m0065090d',
    name: 'C3M0065090D SiC MOSFET (Wolfspeed)',
    type: 'mosfet',
    manufacturer: 'Wolfspeed / Cree',
    iNom: 36,
    iMaxRep: 90,
    uNom: 900,          // V_DSS = 900 В
    v0: 0.0,
    rd: 0.065,          // 65 мОм
    eOn: 0.08,
    eOff: 0.05,
    tRecover: 18,       // 18 нс! Сверхбыстрый SiC
    tjMax: 175,
    rthJC: 0.65,
    rthCS: 0.20,
    rthSA: 0.75,
    description: 'Карбидокремниевый (SiC) транзистор для эффективных высокочастотных Buck/Boost и инверторов.',
  },
];
