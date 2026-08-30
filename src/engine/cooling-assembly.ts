import type {
  AssemblyComponentIR,
  AssemblyIR,
  ElectricalHarnessIR,
  ElectricalPortIR,
  ElectricalSignalIR,
  ElectricalWireIR,
  EvidenceStatusIR,
  SurfaceFinishIR,
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
  surface?: SurfaceFinishIR,
  evidence: EvidenceStatusIR = 'estimated',
): AssemblyComponentIR {
  return {
    id, name, category, materialName, detail,
    geometry: { op: 'roundedBox', size, radius, segments: 4 },
    position,
    material: { ...material(color, metalness), surface },
    evidence: { status: evidence },
  };
}

export const NTC_PROBE_LAYOUT_MM: Array<[number, number, number]> = [
  [-55, 53.8, 0], [55, 53.8, 0],
  [-55, 47.2, 0], [55, 47.2, 0],
  [-112, 56, 0], [112, 56, 0],
  [0, 56, -65], [0, 56, 65],
];

function createCoolingHarness(): ElectricalHarnessIR {
  const ports: ElectricalPortIR[] = [];
  const wires: ElectricalWireIR[] = [];
  const port = (
    componentId: string,
    pin: string,
    signal: ElectricalSignalIR,
    position: [number, number, number] = [0, 0, 0],
    physicalPin = pin,
    direction: [number, number, number] = [0, 1, 0],
  ) => {
    const id = `${componentId}_${pin}`;
    ports.push({ id, componentId, pin, physicalPin, signal, position, direction, required: true, maxConnections: 1 });
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
    shielded = signal === 'data' || signal === 'sensor',
    gauge = '24AWG',
    verification: ElectricalWireIR['verification'] = 'datasheet',
  ) => wires.push({ id, name: net, net, signal, from, to, color, diameter, shielded, gauge, verification });

  const zones = [
    { suffix: 'a', monitor: 'ina260', driver: 'md10c', fuse: 'tf1', tec: 'tec', pwm: 4 },
    { suffix: 'b', monitor: 'ina260B', driver: 'md10cB', fuse: 'tf1B', tec: 'tecB', pwm: 5 },
  ] as const;
  zones.forEach((zone, index) => {
    const side = zone.suffix.toUpperCase();
    wire(`w_12v_mon_${zone.suffix}`, `P12V_TEC_${side}`, 'power', port('power', `12v_sw_${zone.suffix}`, 'power', [-16 + index * 8, 7, 5], `F${index + 2} 7.5A OUT`), port(zone.monitor, 'vin_plus', 'power', [-10, 4, 0], 'VIN+'), '#e45442', 1, false, '16AWG');
    wire(`w_12v_drive_${zone.suffix}`, `P12V_TEC_${side}_MON`, 'power', port(zone.monitor, 'vin_minus', 'power', [10, 4, 0], 'VIN-'), port(zone.driver, 'vm_plus', 'power', [-17, 6, 10], 'VM+'), '#f0644e', 1, false, '16AWG');
    wire(`w_drive_gnd_${zone.suffix}`, `GND_DRIVE_${side}`, 'ground', port('power', `drive_gnd_${zone.suffix}`, 'ground', [-8 + index * 8, 7, 5], 'STAR GND'), port(zone.driver, 'gnd', 'ground', [17, 6, 10], 'GND'), '#252a31', 1, false, '16AWG');
    wire(`w_tec_pre_fuse_${zone.suffix}`, `TEC_${side}_POS_PRE_TF`, 'power', port(zone.driver, 'm_plus', 'power', [-17, 6, -12], 'M+'), port(zone.fuse, 'input', 'power', [-7, 0, 0], 'LEAD 1'), '#f0644e', 1.15, false, '16AWG', 'bench-required');
    wire(`w_tec_pos_${zone.suffix}`, `TEC_${side}_POS_FUSED`, 'power', port(zone.fuse, 'output', 'power', [7, 0, 0], 'LEAD 2'), port(zone.tec, 'positive', 'power', [16, -2, 15], 'RED/+'), '#f0644e', 1.15, false, '16AWG', 'bench-required');
    wire(`w_tec_neg_${zone.suffix}`, `TEC_${side}_NEG`, 'ground', port(zone.driver, 'm_minus', 'ground', [17, 6, -12], 'M-'), port(zone.tec, 'negative', 'ground', [16, -2, 11], 'BLACK/-'), '#26313a', 1.15, false, '16AWG', 'bench-required');
    wire(`w_tec_pwm_${zone.suffix}`, `TEC_PWM_${side}`, 'control', port('esp32', `gpio${zone.pwm}`, 'control', [-18 + index * 5, 4, 10], `GPIO${zone.pwm}`), port(zone.driver, 'pwm', 'control', [-6, 6, -17], 'PWM'), '#bd89dc', 0.36);
  });

  const fanPins: Array<[string, ElectricalSignalIR, number, string]> = [
    ['vdd', 'power', -3, 'PIN2 +12V'], ['gnd', 'ground', -1, 'PIN1 GND'],
    ['tach', 'sensor', 1, 'PIN3 TACH'], ['pwm', 'control', 3, 'PIN4 PWM'],
  ];
  const fanPort = (pin: string) => {
    const item = fanPins.find(([name]) => name === pin)!;
    return port('fan_connector', item[0], item[1], [item[2], 0, 0], item[3], [0, 0, 1]);
  };
  wire('w_fan_12v', 'P12V_FAN', 'power', port('power', 'fan_12v', 'power', [2, 7, 5], '12V FAN OUT'), fanPort('vdd'), '#d95744', 0.72, false, '22AWG');
  wire('w_fan_gnd', 'GND_FAN', 'ground', port('power', 'fan_gnd', 'ground', [5, 7, 5], 'STAR GND'), fanPort('gnd'), '#252a31', 0.72, false, '22AWG');
  wire('w_fan_pwm_in', 'FAN_PWM_GPIO', 'control', port('esp32', 'gpio6', 'control', [20, 4, -2], 'GPIO6'), port('interface', 'q1_base_in', 'control', [-18, 4, 8], 'R1 IN'), '#bd89dc', 0.38);
  wire('w_fan_pwm_oc', 'FAN_PWM_OC', 'control', port('interface', 'q1_collector', 'control', [-10, 4, 8], 'Q1 COLLECTOR'), fanPort('pwm'), '#bd89dc', 0.38);
  wire('w_fan_tach_in', 'FAN_TACH_RAW', 'sensor', fanPort('tach'), port('interface', 'tach_in', 'sensor', [0, 4, 8], 'TACH NODE'), '#61c8a5', 0.38, true);
  wire('w_fan_tach_out', 'FAN_TACH_3V3', 'sensor', port('interface', 'tach_out', 'sensor', [5, 4, 8], 'TACH OUT'), port('esp32', 'gpio7', 'sensor', [25, 4, -2], 'GPIO7'), '#61c8a5', 0.38, true);
  wire('w_logic_5v', 'P5V_CTRL', 'power', port('power', 'logic_5v', 'power', [14, 7, 5], 'BUCK 5V OUT'), port('esp32', 'vin', 'power', [-25, 4, 8], 'J1-21 5V'), '#e06c42', 0.62, false, '22AWG');
  wire('w_logic_gnd', 'GND_CTRL', 'ground', port('power', 'logic_gnd', 'ground', [19, 7, 5], 'BUCK GND'), port('esp32', 'gnd', 'ground', [-20, 4, 8], 'J1-22 GND'), '#252a31', 0.62, false, '22AWG');

  const logicModules: Array<{ id: string; label: string; vdd: [number, number, number]; gnd: [number, number, number] }> = [
    { id: 'ads1115', label: 'ADC', vdd: [-10, 4, 8], gnd: [-5, 4, 8] },
    { id: 'mux', label: 'MUX', vdd: [-14, 4, 7], gnd: [-9, 4, 7] },
    { id: 'sensors', label: 'SHT_A', vdd: [-8, 3, 6], gnd: [-3, 3, 6] },
    { id: 'sensorsB', label: 'SHT_B', vdd: [-8, 3, 6], gnd: [-3, 3, 6] },
    { id: 'ina260', label: 'MON_A', vdd: [-7, 4, -8], gnd: [7, 4, -8] },
    { id: 'ina260B', label: 'MON_B', vdd: [-7, 4, -8], gnd: [7, 4, -8] },
  ];
  logicModules.forEach((module, index) => {
    wire(`w_${module.id}_3v3`, 'P3V3_SENSOR', 'power', port('esp32', `3v3_${index}`, 'power', [-14 + index * 7, 4, -9], 'J1-1 3V3'), port(module.id, 'vdd', 'power', module.vdd, 'VCC/VDD'), '#d96b43', 0.42);
    wire(`w_${module.id}_gnd`, 'GND_CTRL', 'ground', port('esp32', `gnd_${index}`, 'ground', [-11 + index * 7, 4, -9], 'GND'), port(module.id, 'gnd', 'ground', module.gnd, 'GND'), '#252a31', 0.42);
  });

  const i2cModules: Array<{ id: string; bus: 0 | 1; sda: [number, number, number]; scl: [number, number, number] }> = [
    { id: 'sensors', bus: 0, sda: [-6, 3, -7], scl: [6, 3, -7] },
    { id: 'ina260', bus: 0, sda: [-3, 4, -10], scl: [3, 4, -10] },
    { id: 'ina260B', bus: 0, sda: [-3, 4, -10], scl: [3, 4, -10] },
    { id: 'sensorsB', bus: 1, sda: [-6, 3, -7], scl: [6, 3, -7] },
  ];
  i2cModules.forEach((module, index) => {
    const sdaGpio = module.bus ? 17 : 8;
    const sclGpio = module.bus ? 18 : 9;
    wire(`w_${module.id}_sda`, `I2C${module.bus}_SDA`, 'data', port('esp32', `sda_${index}`, 'data', [-10 + index * 7, 4, 10], `GPIO${sdaGpio}`), port(module.id, 'sda', 'data', module.sda, 'SDA'), '#62aee6', 0.32, true);
    wire(`w_${module.id}_scl`, `I2C${module.bus}_SCL`, 'data', port('esp32', `scl_${index}`, 'data', [-6 + index * 7, 4, 10], `GPIO${sclGpio}`), port(module.id, 'scl', 'data', module.scl, 'SCL'), '#e5c957', 0.32, true);
  });

  for (let index = 0; index < 4; index += 1) {
    wire(`w_mux_s${index}`, `MUX_S${index}`, 'control', port('esp32', `mux_s${index}`, 'control', [8 + index * 5, 4, 8], `J1-${16 + index} GPIO${10 + index}`), port('mux', `s${index}`, 'control', [-12 + index * 8, 4, -8], `S${index}`), '#bd89dc', 0.34);
  }
  wire('w_mux_adc', 'NTC_MUX_OUT', 'sensor', port('mux', 'common', 'sensor', [0, 4, 8], 'SIG/COMMON'), port('esp32', 'adc1', 'sensor', [0, 4, 9], 'ADC1'), '#63c7a5', 0.38, true, '24AWG', 'design');
  wire('w_mux_en', 'MUX_ENABLE_LOW', 'ground', port('interface', 'mux_en_low', 'ground', [16, 4, -8], 'EN LOW STRAP'), port('mux', 'enable', 'ground', [18, 4, -8], 'EN/E'), '#252a31', 0.34, false, '24AWG', 'design');
  wire('w_fan_q_gnd', 'GND_CTRL_Q1', 'ground', port('interface', 'q_emitter', 'ground', [-6, 4, 8], 'Q1 EMITTER'), port('power', 'q_ground', 'ground', [17, 7, -4], 'STAR GND'), '#252a31', 0.34, false, '24AWG', 'design');
  wire('w_interface_3v3', 'P3V3_BIAS', 'power', port('esp32', '3v3_interface', 'power', [14, 4, -9], 'J1-1 3V3'), port('interface', 'bias_3v3', 'power', [11, 4, -8], '3V3 BUS'), '#d96b43', 0.42, false, '24AWG', 'design');
  wire('w_interface_gnd', 'GND_CTRL_INTERFACE', 'ground', port('power', 'interface_gnd', 'ground', [11, 7, -4], 'STAR GND'), port('interface', 'filter_gnd', 'ground', [6, 4, -8], 'GND BUS'), '#252a31', 0.42, false, '24AWG', 'design');

  for (let index = 0; index < NTC_PROBE_LAYOUT_MM.length; index += 1) {
    const sensorId = `ntc_${index}`;
    wire(`w_ntc_${index}_probe`, `NTC_NODE_${index}`, 'sensor', port(sensorId, 'sense', 'sensor', [-1.2, 0, 0], `TH${index} SIGNAL`, [0, 0, 1]), port('interface', `ntc_probe_${index}`, 'sensor', [-28 + index * 8, 4, 2], `TH${index} DIVIDER NODE`), '#e18058', 0.34, true, '24AWG', 'design');
    wire(`w_ntc_${index}_mux`, `NTC_CH${index}`, 'sensor', port('interface', `ntc_mux_${index}`, 'sensor', [-28 + index * 8, 4, -2], `TH${index} FILTER OUT`), port('mux', `ch${index}`, 'sensor', [-28 + index * 8, 4, 8], `C${index}`), '#e18058', 0.34, true, '24AWG', 'design');
    wire(`w_ntc_${index}_gnd`, `GND_NTC_${index}`, 'ground', port(sensorId, 'gnd', 'ground', [1.2, 0, 0], `TH${index} RETURN`, [0, 0, 1]), port('power', `ntc_gnd_${index}`, 'ground', [-5 + index * 4, 7, -4], 'STAR GND'), '#252a31', 0.34, false, '24AWG', 'design');
  }

  return {
    ports,
    wires,
    endpointToleranceMm: 0.05,
    portToleranceMm: 0.25,
    verificationScope: 'digital graph + live 3D endpoint anchoring; real polarity and continuity remain bench-gated',
    passiveNodes: [
      { ref: 'PD1/F1/F2/F3 + TF-A/B', node: 'USB-C PD -> eFuse -> 12V DC/DC -> branch fuses -> monitors -> MOSFETs -> thermal fuses -> TECs', detail: '두 TEC 전력 가지를 독립 보호합니다.', verification: 'bench-required' },
      { ref: 'Q1 + R1/R2', node: 'GPIO6 -> 4.7k -> Q1; 100k pull-down; collector -> FAN PWM', detail: '부팅 중 팬 PWM이 정의되지 않는 상태를 방지합니다.', verification: 'design' },
      { ref: 'R3', node: '3V3 -> 10k -> FAN_TACH -> GPIO7', detail: '오픈 컬렉터 TACH를 ESP32 전압으로 풀업합니다.', verification: 'datasheet' },
      { ref: 'R10-R17 + C3-C10', node: '3V3 -> 10k -> NTC_NODE_0..7 -> NTC -> GND; node -> 100nF -> GND', detail: '8개 온도 분압과 로컬 저역통과 필터입니다.', verification: 'design' },
      { ref: 'U7 EN', node: 'CD74HC4067 EN -> GND', detail: 'active-low MUX enable을 고정합니다.', verification: 'datasheet' },
      { ref: 'ADC1 + C11', node: 'MUX SIG -> 1k -> ESP32 ADC1; ADC1 -> 100nF -> GND', detail: '생산 보정 대상 아날로그 입력 필터입니다.', verification: 'design' },
      { ref: 'TEC-A/B POLARITY', node: 'MOSFET OUT -> TF-A/B -> TEC red; TEC black -> GND', detail: '냉면 방향은 1A 제한 펄스로 실물 확인해야 합니다.', verification: 'bench-required' },
    ],
    benchChecks: [
      { id: 'power_short', instruction: '전원 차단 상태에서 12V와 GND 사이 단락을 검사합니다.', status: 'required' },
      { id: 'ground_continuity', instruction: '모든 GND 귀환의 연속성과 인접 핀 단락 부재를 검사합니다.', status: 'required' },
      { id: 'logic_rails', instruction: 'TEC를 분리하고 5V·3.3V·I2C 주소를 확인합니다.', status: 'required' },
      { id: 'tec_polarity', instruction: '채널별 1A 제한 1초 펄스로 냉면 방향을 확인합니다.', status: 'required' },
      { id: 'failsafe', instruction: '팬 정지·NTC 단락/단선·SHT40 버스 장애 시 두 TEC 차단을 확인합니다.', status: 'required' },
    ],
  };
}

const components: AssemblyComponentIR[] = [
  box('cold_plate', 'AL6061 냉각판', 'mechanical', 'AL6061 알루미늄', '참조 이미지에 표기된 280×180×5 mm 냉각판', [280, 5, 180], [0, 118, 0], '#aeb9c0', 2.2, 0.82, 'brushed-metal', 'measured'),
  box('contact_pad', 'TP-3 접촉패드', 'mechanical', '열전도 실리콘', '참조 이미지에 표기된 1.0 mm 비전도 열 인터페이스 패드', [150, 1, 100], [0, 101, 0], '#6d9f9b', 0.42, 0.04, 'rubber', 'measured'),
  box('tec', 'TEC1-12706 A', 'power', '알루미나/비스무트 텔루라이드', '좌측 12 V TEC · 냉면 방향은 실물 극성 시험 필요', [40, 4, 40], [-45, 82, 0], '#e5e3dd', 1, 0.04, 'raw', 'datasheet'),
  box('tecB', 'TEC1-12706 B', 'power', '알루미나/비스무트 텔루라이드', '우측 12 V TEC · 냉면 방향은 실물 극성 시험 필요', [40, 4, 40], [45, 82, 0], '#e5e3dd', 1, 0.04, 'raw', 'datasheet'),
  box('tf1', '84°C 열퓨즈 A', 'power', '세라믹/가용합금', 'TEC-A 양극 가지의 비복귀 과열 차단기', [16, 5, 6], [-45, 72, 32], '#d5c8a4', 1, 0.18, 'raw', 'datasheet'),
  box('tf1B', '84°C 열퓨즈 B', 'power', '세라믹/가용합금', 'TEC-B 양극 가지의 비복귀 과열 차단기', [16, 5, 6], [45, 72, 32], '#d5c8a4', 1, 0.18, 'raw', 'datasheet'),
  box('copper_base', 'C1100 공용 열확산판', 'mechanical', 'C1100 무산소동', '두 TEC 열면을 4개 히트파이프로 분산하는 공용 베이스 · 외곽은 추정', [150, 3, 118], [0, 63, 0], '#b86637', 1.35, 0.88, 'machined-copper', 'estimated'),
  box('heatsink_base', '핀스택 베이스 레일', 'mechanical', '니켈도금 구리', '히트파이프와 알루미늄 핀을 결합하는 하부 레일', [150, 3, 118], [0, 50, 0], '#a9ada9', 1, 0.82, 'brushed-metal', 'estimated'),
  {
    id: 'fan_housing', name: '120 mm 슬림 팬 하우징', category: 'mechanical', materialName: 'PBT-GF30',
    detail: '공용 핀스택용 비폐쇄형 링 하우징 · 내부 유로 치수는 inferred',
    geometry: { op: 'torus', radius: 53, tube: 4, radialSegments: 16, tubularSegments: 96 },
    position: [0, 20, 0], rotation: [Math.PI / 2, 0, 0], material: { ...material('#343c42', 0.12, 0.62), surface: 'molded-polymer' },
    evidence: { status: 'inferred', notes: ['Housing detail is not visible in the supplied exploded reference.'] },
  },
  {
    id: 'fan_hub', name: '팬 모터 허브', category: 'mechanical', materialName: 'PBT/베어링 스틸',
    detail: 'PWM 모터와 베어링을 수용하는 중앙 허브',
    geometry: { op: 'cylinder', radiusTop: 18, radiusBottom: 18, depth: 16, radialSegments: 64 },
    position: [0, 20, 0], material: { ...material('#272c31', 0.18, 0.52), surface: 'molded-polymer' }, evidence: { status: 'estimated' },
  },
  box('fan_connector', '4핀 PWM 팬 커넥터', 'interconnect', 'LCP/주석도금 구리', 'PIN1 GND · PIN2 +12V · PIN3 TACH · PIN4 PWM', [12, 6, 4], [57, 20, 0], '#e2ded1', 0.8, 0.22, 'molded-polymer', 'datasheet'),
  box('frame_front', '서비스 프레임 전면 레일', 'enclosure', 'ASA', 'M3 인서트를 갖는 개방형 서비스 프레임', [310, 12, 12], [0, -24, 96], '#38434a', 3, 0.04, 'molded-polymer', 'estimated'),
  box('frame_rear', '서비스 프레임 후면 레일', 'enclosure', 'ASA', 'M3 인서트를 갖는 개방형 서비스 프레임', [310, 12, 12], [0, -24, -96], '#38434a', 3, 0.04, 'molded-polymer', 'estimated'),
  box('frame_left', '서비스 프레임 좌측 레일', 'enclosure', 'ASA', '전자부와 흡배기를 가리지 않는 측면 레일', [12, 12, 180], [-149, -24, 0], '#38434a', 3, 0.04, 'molded-polymer', 'estimated'),
  box('frame_right', '서비스 프레임 우측 레일', 'enclosure', 'ASA', '전자부와 흡배기를 가리지 않는 측면 레일', [12, 12, 180], [149, -24, 0], '#38434a', 3, 0.04, 'molded-polymer', 'estimated'),
  box('controller_pcb', 'AER-01 4층 제어 PCB', 'logic', 'FR-4/2oz 구리', '전력·제어·센서 모듈의 기준 PCB · 회로 배치는 engineering estimate', [260, 1.6, 52], [0, -13, 66], '#174839', 0.7, 0.12, 'pcb-soldermask', 'estimated'),
  box('power', 'USB-C PD·보호·DC/DC', 'power', 'FR-4/구리/자성체', '20V PD 입력을 12V TEC 버스와 5V/3.3V 제어 전원으로 변환', [48, 14, 34], [-104, -5, 66], '#253f37', 2, 0.12, 'pcb-soldermask', 'estimated'),
  box('esp32', 'ESP32-S3-WROOM-1 N8R8', 'logic', 'FR-4/실리콘/RF 실드', '안전 제어와 로컬 추론을 수행하는 주 제어 모듈', [62, 8, 28], [92, -4, 66], '#21463b', 2, 0.12, 'pcb-soldermask', 'datasheet'),
  box('ads1115', 'ADC 입력 필터 뱅크', 'logic', 'FR-4/실리콘', 'MUX 출력을 ESP32 ADC1으로 전달하는 RC 필터 영역', [30, 8, 24], [-72, -4, 66], '#255044', 1.5, 0.1, 'pcb-soldermask', 'estimated'),
  box('mux', 'CD74HC4067 MUX', 'logic', 'FR-4/실리콘', 'NTC CH0…7 아날로그 멀티플렉서', [66, 8, 24], [-29, -4, 66], '#244c40', 1.5, 0.1, 'pcb-soldermask', 'datasheet'),
  box('interface', '팬·NTC 인터페이스', 'logic', 'FR-4/수동소자', 'Q1 팬 PWM·TACH 풀업·8개 NTC 분압과 필터', [80, 8, 30], [25, -4, 66], '#204b3e', 1.5, 0.1, 'pcb-soldermask', 'estimated'),
  box('sensors', 'SHT40-A 온습도', 'logic', 'FR-4/MEMS', 'I2C0 0x44 흡기 온습도 센서', [24, 6, 18], [-125, 7, -70], '#275348', 1.2, 0.08, 'pcb-soldermask', 'datasheet'),
  box('sensorsB', 'SHT40-B 온습도', 'logic', 'FR-4/MEMS', 'I2C1 0x44 흡기 온습도 센서', [24, 6, 18], [125, 7, -70], '#275348', 1.2, 0.08, 'pcb-soldermask', 'datasheet'),
  box('ina260', 'INA226-A 전력 감시', 'logic', 'FR-4/실리콘/션트', 'TEC-A high-side 전압·전류·전력 측정', [32, 8, 25], [72, -4, 66], '#244c40', 1.5, 0.1, 'pcb-soldermask', 'datasheet'),
  box('ina260B', 'INA226-B 전력 감시', 'logic', 'FR-4/실리콘/션트', 'TEC-B high-side 전압·전류·전력 측정', [32, 8, 25], [112, -4, 66], '#244c40', 1.5, 0.1, 'pcb-soldermask', 'datasheet'),
  box('md10c', 'N-MOSFET 전력단 A', 'power', 'FR-4/MOSFET/구리', 'TEC-A 2.5–3A 제한 PWM 전력단', [52, 12, 41], [78, -4, 12], '#263f38', 2, 0.18, 'pcb-soldermask', 'estimated'),
  box('md10cB', 'N-MOSFET 전력단 B', 'power', 'FR-4/MOSFET/구리', 'TEC-B 2.5–3A 제한 PWM 전력단', [52, 12, 41], [136, -4, 12], '#263f38', 2, 0.18, 'pcb-soldermask', 'estimated'),
];

for (let sensor = 0; sensor < NTC_PROBE_LAYOUT_MM.length; sensor += 1) {
  const position = NTC_PROBE_LAYOUT_MM[sensor];
  components.push({
    id: `ntc_${sensor}`, name: `NTC 10K B3950 센서 ${sensor}`, category: 'logic', materialName: '에폭시/구리',
    detail: `냉각판 표면 채널 TH${sensor} · 배치 위치는 열분포 기준 engineering estimate`,
    geometry: { op: 'sphere', radius: 2.2, widthSegments: 20, heightSegments: 12 },
    position, material: { ...material('#28363a', 0.18, 0.4), surface: 'semiconductor' }, evidence: { status: 'estimated' },
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
    material: { ...material('#b9a27b', 0.86, 0.28), surface: 'machined-copper', anisotropy: 0.52 },
    evidence: { status: 'inferred', notes: ['Only heatpipe count and nominal diameter are visible in the reference.'] },
  });
}

for (let fin = 0; fin < 22; fin += 1) {
  components.push(box(
    `heatsink_fin_${String(fin + 1).padStart(2, '0')}`,
    `알루미늄 방열핀 ${fin + 1}`,
    'mechanical',
    '프레스 알루미늄',
    '공용 핀스택의 독립 박판 · 피치와 개수는 inferred',
    [146, 1.05, 116],
    [0, 27 + fin * 1.02, 0],
    '#b6b9b6',
    0.18,
    0.78,
    'brushed-metal',
    'inferred',
  ));
}

for (let blade = 0; blade < 9; blade += 1) {
  const angle = (blade / 9) * Math.PI * 2;
  components.push({
    ...box(
      `fan_blade_${blade + 1}`,
      `팬 블레이드 ${blade + 1}`,
      'mechanical',
      'PBT-GF30',
      '공용 팬 로터의 개별 곡면 근사 블레이드 · 형상 inferred',
      [38, 2.2, 11],
      [Math.cos(angle) * 32, 20, Math.sin(angle) * 32],
      '#2c3136',
      1,
      0.08,
      'molded-polymer',
      'inferred',
    ),
    rotation: [0, -angle + 0.35, 0],
  });
}

const packageParts: Array<[string, string, AssemblyComponentIR['category'], [number, number, number], [number, number, number], string, SurfaceFinishIR]> = [
  ['power_usb_c', 'USB-C PD 입력 커넥터', 'power', [13, 6, 9], [-121, 3, 66], '#a7abad', 'polished-metal'],
  ['power_inductor', 'DC/DC 차폐 인덕터', 'power', [12, 7, 12], [-105, 4, 66], '#3a3d3d', 'raw'],
  ['power_efuse', '10A eFuse 패키지', 'power', [9, 3, 8], [-91, 3, 66], '#1c1d1e', 'semiconductor'],
  ['esp32_rf_can', 'ESP32 RF 실드 캔', 'radio', [24, 2.2, 18], [82, 1, 66], '#b7bab8', 'brushed-metal'],
  ['esp32_soc', 'ESP32-S3 SiP', 'logic', [10, 2, 10], [103, 1, 66], '#191b1d', 'semiconductor'],
  ['mux_package', 'CD74HC4067 TSSOP', 'logic', [20, 2, 7], [-29, 1, 66], '#191b1d', 'semiconductor'],
  ['interface_q1', 'Q1 오픈컬렉터 트랜지스터', 'logic', [6, 5, 6], [4, 1, 69], '#202326', 'semiconductor'],
  ['ina260_shunt_a', 'TEC-A 전류 션트', 'logic', [12, 2, 5], [72, 1, 66], '#c5b7a1', 'raw'],
  ['ina260_shunt_b', 'TEC-B 전류 션트', 'logic', [12, 2, 5], [112, 1, 66], '#c5b7a1', 'raw'],
  ['md10c_mosfet_a', 'TEC-A N-MOSFET', 'power', [14, 5, 12], [78, 4, 12], '#202326', 'semiconductor'],
  ['md10c_mosfet_b', 'TEC-B N-MOSFET', 'power', [14, 5, 12], [136, 4, 12], '#202326', 'semiconductor'],
];
for (const [id, name, category, size, position, color, surface] of packageParts) {
  components.push(box(id, name, category, surface.includes('metal') ? '금속/패키지' : '전자부품 패키지', '보드에서 분리 선택 가능한 주요 실장 부품', size, position, color, 0.6, surface.includes('metal') ? 0.82 : 0.18, surface, 'estimated'));
}

for (let passive = 0; passive < 16; passive += 1) {
  const capacitor = passive >= 8;
  components.push(box(
    `interface_${capacitor ? 'cap' : 'res'}_${String((passive % 8) + 1).padStart(2, '0')}`,
    capacitor ? `NTC 필터 커패시터 C${passive - 5}` : `NTC 분압 저항 R${passive + 10}`,
    'logic',
    capacitor ? 'MLCC/니켈' : '알루미나/저항막',
    capacitor ? '100 nF 로컬 저역통과 커패시터' : '10 kΩ 0.1% NTC 분압 저항',
    capacitor ? [3.2, 1.4, 2] : [4, 1.4, 1.8],
    [0 + (passive % 8) * 7.2, 1, capacitor ? 72 : 61],
    capacitor ? '#cdbd99' : '#34363a',
    0.3,
    0.18,
    'raw',
    'estimated',
  ));
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
