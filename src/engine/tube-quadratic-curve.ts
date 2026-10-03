import * as THREE from 'three';
import type { AssemblyGeometryIR } from './assembly-ir';
export type TubeGeometryIR = Extract<AssemblyGeometryIR, { op: 'tube' }>;
export interface TubeQuadraticCurveIR {
  schema: 'morphloom.tube-quadratic-bezier/0.1';
  /** Component-local coordinates in mm; not a point the surface necessarily passes through. */
  controlPointMm: [number, number, number];
}
const vector = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3
  && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 100_000);
/** Patch results must remain valid even when the source uses the legacy path. */
export function validateEditedTubePath(geometry: TubeGeometryIR): void {
  if (!Array.isArray(geometry.points) || geometry.points.length < 2 || geometry.points.length > 4096
    || !geometry.points.every(vector) || !Number.isFinite(geometry.radius) || geometry.radius <= 0
    || geometry.points.some((p,i) => i > 0 && new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...geometry.points[i-1]!)) < .001)) {
    throw new Error('Tube path edit has unsafe or collapsed endpoints.');
  }
  validateTubeQuadraticCurve(geometry);
}
/** Strict, bounded opt-in. No legacy path is rewritten or camera inferred. */
export function validateTubeQuadraticCurve(geometry: TubeGeometryIR): void {
  const value: unknown = geometry.curve;
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid quadratic Bezier declaration.');
  const curve = value as Record<string, unknown>;
  if (Object.keys(curve).some(k => !['schema', 'controlPointMm'].includes(k))
    || curve.schema !== 'morphloom.tube-quadratic-bezier/0.1' || !vector(curve.controlPointMm)
    || geometry.closed !== undefined && geometry.closed !== false
    || geometry.points.length !== 2 || !geometry.points.every(vector)
    || !Number.isFinite(geometry.radius) || geometry.radius <= 0) throw new Error('Invalid quadratic Bezier path or version.');
  const [p0, p2] = geometry.points.map(p => new THREE.Vector3(...p));
  const p1 = new THREE.Vector3(...curve.controlPointMm);
  const chord = p2!.clone().sub(p0!), length = chord.length();
  const u = p1.clone().sub(p0!), v = p2!.clone().sub(p1).sub(u);
  if (length < .001 || u.length() < .001 || p2!.distanceTo(p1) < .001) throw new Error('Singular quadratic Bezier endpoints/tangents.');
  const along = u.dot(chord) / (length * length);
  const excursion = u.clone().addScaledVector(chord, -along).length();
  if (along < 0 || along > 1 || excursion > length) throw new Error('Quadratic Bezier control exceeds forward path/excursion bounds.');
  const t = v.lengthSq() > 1e-18 ? THREE.MathUtils.clamp(-u.dot(v) / v.lengthSq(), 0, 1) : 0;
  const derivative = u.clone().addScaledVector(v, t).multiplyScalar(2);
  const cross = derivative.clone().cross(v.clone().multiplyScalar(2)).length();
  if (derivative.length() < .001) throw new Error('Singular quadratic Bezier tangent.');
  const minimumCurvatureRadius = cross > 1e-18 ? derivative.length() ** 3 / cross : Infinity;
  if (geometry.radius >= minimumCurvatureRadius * .95) throw new Error('Quadratic tube radius exceeds safe curvature radius.');
  for (const n of [geometry.tubularSegments, geometry.radialSegments]) {
    if (n !== undefined && (!Number.isInteger(n) || n < 3 || n > 512)) throw new Error('Quadratic Bezier segment count is unsafe.');
  }
}
/** Explicit deep-copy migration; undefined removes only the declared curve. */
export function migrateTubeQuadraticCurve(geometry: TubeGeometryIR, controlPointMm?: [number, number, number]): TubeGeometryIR {
  const result = structuredClone(geometry);
  if (controlPointMm === undefined) delete result.curve;
  else result.curve = { schema: 'morphloom.tube-quadratic-bezier/0.1', controlPointMm: [...controlPointMm] };
  validateTubeQuadraticCurve(result);
  return result;
}
export function createTubePath(geometry: TubeGeometryIR): THREE.Curve<THREE.Vector3> {
  validateTubeQuadraticCurve(geometry);
  const points = geometry.points.map(p => new THREE.Vector3(p[0] / 1000, p[1] / 1000, p[2] / 1000));
  if (geometry.curve) return new THREE.QuadraticBezierCurve3(points[0]!,
    new THREE.Vector3(...geometry.curve.controlPointMm.map(v => v / 1000) as [number, number, number]), points[1]!);
  return new THREE.CatmullRomCurve3(points, Boolean(geometry.closed), 'centripetal');
}
