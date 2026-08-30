import type { AssetKind, ReferenceEvidence } from '../types';

function componentToHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

export async function analyzeReference(file: File, assetKind: AssetKind = 'human'): Promise<{ evidence: ReferenceEvidence; url: string }> {
  if (!file.type.startsWith('image/')) throw new Error('PNG, JPEG 또는 WebP 이미지를 선택해주세요.');
  if (file.size > 16 * 1024 * 1024) throw new Error('참고 이미지는 16MB 이하여야 합니다.');

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이미지 분석용 캔버스를 만들 수 없습니다.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    red += pixels[i] * alpha;
    green += pixels[i + 1] * alpha;
    blue += pixels[i + 2] * alpha;
    weight += alpha;
  }
  red /= Math.max(weight, 1);
  green /= Math.max(weight, 1);
  blue /= Math.max(weight, 1);
  const brightness = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
  const ratio = image.width / image.height;
  const ratioScore = assetKind === 'human'
    ? ratio >= 0.45 && ratio <= 0.9 ? 1 : ratio >= 0.3 && ratio <= 1.2 ? 0.7 : 0.38
    : ratio >= 0.65 && ratio <= 1.85 ? 1 : ratio >= 0.4 && ratio <= 2.4 ? 0.72 : 0.4;
  const resolutionScore = Math.min(1, Math.min(image.width, image.height) / 1200);
  const portraitSuitability = Math.round((ratioScore * 0.62 + resolutionScore * 0.38) * 100);
  const notes: string[] = [];
  if (resolutionScore < 0.55) notes.push(assetKind === 'human'
    ? '더 큰 이미지를 사용하면 얼굴과 재질 검수가 정확해집니다.'
    : '더 큰 이미지를 사용하면 부품 라벨·단자·재질 검수가 정확해집니다.');
  if (ratioScore < 0.7) notes.push(assetKind === 'human'
    ? '전신 정면 또는 3/4 구도의 세로 사진이 가장 좋습니다.'
    : '제품 전체가 잘리지 않은 정면·측면 또는 분해도 이미지를 권장합니다.');
  if (brightness < 0.2 || brightness > 0.86) notes.push('노출이 균일한 사진을 권장합니다.');
  if (notes.length === 0) notes.push(assetKind === 'human'
    ? '로컬 분석 기준으로 적합한 인물 참고 이미지입니다.'
    : '로컬 분석 기준으로 적합한 제품 참고 이미지입니다. 치수와 다중 시점을 함께 주면 정확도가 올라갑니다.');

  return {
    url,
    evidence: {
      fileName: file.name,
      width: image.width,
      height: image.height,
      averageColor: `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`,
      brightness,
      portraitSuitability,
      notes,
    },
  };
}
