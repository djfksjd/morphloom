import type {
  AssemblyComponentIR,
  AssemblyIR,
  ElectricalHarnessIR,
  ElectricalPortIR,
  ElectricalSignalIR,
  ElectricalWireIR,
} from './assembly-ir';

const material = (color: string, metalness = 0.08, roughness = 0.48) => ({ color, metalness, roughness });

function box(
  id: string,
  name: string,
  category: AssemblyComponentIR['category'],
  materialName: string,
  detail: string,
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  radius = 2,
  metalness = 0.08,
): AssemblyComponentIR {
  return {
    id, name, category, materialName, detail,
    geometry: { op: 'roundedBox', size, radius, segments: 4 },
    position,
    material: material(color, metalness),
  };
}

function createCoolingHarness(): ElectricalHarnessIR {
  const ports: ElectricalPortIR[] = [];
  const wires: ElectricalWireIR[] = [];
  const port = (
    componentId: string,
    pin: string,
    signal: ElectricalSignalIR,
    position: [number, number, number] = [0, 0, 0],
    maxConnections = 1,
  ) => {
    const id = `${componentId}_${pin}`;
    ports.push({ id, componentId, pin, signal, position, direction: [0, 1, 0], required: true, maxConnections });
    return id;
  };
  const wire = (
    id: string,
    net: string,
    signal: ElectricalSignalIR,
    from: string,
    to: string,
    color: string,
    diameter = 0.62,
  ) => wires.push({ id, name: net, net, signal, from, to, color, diameter, shielded: signal === 'data' || signal === 'sensor' });

  const powerLinks: Array<[string, string, ElectricalSignalIR, string, string, string, number?]> = [
    ['wire_12v_monitor', 'VIN_12V_MON', 'power', port('power_board', '12v_mon', 'power', [-10, 5, 0]), port('ina260', 'vin', 'power', [-5, 3, 0]), '#df4f3f', 0.9],
    ['wire_monitor_ground', 'GND_MON', 'ground', port('power_board', 'gnd_mon', 'ground', [-5, 5, 0]), port('ina260', 'gnd_in', 'ground', [5, 3, 0]), '#252a31', 0.9],
    ['wire_motor_power', 'TEC_12V', 'power', port('ina260', 'vout', 'power', [-5, -3, 0]), port('cytron', 'vin', 'power', [-7, 4, 0]), '#e35c46', 0.9],
    ['wire_motor_ground', 'TEC_GND', 'ground', port('ina260', 'gnd_out', 'ground', [5, -3, 0]), port('cytron', 'gnd', 'ground', [7, 4, 0]), '#252a31', 0.9],
    ['wire_tec_positive', 'TEC_POS', 'power', port('cytron', 'out_pos', 'power', [-7, -4, 0]), port('tec', 'positive', 'power', [-8, -2, 20]), '#f0644e', 1.1],
    ['wire_tec_negative', 'TEC_NEG', 'ground', port('cytron', 'out_neg', 'ground', [7, -4, 0]), port('tec', 'negative', 'ground', [8, -2, 20]), '#26313a', 1.1],
    ['wire_fan_power', 'FAN_12V', 'power', port('power_board', 'fan_12v', 'power', [0, 5, 0]), port('fan', 'vdd', 'power', [-8, 7.5, 0]), '#d95744', 0.72],
    ['wire_fan_ground', 'FAN_GND', 'ground', port('power_board', 'fan_gnd', 'ground', [5, 5, 0]), port('fan', 'gnd', 'ground', [-3, 7.5, 0]), '#252a31', 0.72],
    ['wire_controller_5v', 'LOGIC_5V', 'power', port('power_board', 'logic_5v', 'power', [10, 5, 0]), port('esp32', 'vin', 'power', [-6, 4, 0]), '#e06c42', 0.62],
    ['wire_controller_ground', 'LOGIC_GND', 'ground', port('power_board', 'logic_gnd', 'ground', [15, 5, 0]), port('esp32', 'gnd', 'ground', [6, 4, 0]), '#252a31', 0.62],
  ];
  powerLinks.forEach(([id, net, signal, from, to, color, diameter]) => wire(id, net, signal, from, to, color, diameter));

  const logicModules: Array<[string, string]> = [['ads1115', 'ADC'], ['mux', 'MUX'], ['sht40', 'SHT'], ['ina260', 'MON']];
  logicModules.forEach(([componentId, label], index) => {
    wire(`wire_${componentId}_3v3`, `${label}_3V3`, 'power', port('esp32', `3v3_${index + 1}`, 'power', [-10 + index * 5, -4, 0]), port(componentId, 'vdd', 'power', [-3, 3, 0]), '#d96b43', 0.42);
    wire(`wire_${componentId}_ground`, `${label}_GND`, 'ground', port('esp32', `gnd_${index + 1}`, 'ground', [-8 + index * 5, -4, 0]), port(componentId, 'gnd', 'ground', [3, 3, 0]), '#252a31', 0.42);
  });

  const i2cModules: Array<[string, string]> = [['ads1115', 'ADC'], ['sht40', 'SHT'], ['ina260', 'MON']];
  i2cModules.forEach(([componentId, label], index) => {
    wire(`wire_${componentId}_sda`, `${label}_SDA`, 'data', port('esp32', `sda_${index + 1}`, 'data', [-7 + index * 4, 0, 0]), port(componentId, 'sda', 'data', [-2, -3, 0]), '#62aee6', 0.32);
    wire(`wire_${componentId}_scl`, `${label}_SCL`, 'data', port('esp32', `scl_${index + 1}`, 'data', [-5 + index * 4, 0, 0]), port(componentId, 'scl', 'data', [2, -3, 0]), '#e5c957', 0.32);
  });

  for (let select = 0; select < 4; select += 1) {
    wire(
      `wire_mux_s${select}`,
      `MUX_S${select}`,
      'control',
      port('esp32', `mux_s${select}`, 'control', [-8 + select * 5, -2, 0]),
      port('mux', `s${select}`, 'control', [-6 + select * 4, -3, 0]),
      '#bd89dc',
      0.34,
    );
  }
  wire('wire_mux_adc', 'NTC_MUX_OUT', 'sensor', port('mux', 'common', 'sensor', [0, 0, 0]), port('ads1115', 'a0', 'sensor', [0, 0, 0]), '#63c7a5', 0.38);
  wire('wire_fan_pwm', 'FAN_PWM', 'control', port('esp32', 'fan_pwm', 'control', [8, 0, 0]), port('fan', 'pwm', 'control', [3, 7.5, 0]), '#bd89dc', 0.38);
  wire('wire_fan_tach', 'FAN_TACH', 'sensor', port('fan', 'tach', 'sensor', [8, 7.5, 0]), port('esp32', 'fan_tach', 'sensor', [10, 0, 0]), '#61c8a5', 0.38);

  for (let sensor = 1; sensor <= 6; sensor += 1) {
    const x = -20 + (sensor - 1) * 8;
    wire(
      `wire_ntc_${sensor}_sense`,
      `NTC_CH${sensor - 1}`,
      'sensor',
      port(`ntc_${sensor}`, 'sense', 'sensor', [-1, 0, 0]),
      port('mux', `ch${sensor - 1}`, 'sensor', [x * 0.35, 0, 0]),
      '#e18058',
      0.34,
    );
    wire(
      `wire_ntc_${sensor}_ground`,
      `NTC_GND_${sensor}`,
      'ground',
      port(`ntc_${sensor}`, 'gnd', 'ground', [1, 0, 0]),
      port('mux', `sensor_gnd_${sensor}`, 'ground', [x * 0.35, 2, 0]),
      '#252a31',
      0.34,
    );
  }

  return { ports, wires, endpointToleranceMm: 0.05, portToleranceMm: 0.25 };
}

const components: AssemblyComponentIR[] = [
  box('cold_plate', 'AL6061 냉각판', 'mechanical', 'AL6061 알루미늄', '이미지 표기 280×180×5 mm 냉각판', [280, 5, 180], [0, 118, 0], '#aeb9c0', 5, 0.82),
  box('contact_pad', 'TP-3 접촉패드', 'mechanical', '열전도 실리콘', '이미지 표기 1.0 mm 열 인터페이스 패드', [150, 1, 100], [0, 94, 0], '#6d9f9b', 1),
  box('tec', 'TEC1-12706 펠티어 모듈', 'power', '알루미나/비스무트 텔루라이드', '12 V 6 A 열전 모듈 · 내부 소자는 inferred', [40, 4, 40], [0, 76, 0], '#e5e3dd', 1),
  box('copper_base', 'C1100 구리 베이스', 'mechanical', 'C1100 무산소동', 'AXP90 접촉 베이스 형상은 이미지에서 추정', [140, 3, 110], [0, 61, 0], '#b86637', 2, 0.88),
  box('heatsink_fins', 'AXP90 핀스택', 'mechanical', '알루미늄/구리', '4×Ø6 heatpipe 표기의 저형 핀스택', [132, 24, 108], [0, 38, 0], '#a9ada9', 3, 0.76),
  {
    id: 'fan', name: 'TL-9015 PWM 팬', category: 'mechanical', materialName: 'PBT/유리섬유',
    detail: '이미지 표기 92×15 mm PWM 팬 · 블레이드 세부는 inferred',
    geometry: { op: 'cylinder', radiusTop: 46, radiusBottom: 46, depth: 15, radialSegments: 64 },
    position: [0, 10, 0], material: material('#343c42', 0.12, 0.62),
  },
  box('service_frame', 'ASA 서비스 프레임', 'enclosure', 'ASA', 'M3 인서트를 갖는 정비용 외곽 프레임', [310, 12, 205], [0, -24, 0], '#38434a', 8),
  box('power_board', '전원·퓨즈·5V 벅 보드', 'power', 'FR-4/구리', '12 V 10 A 입력, 퓨즈, 5 V 벅 변환', [66, 14, 34], [-112, 26, 88], '#253f37', 3),
  box('esp32', 'ESP32-S3 N16R8 제어 코어', 'logic', 'FR-4/실리콘', '이미지 표기의 주 제어 모듈', [48, 10, 30], [112, 34, 84], '#21463b', 3),
  box('ads1115', 'ADS1115 16-bit ADC', 'logic', 'FR-4/실리콘', 'I²C 0x48 고해상도 ADC', [30, 8, 24], [-92, 50, 72], '#255044', 2),
  box('mux', 'CD74HC4067 MUX', 'logic', 'FR-4/실리콘', 'NTC CH0…5 아날로그 멀티플렉서', [38, 8, 24], [-56, 42, 72], '#244c40', 2),
  box('sht40', 'SHT40 온습도 센서', 'logic', 'FR-4/MEMS', 'I²C 0x44 온습도 센서', [22, 7, 18], [-118, 72, 70], '#275348', 2),
  box('ina260', 'INA260 전력 감시', 'logic', 'FR-4/실리콘', 'I²C 0x40 전류·전압·전력 감시', [30, 8, 24], [82, 50, 76], '#244c40', 2),
  box('cytron', 'Cytron TEC 드라이버', 'power', 'FR-4/MOSFET', 'TEC 양방향/출력 제어부 · 모델명은 이미지 일부 가림', [48, 12, 34], [116, 7, 78], '#263f38', 3),
];

for (let sensor = 1; sensor <= 6; sensor += 1) {
  components.push({
    id: `ntc_${sensor}`, name: `NTC 10K B3950 센서 ${sensor}`, category: 'logic', materialName: '에폭시/구리',
    detail: `냉각판 표면 채널 TH${sensor - 1} · 위치는 이미지에서 inferred`,
    geometry: { op: 'sphere', radius: 2.2, widthSegments: 20, heightSegments: 12 },
    position: [-55 + (sensor - 1) * 22, 122, sensor % 2 ? -38 : 38], material: material('#28363a', 0.18, 0.4),
  });
}

for (let pipe = 0; pipe < 4; pipe += 1) {
  components.push({
    id: `heatpipe_${pipe + 1}`, name: `Ø6 히트파이프 ${pipe + 1}`, category: 'mechanical', materialName: '니켈도금 구리',
    detail: 'AXP90 베이스와 핀스택을 잇는 개별 히트파이프 · 경로 inferred',
    geometry: {
      op: 'tube', radius: 3, radialSegments: 12, tubularSegments: 72,
      points: [[-56, 57, -30 + pipe * 20], [-24, 46, -30 + pipe * 20], [22, 42, -30 + pipe * 20], [58, 48, -30 + pipe * 20]],
    },
    material: material('#b9a27b', 0.86, 0.28),
  });
}

export const COOLING_ASSEMBLY_IR: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'Image-derived TEC cooling assembly',
  units: 'mm',
  components,
  electrical: createCoolingHarness(),
  metadata: {
    source: 'user-supplied exploded electronics reference',
    sourceWidth: 2038,
    sourceHeight: 1268,
    evidencePolicy: 'visible labels measured; hidden geometry and routes marked inferred',
  },
};
