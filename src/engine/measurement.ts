export type MeasurementUnit = 'mm' | 'cm' | 'm';
export type MeasurementMode = 'distance' | 'height';

export interface MeasurementPoint {
  x: number;
  y: number;
  z: number;
}

export interface MeasurementResult {
  start: MeasurementPoint;
  end: MeasurementPoint;
  distanceMeters: number;
  heightMeters: number;
  deltaMeters: MeasurementPoint;
}

const SCALE_BY_UNIT: Record<MeasurementUnit, number> = {
  mm: 1_000,
  cm: 100,
  m: 1,
};

function assertPoint(point: MeasurementPoint, label: string): void {
  if (![point.x, point.y, point.z].every(Number.isFinite)) {
    throw new Error(`${label} measurement point must contain finite coordinates.`);
  }
}

export function calculateMeasurement(start: MeasurementPoint, end: MeasurementPoint): MeasurementResult {
  assertPoint(start, 'Start');
  assertPoint(end, 'End');
  const deltaMeters = {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z,
  };
  return {
    start: { ...start },
    end: { ...end },
    deltaMeters,
    distanceMeters: Math.hypot(deltaMeters.x, deltaMeters.y, deltaMeters.z),
    heightMeters: Math.abs(deltaMeters.y),
  };
}

export function valueInUnit(meters: number, unit: MeasurementUnit): number {
  if (!Number.isFinite(meters)) throw new Error('Measurement value must be finite.');
  return meters * SCALE_BY_UNIT[unit];
}

export function formatMeasurement(meters: number, unit: MeasurementUnit, precision?: number): string {
  const digits = precision ?? (unit === 'mm' ? 1 : unit === 'cm' ? 2 : 3);
  return `${valueInUnit(meters, unit).toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${unit}`;
}
