import type { CharacterSpec, HumanPack, MorphTarget } from '../types';

function levelWeight(level: 'min' | 'average' | 'max', value: number): number {
  const v = Math.min(1, Math.max(0, value));
  const min = Math.min(1, Math.max(0, 1 - 2 * v));
  const max = Math.min(1, Math.max(0, 2 * v - 1));
  return level === 'min' ? min : level === 'max' ? max : Math.max(0, 1 - min - max);
}

function targetLevel(name: string, key: string): 'min' | 'average' | 'max' | undefined {
  if (name.includes(`max${key}`)) return 'max';
  if (name.includes(`min${key}`)) return 'min';
  if (name.includes(`average${key}`)) return 'average';
  return undefined;
}

export function ageYearsToParam(years: number): number {
  return years <= 25
    ? Math.min(1, Math.max(0, (years - 1) / 48))
    : Math.min(1, Math.max(0, 0.5 + (years - 25) / 130));
}

export function computeTargetWeight(target: MorphTarget, spec: CharacterSpec): number {
  const name = target.name.toLowerCase();
  const gender = Math.min(1, Math.max(0, spec.genderBlend));
  const isFemale = name.includes('female');
  const isMale = !isFemale && name.includes('male');
  const genderTerm = isFemale ? gender : isMale ? 1 - gender : 1;
  const age = ageYearsToParam(spec.ageYears);
  const ageTerm = name.includes('young') ? 1 - age : name.includes('old') ? age : 1;

  if (name.includes('height')) {
    const level = targetLevel(name, 'height');
    return level === 'max' ? genderTerm * levelWeight('max', Math.max(0.5, spec.heightCm / 205)) : 0;
  }

  if (name.includes('universal')) {
    const muscleLevel = targetLevel(name, 'muscle');
    const weightLevel = targetLevel(name, 'weight');
    if (muscleLevel && weightLevel) {
      return (
        genderTerm *
        ageTerm *
        levelWeight(muscleLevel, spec.muscle) *
        levelWeight(weightLevel, spec.weight)
      );
    }
  }

  if (['african', 'asian', 'caucasian'].some((token) => name.includes(token))) {
    return (genderTerm * ageTerm) / 3;
  }

  return 0;
}

export function morphPositions(pack: HumanPack, spec: CharacterSpec): Float32Array {
  const positions = pack.positions.slice();
  for (const target of pack.targets) {
    const weight = computeTargetWeight(target, spec);
    if (weight <= 0.0001) continue;
    for (let i = 0; i < target.indices.length; i += 1) {
      const vertexOffset = target.indices[i] * 3;
      const deltaOffset = i * 3;
      positions[vertexOffset] += target.deltas[deltaOffset] * target.scale * weight;
      positions[vertexOffset + 1] += target.deltas[deltaOffset + 1] * target.scale * weight;
      positions[vertexOffset + 2] += target.deltas[deltaOffset + 2] * target.scale * weight;
    }
  }
  return positions;
}
