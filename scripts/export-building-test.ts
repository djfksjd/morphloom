import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { POOR_COYOTES_CABIN_IR } from '../src/engine/poor-coyotes-cabin';

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

const build = compileAssemblyIR(POOR_COYOTES_CABIN_IR, 'beauty');
build.root.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
    // The browser rebuilds these procedural maps from the AssemblyIR. Keep the
    // CLI GLB preview portable by exporting the PBR scalars without data maps.
    material.map = null;
    material.normalMap = null;
    material.roughnessMap = null;
    material.needsUpdate = true;
  }
});

const exporter = new GLTFExporter();
const binary = await exporter.parseAsync(build.root, {
  binary: true,
  onlyVisible: true,
  trs: false,
});

const glbPath = resolve('outputs/poor-coyotes-cabin-habs-test.glb');
const irPath = resolve('outputs/poor-coyotes-cabin-habs-test.assembly-ir.json');
writeFileSync(glbPath, Buffer.from(binary as ArrayBuffer));
writeFileSync(irPath, `${JSON.stringify(POOR_COYOTES_CABIN_IR, null, 2)}\n`);

console.log(JSON.stringify({
  glbPath,
  irPath,
  parts: build.metrics.parts,
  triangles: build.metrics.triangles,
  topology: build.metrics.topology,
  boundsMm: build.metrics.bounds.getSize(new THREE.Vector3()).multiplyScalar(1000).toArray(),
}, null, 2));
