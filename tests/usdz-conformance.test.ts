import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { repairThreeUsdz } from '../src/engine/usdz-conformance';

function fixture() {
  const model = `#usda 1.0
def Shader "PrimvarReader_normal"
{
  uniform token info:id = "UsdPrimvarReader_float2"
  token inputs:varname = "st"
}
def Shader "Transform2d_normal"
{
  uniform token info:id = "UsdTransform2d"
  token inputs:in.connect = </Materials/Material_1/PrimvarReader_normal.outputs:result>
}
def Shader "Texture_1_normal"
{
  uniform token info:id = "UsdUVTexture"
  asset inputs:file = @textures/normal.png@
}
`;
  return zipSync({ 'model.usda': strToU8(model), 'textures/normal.png': new Uint8Array([1, 2, 3, 4]) }, { level: 0 });
}

describe('USDZ conformance repair', () => {
  it('repairs Three.js USD shader types and 8-bit normal decoding', () => {
    const result = repairThreeUsdz(fixture());
    expect(result.audit).toMatchObject({
      status: 'pass', repairedVarnameTypes: 1, repairedTransformInputTypes: 1, repairedNormalMaps: 1,
    });
    const model = strFromU8(unzipSync(result.bytes)['model.usda']!);
    expect(model).toContain('string inputs:varname = "st"');
    expect(model).toContain('float2 inputs:in.connect');
    expect(model).toContain('float4 inputs:scale = (2, 2, 2, 1)');
    expect(model).toContain('float4 inputs:bias = (-1, -1, -1, 0)');
  });

  it('rejects unsafe archive paths and payload sizes', () => {
    const escaped = zipSync({ 'model.usda': strToU8('#usda 1.0\n'.repeat(4)), '../outside.usda': strToU8('bad') });
    expect(() => repairThreeUsdz(escaped)).toThrow(/unsafe file path/);
    expect(() => repairThreeUsdz(new Uint8Array(12))).toThrow(/budget/);
  });

  it('rejects declared unpacked sizes before allocating archive entries', () => {
    const payload = fixture();
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let central = -1;
    for (let offset = 0; offset <= payload.byteLength - 4; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        central = offset;
        break;
      }
    }
    expect(central).toBeGreaterThanOrEqual(0);
    view.setUint32(central + 24, 513 * 1024 * 1024, true);
    expect(() => repairThreeUsdz(payload)).toThrow(/unpacked budget/);
  });
});
