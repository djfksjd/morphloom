import { createHash } from 'node:crypto';
import { WebIO, type Accessor, type Document, type Node, type Primitive, type Skin } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

export interface RiggedPayloadAudit {
  schema: 'morphloom.rigged-payload-audit/0.1';
  pass: boolean;
  skinnedMeshNodes: number;
  animationClips: number;
  animationChannels: number;
  maximumBasePositionDriftMeters: number;
  maximumUvDrift: number;
  maximumBoneWeightDrift: number;
  maximumAnimationTimeDriftSeconds: number;
  maximumAnimationValueDrift: number;
  blockers: string[];
}

function stableNodeId(node: Node): string {
  const candidate = node.getExtras().morphloomStableNodeId;
  return typeof candidate === 'string' && candidate ? candidate : node.getName();
}

function digest(lines: Iterable<string>): string {
  const hash = createHash('sha256');
  for (const line of [...lines].sort()) hash.update(line).update('\n');
  return hash.digest('hex');
}

function q(value: number, precision: number): number {
  return Math.round(value * precision);
}

function indexAt(primitive: Primitive, offset: number): number {
  return primitive.getIndices()?.getScalar(offset) ?? offset;
}

function vector(accessor: Accessor, index: number): number[] {
  const value: number[] = [];
  accessor.getElement(index, value);
  return value;
}

function trianglePayload(primitive: Primitive): { triangles: number; geometry: string } {
  const positions = primitive.getAttribute('POSITION');
  if (!positions) throw new Error('Skinned primitive has no POSITION attribute.');
  const indexCount = primitive.getIndices()?.getCount() ?? positions.getCount();
  if (indexCount % 3 !== 0) throw new Error('Skinned primitive is not a triangle list.');
  const geometryLines: string[] = [];
  for (let offset = 0; offset < indexCount; offset += 3) {
    const geometryCorners: string[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indexAt(primitive, offset + corner);
      const position = vector(positions, vertex);
      const positionKey = position.slice(0, 3).map((value) => q(value, 100_000)).join(',');
      geometryCorners.push(positionKey);
    }
    geometryLines.push(geometryCorners.sort().join(';'));
  }
  return { triangles: indexCount / 3, geometry: digest(geometryLines) };
}

function skinBindingDigest(skin: Skin): string {
  const joints = skin.listJoints();
  const matrices = skin.getInverseBindMatrices();
  const lines = joints.map((joint, index) => {
    const matrix = matrices ? vector(matrices, index).map((value) => q(value, 100_000)).join(',') : 'identity';
    return `${joint.getName()}|${matrix}`;
  });
  return digest(lines);
}

function namedInfluences(joints: Accessor, weights: Accessor, vertex: number, jointNames: string[]): Map<string, number> {
  const jointValues = vector(joints, vertex);
  const weightValues = vector(weights, vertex);
  const result = new Map<string, number>();
  for (let slot = 0; slot < Math.min(jointValues.length, weightValues.length); slot += 1) {
    const weight = weightValues[slot] ?? 0;
    if (weight <= 0.000001) continue;
    const jointName = jointNames[Math.round(jointValues[slot] ?? -1)];
    if (!jointName) throw new Error('Skin payload references an unknown joint.');
    result.set(jointName, (result.get(jointName) ?? 0) + weight);
  }
  return result;
}

function compareRiggedPrimitive(
  source: Primitive,
  edited: Primitive,
  sourceJointNames: string[],
  editedJointNames: string[],
): { positionDrift: number; uvDrift: number; weightDrift: number } {
  const sourcePositions = source.getAttribute('POSITION');
  const editedPositions = edited.getAttribute('POSITION');
  const sourceUvs = source.getAttribute('TEXCOORD_0');
  const editedUvs = edited.getAttribute('TEXCOORD_0');
  const sourceJoints = source.getAttribute('JOINTS_0');
  const editedJoints = edited.getAttribute('JOINTS_0');
  const sourceWeights = source.getAttribute('WEIGHTS_0');
  const editedWeights = edited.getAttribute('WEIGHTS_0');
  if (!sourcePositions || !editedPositions || !sourceJoints || !editedJoints || !sourceWeights || !editedWeights) {
    throw new Error('Rigged primitive has incomplete position, joint, or weight attributes.');
  }
  if (Boolean(sourceUvs) !== Boolean(editedUvs)) throw new Error('Rigged primitive UV channel inventory changed.');
  const sourceIndexCount = source.getIndices()?.getCount() ?? sourcePositions.getCount();
  const editedIndexCount = edited.getIndices()?.getCount() ?? editedPositions.getCount();
  if (sourceIndexCount !== editedIndexCount) throw new Error('Rigged primitive corner count changed.');
  let positionDrift = 0;
  let uvDrift = 0;
  let weightDrift = 0;
  for (let offset = 0; offset < sourceIndexCount; offset += 1) {
    const sourceVertex = indexAt(source, offset);
    const editedVertex = indexAt(edited, offset);
    const sourcePosition = vector(sourcePositions, sourceVertex);
    const editedPosition = vector(editedPositions, editedVertex);
    for (let axis = 0; axis < 3; axis += 1) {
      positionDrift = Math.max(positionDrift, Math.abs(sourcePosition[axis]! - editedPosition[axis]!));
    }
    if (sourceUvs && editedUvs) {
      const sourceUv = vector(sourceUvs, sourceVertex);
      const editedUv = vector(editedUvs, editedVertex);
      for (let axis = 0; axis < 2; axis += 1) {
        uvDrift = Math.max(uvDrift, Math.abs(sourceUv[axis]! - editedUv[axis]!));
      }
    }
    const sourceInfluences = namedInfluences(sourceJoints, sourceWeights, sourceVertex, sourceJointNames);
    const editedInfluences = namedInfluences(editedJoints, editedWeights, editedVertex, editedJointNames);
    for (const joint of new Set([...sourceInfluences.keys(), ...editedInfluences.keys()])) {
      weightDrift = Math.max(
        weightDrift,
        Math.abs((sourceInfluences.get(joint) ?? 0) - (editedInfluences.get(joint) ?? 0)),
      );
    }
  }
  return { positionDrift, uvDrift, weightDrift };
}

function values(accessor: Accessor): number[] {
  const result: number[] = [];
  const element: number[] = [];
  for (let index = 0; index < accessor.getCount(); index += 1) {
    accessor.getElement(index, element);
    result.push(...element.slice(0, accessor.getElementSize()));
  }
  return result;
}

function maximumArrayDrift(left: number[], right: number[], quaternion = false): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  if (!quaternion) return left.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - right[index]!)), 0);
  let maximum = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    let direct = 0;
    let negated = 0;
    for (let axis = 0; axis < 4; axis += 1) {
      direct = Math.max(direct, Math.abs(left[offset + axis]! - right[offset + axis]!));
      negated = Math.max(negated, Math.abs(left[offset + axis]! + right[offset + axis]!));
    }
    maximum = Math.max(maximum, Math.min(direct, negated));
  }
  return maximum;
}

function animationChannels(document: Document): Map<string, { input: number[]; output: number[]; rotation: boolean }> {
  const result = new Map<string, { input: number[]; output: number[]; rotation: boolean }>();
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      const sampler = channel.getSampler();
      if (!target || !sampler) throw new Error(`Animation ${animation.getName()} has an incomplete channel.`);
      const key = `${animation.getName()}|${target.getName()}|${channel.getTargetPath()}`;
      if (result.has(key)) throw new Error(`Duplicate animation channel: ${key}`);
      const input = sampler.getInput();
      const output = sampler.getOutput();
      if (!input || !output) throw new Error(`Animation channel ${key} has no sampler payload.`);
      result.set(key, { input: values(input), output: values(output), rotation: channel.getTargetPath() === 'rotation' });
    }
  }
  return result;
}

export async function auditRiggedGlbPayload(sourceBytes: Uint8Array, editedBytes: Uint8Array): Promise<RiggedPayloadAudit> {
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const [source, edited] = await Promise.all([io.readBinary(sourceBytes), io.readBinary(editedBytes)]);
  const blockers: string[] = [];
  const sourceNodes = source.getRoot().listNodes().filter((node) => node.getMesh() && node.getSkin());
  const editedNodesById = new Map(
    edited.getRoot().listNodes().filter((node) => node.getMesh() && node.getSkin())
      .map((node) => [stableNodeId(node), node] as const),
  );
  if (editedNodesById.size !== sourceNodes.length) blockers.push('Skinned mesh-node inventory changed.');
  let maximumBasePositionDriftMeters = 0;
  let maximumUvDrift = 0;
  let maximumBoneWeightDrift = 0;
  for (const sourceNode of sourceNodes) {
    const id = stableNodeId(sourceNode);
    const editedNode = editedNodesById.get(id);
    if (!editedNode) {
      blockers.push(`${id}: skinned mesh binding is missing.`);
      continue;
    }
    const sourcePrimitives = sourceNode.getMesh()!.listPrimitives();
    const editedPrimitives = editedNode.getMesh()!.listPrimitives();
    if (sourcePrimitives.length !== editedPrimitives.length) {
      blockers.push(`${id}: primitive count changed.`);
      continue;
    }
    for (let index = 0; index < sourcePrimitives.length; index += 1) {
      const sourcePayload = trianglePayload(sourcePrimitives[index]!);
      const editedPayload = trianglePayload(editedPrimitives[index]!);
      if (sourcePayload.triangles !== editedPayload.triangles || sourcePayload.geometry !== editedPayload.geometry) {
        blockers.push(`${id}: base-pose triangle geometry changed.`);
      }
      const drift = compareRiggedPrimitive(
        sourcePrimitives[index]!,
        editedPrimitives[index]!,
        sourceNode.getSkin()!.listJoints().map((joint) => joint.getName()),
        editedNode.getSkin()!.listJoints().map((joint) => joint.getName()),
      );
      maximumBasePositionDriftMeters = Math.max(maximumBasePositionDriftMeters, drift.positionDrift);
      maximumUvDrift = Math.max(maximumUvDrift, drift.uvDrift);
      maximumBoneWeightDrift = Math.max(maximumBoneWeightDrift, drift.weightDrift);
      if (drift.positionDrift > 0.000001) blockers.push(`${id}: base-position drift exceeds 0.001 mm.`);
      if (drift.uvDrift > 0.000001) blockers.push(`${id}: UV drift exceeds 0.000001.`);
      if (drift.weightDrift > 0.00002) blockers.push(`${id}: bone-weight drift exceeds 0.00002.`);
    }
    if (skinBindingDigest(sourceNode.getSkin()!) !== skinBindingDigest(editedNode.getSkin()!)) {
      blockers.push(`${id}: joint or inverse-bind payload changed.`);
    }
  }

  const sourceChannels = animationChannels(source);
  const editedChannels = animationChannels(edited);
  if (sourceChannels.size !== editedChannels.size) blockers.push('Animation channel inventory changed.');
  let maximumAnimationTimeDriftSeconds = 0;
  let maximumAnimationValueDrift = 0;
  for (const [key, sourceChannel] of sourceChannels) {
    const editedChannel = editedChannels.get(key);
    if (!editedChannel) {
      blockers.push(`Animation channel is missing: ${key}`);
      continue;
    }
    const timeDrift = maximumArrayDrift(sourceChannel.input, editedChannel.input);
    const valueDrift = maximumArrayDrift(sourceChannel.output, editedChannel.output, sourceChannel.rotation);
    maximumAnimationTimeDriftSeconds = Math.max(maximumAnimationTimeDriftSeconds, timeDrift);
    maximumAnimationValueDrift = Math.max(maximumAnimationValueDrift, valueDrift);
    if (timeDrift > 0.000001) blockers.push(`${key}: keyframe time drift exceeds 1 µs.`);
    if (valueDrift > 0.00001) blockers.push(`${key}: animation value drift exceeds 0.00001.`);
  }
  return {
    schema: 'morphloom.rigged-payload-audit/0.1',
    pass: blockers.length === 0,
    skinnedMeshNodes: sourceNodes.length,
    animationClips: source.getRoot().listAnimations().length,
    animationChannels: sourceChannels.size,
    maximumBasePositionDriftMeters,
    maximumUvDrift,
    maximumBoneWeightDrift,
    maximumAnimationTimeDriftSeconds,
    maximumAnimationValueDrift,
    blockers,
  };
}
