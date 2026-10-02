import {Vector2} from 'three';
export const EXTRUDE_UV_REVISION='morphloom.extrude-uv/0.1';
/** Preserve Three's planar mapping; decide the sidewall axis in delivered float32 precision.
 * A diagonal edge must not switch axes on native Math.sin/cos double-rounding differences.
 * Intentional planar overlaps remain; this is not a packed UV atlas.
 */
export const stableExtrudeUV={
 generateTopUV(_geometry:unknown,vertices:number[],a:number,b:number,c:number):Vector2[]{
  return [a,b,c].map(i=>new Vector2(vertices[i*3],vertices[i*3+1]));
 },
 generateSideWallUV(_geometry:unknown,vertices:number[],a:number,b:number,c:number,d:number):Vector2[]{
  const dx=Math.abs(Math.fround(vertices[a*3])-Math.fround(vertices[b*3]));
  const dy=Math.abs(Math.fround(vertices[a*3+1])-Math.fround(vertices[b*3+1]));
  const axis=dy<dx?0:1; // Exact float32 ties consistently use Y, as in Three's original mapping.
  return [a,b,c,d].map(i=>new Vector2(vertices[i*3+axis],1-vertices[i*3+2]));
 },
};
