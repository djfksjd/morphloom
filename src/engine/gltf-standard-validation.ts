export interface GltfStandardValidation {
  status: 'pass' | 'warn' | 'blocked';
  validator: 'Khronos glTF Validator';
  validatorVersion: string;
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
  truncated: boolean;
  issueCodes: string[];
  independentRead: {
    status: 'pass' | 'not-run';
    parser: 'glTF Transform WebIO';
    nodes: number;
    meshes: number;
    materials: number;
    skins: number;
    animations: number;
  };
}

const MAX_GLB_BYTES = 256 * 1024 * 1024;

function count(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

/**
 * Validates the exact exported bytes with Khronos' independent glTF 2.0
 * validator. It is lazy-loaded so the viewer does not pay the WASM/JS parse
 * cost until an asset is actually prepared for delivery.
 */
export async function validateGlbStandard(bytes: ArrayBuffer): Promise<GltfStandardValidation> {
  if (bytes.byteLength < 20) throw new Error('GLB payload is too small for a valid header and JSON chunk.');
  if (bytes.byteLength > MAX_GLB_BYTES) throw new Error('GLB exceeds the 256MB local safety limit.');

  const validator = await import('gltf-validator');
  const report = await validator.validateBytes(new Uint8Array(bytes), {
    uri: 'morphloom-delivery.glb',
    format: 'glb',
    writeTimestamp: false,
    maxIssues: 1_000,
  });
  const issues = report.issues ?? {};
  const errors = count(issues.numErrors);
  const warnings = count(issues.numWarnings);
  const infos = count(issues.numInfos);
  const hints = count(issues.numHints);
  const issueCodes = [...new Set((issues.messages ?? [])
    .map((message) => String(message.code ?? '').trim())
    .filter(Boolean))].sort();

  let independentRead: GltfStandardValidation['independentRead'] = {
    status: 'not-run', parser: 'glTF Transform WebIO', nodes: 0, meshes: 0, materials: 0, skins: 0, animations: 0,
  };
  if (errors === 0) {
    const [{ WebIO }, { ALL_EXTENSIONS }] = await Promise.all([
      import('@gltf-transform/core'),
      import('@gltf-transform/extensions'),
    ]);
    const document = await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
    const root = document.getRoot();
    independentRead = {
      status: 'pass',
      parser: 'glTF Transform WebIO',
      nodes: root.listNodes().length,
      meshes: root.listMeshes().length,
      materials: root.listMaterials().length,
      skins: root.listSkins().length,
      animations: root.listAnimations().length,
    };
  }

  return {
    status: errors > 0 ? 'blocked' : warnings > 0 || issues.truncated === true ? 'warn' : 'pass',
    validator: 'Khronos glTF Validator',
    validatorVersion: String(report.validatorVersion ?? 'unknown'),
    errors,
    warnings,
    infos,
    hints,
    truncated: issues.truncated === true,
    issueCodes,
    independentRead,
  };
}
