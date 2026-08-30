import type { CharacterSpec, HairStyle, OutfitStyle, ProductSpec } from '../types';

export interface PromptResult {
  spec: CharacterSpec;
  changes: string[];
}

export function applyPrompt(input: string, current: CharacterSpec): PromptResult {
  const prompt = input.toLowerCase();
  const spec = { ...current };
  const changes: string[] = [];

  const heightMatch = prompt.match(/(1\d{2}|20\d)\s*(?:cm|센티|센티미터)/);
  if (heightMatch) {
    spec.heightCm = Math.min(205, Math.max(155, Number(heightMatch[1])));
    changes.push(`키 ${spec.heightCm}cm`);
  } else if (/키\s*(?:크게|큰)|taller|long legs/.test(prompt)) {
    spec.heightCm = Math.min(205, spec.heightCm + 5);
    spec.legScale = Math.min(1.1, spec.legScale + 0.025);
    changes.push('키와 다리 비율 증가');
  } else if (/키\s*(?:작게|작은)|shorter/.test(prompt)) {
    spec.heightCm = Math.max(155, spec.heightCm - 5);
    changes.push('키 감소');
  }

  const ageMatch = prompt.match(/(1[89]|[2-7]\d|80)\s*(?:세|살|years? old)/);
  if (ageMatch) {
    spec.ageYears = Number(ageMatch[1]);
    changes.push(`연령 파라미터 ${spec.ageYears}`);
  }

  if (/근육|muscular|athletic|전사/.test(prompt)) {
    spec.muscle = Math.min(1, spec.muscle + 0.2);
    spec.shoulderScale = Math.min(1.18, spec.shoulderScale + 0.06);
    changes.push('근육량과 어깨 너비 증가');
  }
  if (/슬림|마른|slim|lean/.test(prompt)) {
    spec.weight = Math.max(0.12, spec.weight - 0.17);
    changes.push('슬림 체형 적용');
  }
  if (/체격|덩치|heavy|stocky/.test(prompt)) {
    spec.weight = Math.min(0.92, spec.weight + 0.18);
    changes.push('체격 증가');
  }
  if (/여성|woman|female/.test(prompt)) {
    spec.genderBlend = 0.9;
    changes.push('사용자 지정 여성형 모프');
  }
  if (/남성|man|male/.test(prompt)) {
    spec.genderBlend = 0.1;
    changes.push('사용자 지정 남성형 모프');
  }

  const hairRules: Array<[RegExp, HairStyle, string]> = [
    [/단발|bob/, 'bob', '단발 헤어'],
    [/삭발|buzz/, 'buzz', '버즈컷'],
    [/민머리|대머리|bald|no hair/, 'none', '헤어 제거'],
    [/짧은\s*머리|short hair|crop/, 'crop', '크롭 헤어'],
  ];
  for (const [rule, style, label] of hairRules) {
    if (rule.test(prompt)) {
      spec.hairStyle = style;
      changes.push(label);
      break;
    }
  }

  const outfitRules: Array<[RegExp, OutfitStyle, string, string]> = [
    [/스파이더맨|spider[-\s]?man|web[-\s]?hero|거미\s*(?:영웅|슈트)/, 'web-hero', '웹 히어로 분리 슈트', '#6b0017'],
    [/갑옷|armor|전투복/, 'field', '전술 필드 슈트', '#262c36'],
    [/스튜디오|studio|motion capture|모션캡처/, 'studio', '스튜디오 캡처 슈트', '#d7d7cf'],
    [/바디수트|body suit|second skin/, 'second-skin', '세컨드 스킨', '#20252d'],
  ];
  for (const [rule, outfit, label, color] of outfitRules) {
    if (rule.test(prompt)) {
      spec.outfit = outfit;
      spec.suitColor = color;
      if (outfit === 'web-hero') {
        spec.accentColor = '#031b3f';
        spec.hairStyle = 'none';
        spec.genderBlend = Math.min(spec.genderBlend, 0.12);
        spec.muscle = Math.max(spec.muscle, 0.68);
        spec.shoulderScale = Math.max(spec.shoulderScale, 1.08);
        spec.pose = 'reference-action';
      }
      changes.push(label);
      break;
    }
  }

  if (/중립|a[-\s]?pose|neutral/.test(prompt)) {
    spec.pose = 'neutral';
    changes.push('중립 A 포즈');
  } else if (/참조\s*포즈|액션\s*포즈|웅크|crouch|action pose|web shooting|웹\s*슈팅/.test(prompt)) {
    spec.pose = 'reference-action';
    changes.push('참조 액션 포즈');
  }

  if (/파란|blue/.test(prompt)) {
    spec.accentColor = '#335cff';
    changes.push('코발트 포인트');
  }
  if (/빨간|red/.test(prompt)) {
    spec.accentColor = '#f05d47';
    changes.push('적색 포인트');
  }
  if (/검정|black/.test(prompt)) {
    spec.suitColor = '#17191f';
    changes.push('검정 슈트');
  }

  return { spec, changes };
}

export interface ProductPromptResult {
  spec: ProductSpec;
  changes: string[];
}

export function applyProductPrompt(input: string, current: ProductSpec): ProductPromptResult {
  const prompt = input.toLowerCase();
  const spec = { ...current };
  const changes: string[] = [];
  if (/단검|칼|검|knife|dagger|sword/.test(prompt) && spec.kind !== 'ornate-knife') {
    Object.assign(spec, {
      kind: 'ornate-knife' as const,
      widthMm: 96,
      heightMm: 438,
      depthMm: 22,
      cornerRadiusMm: 3,
      explode: 0.18,
    });
    changes.push('장식 단검 AssemblyIR');
  }
  if (/스마트폰|핸드폰|phone|smartphone/.test(prompt) && spec.kind !== 'smartphone') {
    Object.assign(spec, {
      kind: 'smartphone' as const,
      widthMm: 76.7,
      heightMm: 159.9,
      depthMm: 8.25,
      cornerRadiusMm: 11.2,
      explode: 0.72,
    });
    changes.push('스마트폰 AssemblyIR');
  }
  const dimensionMatch = prompt.match(/(\d{2,3}(?:\.\d+)?)\s*[x×*]\s*(\d{2,3}(?:\.\d+)?)\s*[x×*]\s*(\d{1,2}(?:\.\d+)?)\s*mm/);
  if (dimensionMatch) {
    const [width, height, depth] = dimensionMatch.slice(1).map(Number);
    const isKnife = spec.kind === 'ornate-knife';
    spec.widthMm = Math.min(isKnife ? 160 : 110, Math.max(isKnife ? 50 : 45, Math.min(width, height)));
    spec.heightMm = Math.min(isKnife ? 700 : 210, Math.max(isKnife ? 240 : 100, Math.max(width, height)));
    spec.depthMm = Math.min(isKnife ? 55 : 18, Math.max(isKnife ? 8 : 4, depth));
    changes.push(`제품 치수 ${spec.widthMm}×${spec.heightMm}×${spec.depthMm}mm`);
  }
  if (/완전\s*분해|exploded|max explode/.test(prompt)) {
    spec.explode = 1;
    changes.push('완전 분해 배치');
  } else if (/조립|assembled|닫아/.test(prompt)) {
    spec.explode = 0;
    changes.push('조립 상태');
  } else if (/분해|explode/.test(prompt)) {
    spec.explode = Math.max(spec.explode, 0.62);
    changes.push('분해도 배치');
  }
  if (/검정|black|graphite/.test(prompt)) {
    spec.frameColor = '#35383b';
    spec.glassColor = '#0b0e12';
    changes.push('그래파이트 외장');
  }
  if (/실버|silver|titanium|티타늄/.test(prompt)) {
    spec.frameColor = '#b9bab5';
    changes.push('실버 메탈 프레임');
  }
  if (/파랑|blue|cobalt/.test(prompt)) {
    spec.frameColor = '#485c74';
    changes.push('블루 메탈 프레임');
  }
  return { spec, changes };
}
