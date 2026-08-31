import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { LAUREL_HOMES_BUILDING_B_IR } from '../src/engine/laurel-homes-building-b';

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      queueMicrotask(() => this.onloadend?.());
    });
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;
      queueMicrotask(() => this.onloadend?.());
    });
  }
}

Object.assign(globalThis, { FileReader: NodeFileReader });

const build = compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR, 'beauty');
build.root.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
    material.map = null;
    material.normalMap = null;
    material.roughnessMap = null;
    material.needsUpdate = true;
  }
});

const exporter = new GLTFExporter();
const binary = await exporter.parseAsync(build.root, { binary: true, onlyVisible: true, trs: false });

const glbPath = resolve('outputs/laurel-homes-building-b-typical-floor.glb');
const irPath = resolve('outputs/laurel-homes-building-b-typical-floor.assembly-ir.json');
const metricsPath = resolve('outputs/laurel-homes-building-b-typical-floor.metrics.json');
writeFileSync(glbPath, Buffer.from(binary as ArrayBuffer));
writeFileSync(irPath, `${JSON.stringify(LAUREL_HOMES_BUILDING_B_IR, null, 2)}\n`);

const summary = {
  glbPath,
  irPath,
  metricsPath,
  parts: build.metrics.parts,
  triangles: build.metrics.triangles,
  topology: build.metrics.topology,
  engineering: build.metrics.engineering,
  boundsMm: build.metrics.bounds.getSize(new THREE.Vector3()).multiplyScalar(1000).toArray(),
};
writeFileSync(metricsPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
