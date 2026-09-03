import { Accessor, Document, NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { auditRiggedGlbPayload } from '../scripts/lib/rigged-payload-audit';

async function riggedFixture(options: { negateQuaternion?: boolean; animationOffset?: number } = {}): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document.createAccessor('positions')
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const uvs = document.createAccessor('uvs')
    .setType(Accessor.Type.VEC2)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const joints = document.createAccessor('joints')
    .setType(Accessor.Type.VEC4)
    .setArray(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    .setBuffer(buffer);
  const weights = document.createAccessor('weights')
    .setType(Accessor.Type.VEC4)
    .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
    .setBuffer(buffer);
  const indices = document.createAccessor('indices')
    .setType(Accessor.Type.SCALAR)
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const inverseBind = document.createAccessor('inverse-bind')
    .setType(Accessor.Type.MAT4)
    .setArray(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
    .setBuffer(buffer);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', positions)
    .setAttribute('TEXCOORD_0', uvs)
    .setAttribute('JOINTS_0', joints)
    .setAttribute('WEIGHTS_0', weights)
    .setIndices(indices);
  const mesh = document.createMesh('body-mesh').addPrimitive(primitive);
  const skeleton = document.createNode('Armature');
  const joint = document.createNode('spine');
  skeleton.addChild(joint);
  const skin = document.createSkin('body-skin').setSkeleton(skeleton).addJoint(joint).setInverseBindMatrices(inverseBind);
  const body = document.createNode('body').setMesh(mesh).setSkin(skin)
    .setExtras({ morphloomStableNodeId: 'body' });
  document.createScene('scene').addChild(skeleton).addChild(body);

  const times = document.createAccessor('times')
    .setType(Accessor.Type.SCALAR)
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const sign = options.negateQuaternion ? -1 : 1;
  const offset = options.animationOffset ?? 0;
  const rotations = document.createAccessor('rotations')
    .setType(Accessor.Type.VEC4)
    .setArray(new Float32Array([0, 0, 0, sign, 0, sign * (0.2 + offset), 0, sign * 0.9797959]))
    .setBuffer(buffer);
  const sampler = document.createAnimationSampler('spine-rotation')
    .setInput(times).setOutput(rotations).setInterpolation('LINEAR');
  const channel = document.createAnimationChannel('spine-rotation')
    .setTargetNode(joint).setTargetPath('rotation').setSampler(sampler);
  document.createAnimation('idle').addSampler(sampler).addChannel(channel);
  return new NodeIO().writeBinary(document);
}

describe('rigged GLB payload audit', () => {
  it('preserves a skin and treats sign-equivalent quaternions as the same pose', async () => {
    const report = await auditRiggedGlbPayload(
      await riggedFixture(),
      await riggedFixture({ negateQuaternion: true }),
    );
    expect(report).toMatchObject({
      pass: true,
      skinnedMeshNodes: 1,
      animationClips: 1,
      animationChannels: 1,
      blockers: [],
    });
    expect(report.maximumAnimationValueDrift).toBe(0);
  });

  it('blocks a semantic animation change above the delivery tolerance', async () => {
    const report = await auditRiggedGlbPayload(
      await riggedFixture(),
      await riggedFixture({ animationOffset: 0.02 }),
    );
    expect(report.pass).toBe(false);
    expect(report.maximumAnimationValueDrift).toBeGreaterThan(0.01);
    expect(report.blockers).toContain('idle|spine|rotation: animation value drift exceeds 0.00001.');
  });
});
