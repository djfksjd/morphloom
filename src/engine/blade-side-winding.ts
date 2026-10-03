import * as THREE from 'three';
import type { AssemblyGeometryIR } from './assembly-ir';
export interface BladeSideWindingIR { schema: 'morphloom.blade-side-winding/0.1'; direction: 'outward' }
type Blade = Extract<AssemblyGeometryIR, {op:'bladeLoft'}>;
/** New restrictions belong only to the explicitly opted-in representation. */
export function validateBladeSideWinding(geometry: Blade): void {
 const value:unknown=geometry.sideWinding;if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid blade side winding declaration.');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['schema','direction'].includes(k))||v.schema!=='morphloom.blade-side-winding/0.1'||v.direction!=='outward')throw new Error('Unsupported blade winding version/direction.');
 const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000;
 if(!Array.isArray(geometry.sections)||geometry.sections.length<2||geometry.sections.length>512||!geometry.sections.every((p,i)=>Array.isArray(p)&&p.length===2&&p.every(finite)&&p[1]>0&&(i===0||p[0]>geometry.sections[i-1]![0]))
 ||!finite(geometry.thickness)||!finite(geometry.apexThickness)||geometry.apexThickness<=0||geometry.thickness<geometry.apexThickness
 ||geometry.grindCurve!==undefined&&(!Array.isArray(geometry.grindCurve)||geometry.grindCurve.length!==5||!geometry.grindCurve.every(n=>finite(n)&&n>=0&&n<=1)))throw new Error('Outward blade requires bounded increasing sections, positive depth and five grind samples.');
 const {positions,indices}=bladeLoftData(geometry);
      if (geometry.sideWinding) {
        // Validate the actual Float32 geometry, including representational collapse.
        const p = new THREE.Float32BufferAttribute(positions, 3);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let i = 0; i < indices.length; i += 3) {
          a.fromBufferAttribute(p, indices[i]!); b.fromBufferAttribute(p, indices[i + 1]!); c.fromBufferAttribute(p, indices[i + 2]!);
          const longest = Math.max(a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a));
          const area = b.sub(a).cross(c.sub(a)).length();
          if (!Number.isFinite(area) || longest === 0 || area <= longest * 1e-12) throw new Error('Outward blade has collapsed or degenerate Float32 triangles.');
        }
      }

}
export function migrateBladeSideWinding(geometry: Blade, outward: boolean): Blade {
 if(typeof outward!=='boolean')throw new Error('Blade winding migration requires boolean choice.');
 const result=structuredClone(geometry);if(outward)result.sideWinding={schema:'morphloom.blade-side-winding/0.1',direction:'outward'};else delete result.sideWinding;
 validateBladeSideWinding(result);return result;
}

/** Canonical loft positions and triangle topology; also used by edit preflight. */
export function bladeLoftData(geometry: Blade): {positions:number[];indices:number[]} {
 const mm=(value:number)=>value/1000;
      const across = geometry.grindCurve ?? [0.04, 0.62, 1, 0.62, 0.04];
      const acrossX = [-1, -0.5, 0, 0.5, 1];
      const positions: number[] = [];
      const indices: number[] = [];
      const halfStock = mm(geometry.thickness) * 0.5;
      const halfApex = mm(geometry.apexThickness) * 0.5;
      for (const [y, halfWidth] of geometry.sections) {
        for (const side of [1, -1]) {
          for (let column = 0; column < acrossX.length; column += 1) {
            const profile = across[column];
            positions.push(
              mm(halfWidth * acrossX[column]),
              mm(y),
              side * (halfApex + (halfStock - halfApex) * profile),
            );
          }
        }
      }
      const columns = acrossX.length;
      const rowStride = columns * 2;
      for (let row = 0; row < geometry.sections.length - 1; row += 1) {
        const base = row * rowStride;
        const next = (row + 1) * rowStride;
        for (let column = 0; column < columns - 1; column += 1) {
          const fa = base + column;
          const fb = base + column + 1;
          const fc = next + column + 1;
          const fd = next + column;
          indices.push(fa, fb, fc, fa, fc, fd);
          const ba = base + columns + column;
          const bb = next + columns + column;
          const bc = next + columns + column + 1;
          const bd = base + columns + column + 1;
          indices.push(ba, bb, bc, ba, bc, bd);
        }
        for (const column of [0, columns - 1]) {
          const frontA = base + column;
          const frontB = next + column;
          const backB = next + columns + column;
          const backA = base + columns + column;
          const start = indices.length;
          if (column === 0) indices.push(frontA, backB, frontB, frontA, backA, backB);
          else indices.push(frontA, frontB, backB, frontA, backB, backA);
          if (geometry.sideWinding) for (let i = start; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
        }
      }
      const cap = (row: number, reverse: boolean) => {
        const base = row * rowStride;
        for (let column = 0; column < columns - 1; column += 1) {
          const a = base + column;
          const b = base + column + 1;
          const c = base + columns + column + 1;
          const d = base + columns + column;
          if (reverse) indices.push(a, c, b, a, d, c);
          else indices.push(a, b, c, a, c, d);
        }
      };
      cap(0, true);
      cap(geometry.sections.length - 1, false);
 return {positions,indices};
}
