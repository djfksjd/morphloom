export interface SilhouetteResidualViewInput {
  id: string;
  width: number;
  height: number;
  referenceMask: Uint8Array;
  candidateMask: Uint8Array;
}

export interface SilhouetteResidualCell {
  id: string;
  column: number;
  row: number;
  normalizedBounds: { x: number; y: number; width: number; height: number };
  referencePixels: number;
  candidatePixels: number;
  overlapPixels: number;
  missingPixels: number;
  excessPixels: number;
  localIoU: number;
  residualShare: number;
}

export interface SilhouetteResidualComponent {
  id: string;
  kind: 'missing' | 'excess';
  pixels: number;
  fractionOfViewResidual: number;
  normalizedBounds: { x: number; y: number; width: number; height: number };
  normalizedCentroid: { x: number; y: number };
}

export interface SilhouetteResidualViewReport {
  id: string;
  referencePixels: number;
  candidatePixels: number;
  overlapPixels: number;
  unionPixels: number;
  missingPixels: number;
  excessPixels: number;
  silhouetteIoU: number;
  referenceRecall: number;
  candidatePrecision: number;
  missingFraction: number;
  excessFraction: number;
  cells: SilhouetteResidualCell[];
  components: SilhouetteResidualComponent[];
  worstMissingCellId?: string;
  worstExcessCellId?: string;
}

export interface SilhouetteResidualLocalizationReport {
  schema: 'morphloom.silhouette-residual-localization/0.1';
  grid: { columns: number; rows: number };
  views: SilhouetteResidualViewReport[];
  minimumReferenceRecall: number;
  minimumCandidatePrecision: number;
  maximumMissingFraction: number;
  maximumExcessFraction: number;
  worstRecallViewId: string;
  worstPrecisionViewId: string;
  limitation: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const MAX_PIXELS = 16_777_216;
const MAX_VIEWS = 24;
const MAX_COMPONENTS_PER_KIND = 64;

function validateInput(view: SilhouetteResidualViewInput): void {
  const pixels = view?.width * view?.height;
  if (!SAFE_ID.test(view?.id ?? '')
    || !Number.isInteger(view?.width) || !Number.isInteger(view?.height)
    || view.width < 1 || view.height < 1 || !Number.isSafeInteger(pixels) || pixels > MAX_PIXELS
    || !(view.referenceMask instanceof Uint8Array) || view.referenceMask.length !== pixels
    || !(view.candidateMask instanceof Uint8Array) || view.candidateMask.length !== pixels) {
    throw new Error(`Invalid silhouette residual view: ${view?.id ?? 'missing'}.`);
  }
}

function residualComponents(
  view: SilhouetteResidualViewInput,
  kind: 'missing' | 'excess',
  minimumPixels: number,
  totalResidualPixels: number,
): SilhouetteResidualComponent[] {
  const pixels = view.width * view.height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  const active = (index: number): boolean => kind === 'missing'
    ? view.referenceMask[index]! !== 0 && view.candidateMask[index]! === 0
    : view.candidateMask[index]! !== 0 && view.referenceMask[index]! === 0;
  const components: Omit<SilhouetteResidualComponent, 'id'>[] = [];
  const neighbours = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
  for (let seed = 0; seed < pixels; seed += 1) {
    if (visited[seed] || !active(seed)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    visited[seed] = 1;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = view.width;
    let minY = view.height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % view.width;
      const y = Math.floor(index / view.width);
      count += 1;
      sumX += x + 0.5;
      sumY += y + 0.5;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of neighbours) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= view.width || nextY < 0 || nextY >= view.height) continue;
        const next = nextY * view.width + nextX;
        if (visited[next] || !active(next)) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (count < minimumPixels) continue;
    components.push({
      kind, pixels: count, fractionOfViewResidual: count / Math.max(1, totalResidualPixels),
      normalizedBounds: {
        x: minX / view.width, y: minY / view.height,
        width: (maxX - minX + 1) / view.width, height: (maxY - minY + 1) / view.height,
      },
      normalizedCentroid: { x: sumX / count / view.width, y: sumY / count / view.height },
    });
  }
  return components.sort((left, right) => right.pixels - left.pixels
    || left.normalizedBounds.y - right.normalizedBounds.y
    || left.normalizedBounds.x - right.normalizedBounds.x)
    .slice(0, MAX_COMPONENTS_PER_KIND)
    .map((component, index) => ({ ...component, id: `${view.id}:${kind}-${index + 1}` }));
}

/**
 * Localizes false-negative and false-positive silhouette pixels without
 * independently re-framing either image. Grid cells expose broad error zones;
 * connected components retain isolated cables, limbs, openings, and supports.
 */
export function auditSilhouetteResidualLocalization(
  views: SilhouetteResidualViewInput[],
  options: { columns?: number; rows?: number; minimumComponentPixels?: number; localize?: boolean } = {},
): SilhouetteResidualLocalizationReport {
  const columns = options.columns ?? 6;
  const rows = options.rows ?? 6;
  const minimumComponentPixels = options.minimumComponentPixels ?? 4;
  const localize = options.localize ?? true;
  if (!Array.isArray(views) || views.length < 1 || views.length > MAX_VIEWS
    || !Number.isInteger(columns) || columns < 2 || columns > 16
    || !Number.isInteger(rows) || rows < 2 || rows > 16
    || !Number.isInteger(minimumComponentPixels) || minimumComponentPixels < 1
    || minimumComponentPixels > 65_536 || typeof localize !== 'boolean') {
    throw new Error('Silhouette residual localization configuration is unsafe.');
  }
  const viewIds = new Set<string>();
  for (const view of views) {
    validateInput(view);
    if (viewIds.has(view.id)) throw new Error('Silhouette residual view ids must be unique.');
    if (localize && (columns > view.width || rows > view.height)) {
      throw new Error('Silhouette residual grid exceeds a view dimension.');
    }
    viewIds.add(view.id);
  }

  const reports = views.map((view): SilhouetteResidualViewReport => {
    let referencePixels = 0;
    let candidatePixels = 0;
    let overlapPixels = 0;
    let unionPixels = 0;
    let missingPixels = 0;
    let excessPixels = 0;
    for (let index = 0; index < view.referenceMask.length; index += 1) {
      const reference = view.referenceMask[index]! !== 0;
      const candidate = view.candidateMask[index]! !== 0;
      referencePixels += Number(reference);
      candidatePixels += Number(candidate);
      overlapPixels += Number(reference && candidate);
      unionPixels += Number(reference || candidate);
      missingPixels += Number(reference && !candidate);
      excessPixels += Number(candidate && !reference);
    }
    if (referencePixels === 0 || candidatePixels === 0) {
      throw new Error(`${view.id} silhouette residual comparison requires foreground in both masks.`);
    }
    const totalResidualPixels = missingPixels + excessPixels;
    const cells: SilhouetteResidualCell[] = [];
    for (let row = 0; localize && row < rows; row += 1) {
      const y0 = Math.floor(row * view.height / rows);
      const y1 = Math.floor((row + 1) * view.height / rows);
      for (let column = 0; column < columns; column += 1) {
        const x0 = Math.floor(column * view.width / columns);
        const x1 = Math.floor((column + 1) * view.width / columns);
        let cellReference = 0;
        let cellCandidate = 0;
        let cellOverlap = 0;
        let cellMissing = 0;
        let cellExcess = 0;
        for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
          const index = y * view.width + x;
          const reference = view.referenceMask[index]! !== 0;
          const candidate = view.candidateMask[index]! !== 0;
          cellReference += Number(reference);
          cellCandidate += Number(candidate);
          cellOverlap += Number(reference && candidate);
          cellMissing += Number(reference && !candidate);
          cellExcess += Number(candidate && !reference);
        }
        const cellUnion = cellReference + cellCandidate - cellOverlap;
        cells.push({
          id: `${view.id}:cell-${row + 1}-${column + 1}`, column, row,
          normalizedBounds: { x: x0 / view.width, y: y0 / view.height,
            width: (x1 - x0) / view.width, height: (y1 - y0) / view.height },
          referencePixels: cellReference, candidatePixels: cellCandidate, overlapPixels: cellOverlap,
          missingPixels: cellMissing, excessPixels: cellExcess,
          localIoU: cellUnion === 0 ? 1 : cellOverlap / cellUnion,
          residualShare: (cellMissing + cellExcess) / Math.max(1, totalResidualPixels),
        });
      }
    }
    const worstMissingCell = [...cells].sort((left, right) => right.missingPixels - left.missingPixels
      || right.residualShare - left.residualShare || left.id.localeCompare(right.id))[0];
    const worstExcessCell = [...cells].sort((left, right) => right.excessPixels - left.excessPixels
      || right.residualShare - left.residualShare || left.id.localeCompare(right.id))[0];
    const components = localize ? [
      ...residualComponents(view, 'missing', minimumComponentPixels, totalResidualPixels),
      ...residualComponents(view, 'excess', minimumComponentPixels, totalResidualPixels),
    ].sort((left, right) => right.pixels - left.pixels || left.id.localeCompare(right.id)) : [];
    return {
      id: view.id, referencePixels, candidatePixels, overlapPixels, unionPixels, missingPixels, excessPixels,
      silhouetteIoU: overlapPixels / unionPixels,
      referenceRecall: overlapPixels / referencePixels,
      candidatePrecision: overlapPixels / candidatePixels,
      missingFraction: missingPixels / referencePixels,
      excessFraction: excessPixels / candidatePixels,
      cells, components,
      worstMissingCellId: worstMissingCell && worstMissingCell.missingPixels > 0 ? worstMissingCell.id : undefined,
      worstExcessCellId: worstExcessCell && worstExcessCell.excessPixels > 0 ? worstExcessCell.id : undefined,
    };
  });
  const worstRecall = [...reports].sort((left, right) => left.referenceRecall - right.referenceRecall
    || left.id.localeCompare(right.id))[0]!;
  const worstPrecision = [...reports].sort((left, right) => left.candidatePrecision - right.candidatePrecision
    || left.id.localeCompare(right.id))[0]!;
  return {
    schema: 'morphloom.silhouette-residual-localization/0.1', grid: { columns, rows }, views: reports,
    minimumReferenceRecall: worstRecall.referenceRecall,
    minimumCandidatePrecision: worstPrecision.candidatePrecision,
    maximumMissingFraction: Math.max(...reports.map((view) => view.missingFraction)),
    maximumExcessFraction: Math.max(...reports.map((view) => view.excessFraction)),
    worstRecallViewId: worstRecall.id, worstPrecisionViewId: worstPrecision.id,
    limitation: 'Residual cells and connected components localize 2D disagreement under locked framing; they do not identify depth, hidden geometry, or a unique 3D repair without calibrated multi-view correspondence.',
  };
}
