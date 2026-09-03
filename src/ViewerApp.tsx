import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterBuild } from './engine/character';
import type { ProductBuild } from './engine/product';
import type { AssemblyIR } from './engine/assembly-ir';
import { validateAssemblyIR } from './engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from './engine/cooling-assembly';
import { GALAXY_Z_FOLD8_EXTERIOR_IR } from './engine/galaxy-fold8-exterior';
import { LAUREL_HOMES_BUILDING_B_IR } from './engine/laurel-homes-building-b';
import { MODERNCAT_CONCEPT_RESIDENCE_IR } from './engine/moderncat-concept-residence';
import { POOR_COYOTES_CABIN_IR } from './engine/poor-coyotes-cabin';
import { loadHumanPack } from './engine/ohpk';
import { evaluateProductQuality, evaluateQuality } from './engine/quality';
import { WEB_HERO_VISUAL_INTERPRETATION } from './engine/reference-pose';
import { buildPhysicalNetlist } from './engine/netlist';
import { createOrnateKnifeIR } from './engine/knife';
import { TALON_REFERENCE_BENCHMARK_IR } from './engine/talon-reference-benchmark';
import { ASPHALT_SURFACE_BENCHMARK_IR } from './engine/asphalt-surface-benchmark';
import { IMPLICIT_SURFACE_BENCHMARK_IR } from './engine/implicit-surface-benchmark';
import { editAssemblyLayout, isLayoutEditable } from './engine/layout-edit';
import {
  formatMeasurement,
  type MeasurementMode,
  type MeasurementResult,
  type MeasurementUnit,
} from './engine/measurement';
import {
  ResultViewport,
  type BuildingLevel,
  type ExportReceipt,
  type InspectablePart,
  type LightingMode,
  type ViewportHandle,
} from './components/ResultViewport';
import { ViewportErrorBoundary } from './components/ViewportErrorBoundary';
import { bytesLabel, type DeliveryAudit, type LocalBuildTelemetry } from './engine/delivery-validation';
import {
  createBrowserRoundTripAssetReceipt,
  createBrowserRoundTripReport,
  getBrowserConsoleEvidence,
  type BrowserProofDefinition,
  type BrowserRoundTripAssetReceipt,
} from './engine/browser-proof-recorder';
import { auditFidelityContract } from './engine/fidelity-pipeline';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec, ViewMode } from './types';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC, DEFAULT_SPEC, FIELD_HUMAN_SPEC, WEB_HERO_SPEC } from './types';

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: 'beauty', label: 'Beauty' },
  { id: 'clay', label: 'Clay' },
  { id: 'wireframe', label: 'Wire' },
  { id: 'rig', label: 'X-Ray' },
];

const IMPORTED_RESULT_TTL_MS = 30 * 60 * 1000;

type ViewerAsset = {
  id: string;
  label: string;
  caption: string;
  kind: 'human';
  spec: CharacterSpec;
} | {
  id: string;
  label: string;
  caption: string;
  kind: 'product';
  spec: ProductSpec;
  assemblyIR?: AssemblyIR;
};

type LocalJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
type LocalJob = {
  id: number;
  name: string;
  status: LocalJobStatus;
  action: () => Promise<ExportReceipt | void>;
  error?: string;
  durationMs?: number;
  outputBytes?: number;
  fileName?: string;
};

const VIEWER_ASSETS: ViewerAsset[] = [
  {
    id: 'implicit-surface', label: 'Implicit Surface Lab', caption: 'smooth union · real socket · manifold refinement', kind: 'product',
    spec: DEFAULT_PRODUCT_SPEC, assemblyIR: IMPLICIT_SURFACE_BENCHMARK_IR,
  },
  {
    id: 'asphalt-surface', label: 'Rough Asphalt Surface', caption: 'macro relief · aggregate PBR · deterministic', kind: 'product',
    spec: DEFAULT_PRODUCT_SPEC, assemblyIR: ASPHALT_SURFACE_BENCHMARK_IR,
  },
  {
    id: 'talon-reference', label: 'Talon Ruby — Same Reference', caption: 'real silhouette · true openings · estimated depth', kind: 'product',
    spec: DEFAULT_KNIFE_SPEC, assemblyIR: TALON_REFERENCE_BENCHMARK_IR,
  },
  {
    id: 'moderncat-concept', label: 'ModernCat Concept Residence', caption: 'Pinterest panel · concept evidence blocked', kind: 'product',
    spec: DEFAULT_PRODUCT_SPEC, assemblyIR: MODERNCAT_CONCEPT_RESIDENCE_IR,
  },
  {
    id: 'laurel-homes', label: 'Laurel Homes Apartments', caption: '9 units · 3 stairs · measured HABS plan', kind: 'product',
    spec: DEFAULT_PRODUCT_SPEC, assemblyIR: LAUREL_HOMES_BUILDING_B_IR,
  },
  {
    id: 'habs-cabin', label: 'HABS Measured Cabin', caption: '17′4″ × 13′10″ · architectural shell', kind: 'product',
    spec: DEFAULT_PRODUCT_SPEC, assemblyIR: POOR_COYOTES_CABIN_IR,
  },
  {
    id: 'fold8', label: 'Galaxy Z Fold8', caption: '2026 · Graphite · exterior', kind: 'product',
    spec: DEFAULT_PRODUCT_SPEC, assemblyIR: GALAXY_Z_FOLD8_EXTERIOR_IR,
  },
  {
    id: 'cooler', label: 'TEC Cooling Assembly', caption: '97 parts · connected harness', kind: 'product',
    spec: DEFAULT_PRODUCT_SPEC, assemblyIR: COOLING_ASSEMBLY_IR,
  },
  {
    id: 'phone', label: 'Phone Assembly', caption: '164 parts · exploded', kind: 'product',
    spec: DEFAULT_PRODUCT_SPEC,
  },
  {
    id: 'blade', label: 'Ornate Blade', caption: 'editable blade loft', kind: 'product',
    spec: DEFAULT_KNIFE_SPEC,
  },
  {
    id: 'web-hero', label: 'Web Hero', caption: 'posed character study', kind: 'human',
    spec: { ...DEFAULT_SPEC, ...WEB_HERO_SPEC },
  },
  {
    id: 'field-human', label: 'Field Human', caption: 'editable character base', kind: 'human',
    spec: FIELD_HUMAN_SPEC,
  },
];

function resolveInitialViewerAsset(): ViewerAsset {
  const requested = new URLSearchParams(window.location.search).get('asset');
  return VIEWER_ASSETS.find((asset) => asset.id === requested)
    ?? VIEWER_ASSETS.find((asset) => asset.id === 'fold8')!;
}

const BROWSER_PROOF_ASSETS: Record<string, BrowserProofDefinition> = {
  'asphalt-surface': { id: 'asphalt-print-surface', scope: '3d-print-surface-material', qualityReleaseReady: true },
  'moderncat-concept': { id: 'pinterest-concept-architectural-review', scope: 'concept-architecture', qualityReleaseReady: false },
  'laurel-homes': { id: 'laurel-homes-architectural-review', scope: 'measured-architecture', qualityReleaseReady: true },
  cooler: { id: 'cooling-service-assembly', scope: 'electromechanical-service-model', qualityReleaseReady: false },
  blade: { id: 'ornate-knife-product-visualization', scope: 'industrial-design', qualityReleaseReady: true },
  'web-hero': { id: 'single-view-character-previs', scope: 'single-view-character-previs', qualityReleaseReady: false },
  'field-human': { id: 'field-human-runtime-base', scope: 'animation-game-runtime', qualityReleaseReady: true },
};

const BROWSER_PROOF_EXPECTED_COUNT = Object.keys(BROWSER_PROOF_ASSETS).length;

function AppIcon() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <path d="M6 29V7h7.2L18 15l4.8-8H30v22h-6.2V17.4L18 26l-5.8-8.6V29H6Z" />
    </svg>
  );
}

function StatusMark({ status }: { status: 'pass' | 'warn' | 'blocked' }) {
  return <span className={`status-mark status-${status}`} aria-label={status} />;
}

function downloadJson(payload: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ViewerApp() {
  const initialAsset = useMemo(resolveInitialViewerAsset, []);
  const [pack, setPack] = useState<HumanPack>();
  const [packError, setPackError] = useState<string>();
  const [assetKind, setAssetKind] = useState<AssetKind>(initialAsset.kind);
  const [activeAssetId, setActiveAssetId] = useState(initialAsset.id);
  const [spec, setSpec] = useState<CharacterSpec>(initialAsset.kind === 'human' ? initialAsset.spec : DEFAULT_SPEC);
  const [productSpec, setProductSpec] = useState<ProductSpec>(initialAsset.kind === 'product' ? initialAsset.spec : DEFAULT_PRODUCT_SPEC);
  const [assemblyIR, setAssemblyIR] = useState<AssemblyIR | undefined>(initialAsset.kind === 'product' ? initialAsset.assemblyIR : undefined);
  const [mode, setMode] = useState<ViewMode>('beauty');
  const [buildMetrics, setBuildMetrics] = useState<CharacterBuild['metrics'] | ProductBuild['metrics']>();
  const [selectedPart, setSelectedPart] = useState<InspectablePart>();
  const [busyAction, setBusyAction] = useState<string>();
  const [jobs, setJobs] = useState<LocalJob[]>([]);
  const [deliveryAudit, setDeliveryAudit] = useState<DeliveryAudit>();
  const [deliveryVerifying, setDeliveryVerifying] = useState(true);
  const [browserProofReceipts, setBrowserProofReceipts] = useState<Record<string, BrowserRoundTripAssetReceipt>>({});
  const [telemetry, setTelemetry] = useState<LocalBuildTelemetry>();
  const [importedExpiresAt, setImportedExpiresAt] = useState<number>();
  const [viewerNote, setViewerNote] = useState('CLI/Codex에서 생성한 결과를 검수하는 읽기 전용 화면입니다.');
  const [measurementEnabled, setMeasurementEnabled] = useState(true);
  const measurementMode: MeasurementMode = 'distance';
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>('m');
  const [measurementResult, setMeasurementResult] = useState<MeasurementResult>();
  const [measurementPoints, setMeasurementPoints] = useState<0 | 1 | 2>(0);
  const [measurementMissed, setMeasurementMissed] = useState(false);
  const [dimensionOverviewEnabled, setDimensionOverviewEnabled] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [pipelineCollapsed, setPipelineCollapsed] = useState(false);
  const [buildingLevel, setBuildingLevel] = useState<BuildingLevel>('all');
  const [lightingMode, setLightingMode] = useState<LightingMode>('day');
  const viewportRef = useRef<ViewportHandle>(null);
  const irInputRef = useRef<HTMLInputElement>(null);
  const importExpiryTimerRef = useRef<number | undefined>(undefined);
  const jobSequenceRef = useRef(0);
  const jobsRef = useRef<LocalJob[]>([]);
  const activeJobRef = useRef<LocalJob | undefined>(undefined);
  const processNextJobRef = useRef<() => void>(() => undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    let active = true;
    loadHumanPack('/assets/oxihuman-core-v1.ohpk')
      .then((loaded) => { if (active) setPack(loaded); })
      .catch((error: unknown) => {
        if (active) setPackError(error instanceof Error ? error.message : '인체 팩을 불러오지 못했습니다.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (importExpiryTimerRef.current !== undefined) window.clearTimeout(importExpiryTimerRef.current);
      viewportRef.current?.cancelExport();
      jobsRef.current = [];
    };
  }, []);

  const syncJobs = useCallback(() => {
    if (mountedRef.current) setJobs([...jobsRef.current]);
  }, []);

  processNextJobRef.current = () => {
    if (activeJobRef.current) return;
    const next = jobsRef.current.find((job) => job.status === 'queued');
    if (!next) return;
    next.status = 'running';
    const startedAt = performance.now();
    activeJobRef.current = next;
    if (mountedRef.current) setBusyAction(next.name);
    syncJobs();
    void next.action()
      .then((receipt) => {
        if (next.status === 'cancelled') return;
        next.status = 'complete';
        if (receipt) {
          next.outputBytes = receipt.bytes;
          next.fileName = receipt.fileName;
        }
        if (mountedRef.current) setViewerNote(`${next.name} 작업을 완료했습니다. 브라우저 다운로드 목록에서 결과를 확인하세요.`);
      })
      .catch((error: unknown) => {
        if (next.status === 'cancelled') return;
        next.status = 'failed';
        next.error = error instanceof Error ? error.message : `${next.name} 작업에 실패했습니다.`;
        if (mountedRef.current) setViewerNote(next.error);
      })
      .finally(() => {
        next.durationMs = performance.now() - startedAt;
        activeJobRef.current = undefined;
        if (mountedRef.current) {
          setBusyAction(undefined);
          syncJobs();
          window.queueMicrotask(() => processNextJobRef.current());
        }
      });
  };

  const productMetrics = buildMetrics && 'parts' in buildMetrics && buildMetrics.bounds ? buildMetrics : undefined;
  const productConnectivity = productMetrics?.connectivity;
  const productEngineering = productMetrics?.engineering;
  const characterMetrics = buildMetrics && 'renderedTriangles' in buildMetrics ? buildMetrics : undefined;
  const productEnvelope = productMetrics ? {
    x: Math.round((productMetrics.bounds.max.x - productMetrics.bounds.min.x) * 1000),
    y: Math.round((productMetrics.bounds.max.y - productMetrics.bounds.min.y) * 1000),
    z: Math.round((productMetrics.bounds.max.z - productMetrics.bounds.min.z) * 1000),
  } : undefined;
  const quality = useMemo(() => {
    if (!pack) return undefined;
    return assetKind === 'human'
      ? evaluateQuality(pack, spec, undefined, characterMetrics, deliveryAudit)
      : evaluateProductQuality(productSpec, undefined, productMetrics, assemblyIR, deliveryAudit);
  }, [assemblyIR, assetKind, characterMetrics, deliveryAudit, pack, productMetrics, productSpec, spec]);
  const qualityBlocked = quality?.checks.some((check) => check.status === 'blocked') ?? false;
  const fidelityAudit = useMemo(() => assemblyIR?.fidelity
    ? auditFidelityContract(assemblyIR.fidelity, assemblyIR)
    : undefined, [assemblyIR]);
  const productPartCount = productMetrics?.parts;
  const architecturalResult = assemblyIR?.metadata?.assetKind === 'building';
  const surfaceBenchmarkResult = assemblyIR?.metadata?.scope === 'surface-material-benchmark';
  const activePreset = VIEWER_ASSETS.find((asset) => asset.id === activeAssetId);
  const baselineAssemblyIR = activePreset?.kind === 'product' ? activePreset.assemblyIR : assemblyIR;
  const layoutEditable = Boolean(selectedPart && assemblyIR && isLayoutEditable(selectedPart.id));
  const editSelectedLayout = useCallback((edit: Parameters<typeof editAssemblyLayout>[2]) => {
    if (!selectedPart || !assemblyIR) return;
    setAssemblyIR(editAssemblyLayout(assemblyIR, selectedPart.id, edit));
    setViewerNote(`${selectedPart.name} 배치를 모델 데이터에 반영했습니다. 내보내기에도 동일하게 포함됩니다.`);
  }, [assemblyIR, selectedPart]);
  const displayedTriangles = buildMetrics && 'renderedTriangles' in buildMetrics
    ? buildMetrics.renderedTriangles
    : buildMetrics?.triangles;

  const handleBuilt = useCallback((build: CharacterBuild | ProductBuild) => {
    // Clay/wire/X-ray are inspection render modes, not different deliverables.
    // Keep the quality evidence tied to the beauty/export build so toggling a
    // viewport aid cannot lower or inflate the product score.
    if (mode === 'beauty') setBuildMetrics(build.metrics);
  }, [mode]);

  const handleMeasurementChange = useCallback((result: MeasurementResult | undefined, points: 0 | 1 | 2) => {
    setMeasurementResult(result);
    setMeasurementPoints(points);
    setMeasurementMissed(false);
  }, []);

  const handleDeliveryAudit = useCallback((audit: DeliveryAudit | undefined) => {
    setDeliveryAudit(audit);
    setDeliveryVerifying(audit === undefined);
  }, []);

  useEffect(() => {
    const definition = BROWSER_PROOF_ASSETS[activeAssetId];
    if (!definition || !deliveryAudit || deliveryAudit.status === 'running') return;
    const receipt = createBrowserRoundTripAssetReceipt(definition, deliveryAudit);
    setBrowserProofReceipts((current) => {
      const previous = current[definition.id];
      if (previous
        && previous.sceneFingerprint === receipt.sceneFingerprint
        && previous.status === receipt.status
        && previous.glbBytes === receipt.glbBytes) return current;
      return { ...current, [definition.id]: receipt };
    });
  }, [activeAssetId, deliveryAudit]);

  const clearMeasurement = useCallback(() => {
    viewportRef.current?.clearMeasurement();
    setMeasurementResult(undefined);
    setMeasurementPoints(0);
    setMeasurementMissed(false);
    setDimensionOverviewEnabled(false);
  }, []);

  const toggleMeasurement = useCallback(() => {
    const next = !measurementEnabled;
    setMeasurementEnabled(next);
    if (!next) clearMeasurement();
  }, [clearMeasurement, measurementEnabled]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === 'Escape' && measurementEnabled) {
        clearMeasurement();
        return;
      }
      if (event.key.toLowerCase() === 'm' && assetKind === 'product') toggleMeasurement();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [assetKind, clearMeasurement, measurementEnabled, toggleMeasurement]);

  const selectAsset = (id: string) => {
    // A native select can dispatch change even when automation or assistive
    // technology re-selects its current option. Do not clear a valid delivery
    // result when the underlying asset identity has not changed.
    if (id === activeAssetId) return;
    const next = VIEWER_ASSETS.find((item) => item.id === id);
    if (!next) return;
    setActiveAssetId(next.id);
    setAssetKind(next.kind);
    setSelectedPart(undefined);
    setBuildMetrics(undefined);
    setMode('beauty');
    setBuildingLevel('all');
    setLightingMode('day');
    viewportRef.current?.setBuildingLevel('all');
    viewportRef.current?.setLighting('day');
    setMeasurementEnabled(next.kind === 'product');
    setMeasurementUnit(next.kind === 'product' && next.assemblyIR?.metadata?.assetKind === 'building' ? 'm' : 'mm');
    setMeasurementResult(undefined);
    setMeasurementPoints(0);
    setMeasurementMissed(false);
    setDeliveryAudit(undefined);
    setDeliveryVerifying(true);
    setTelemetry(undefined);
    setImportedExpiresAt(undefined);
    if (importExpiryTimerRef.current !== undefined) {
      window.clearTimeout(importExpiryTimerRef.current);
      importExpiryTimerRef.current = undefined;
    }
    if (next.kind === 'human') {
      setSpec(next.spec);
      setAssemblyIR(undefined);
    } else {
      setProductSpec(next.spec);
      setAssemblyIR(next.assemblyIR);
    }
    setViewerNote(`${next.label} 결과를 불러왔습니다.`);
  };

  const clearImportedSession = () => {
    if (importExpiryTimerRef.current !== undefined) window.clearTimeout(importExpiryTimerRef.current);
    importExpiryTimerRef.current = undefined;
    setImportedExpiresAt(undefined);
    if (activeAssetId === 'imported') selectAsset('laurel-homes');
    setViewerNote('가져온 결과를 브라우저 메모리에서 제거했습니다. 원본 파일은 서버로 업로드되지 않았습니다.');
  };

  const scheduleImportedExpiry = () => {
    if (importExpiryTimerRef.current !== undefined) window.clearTimeout(importExpiryTimerRef.current);
    const expiresAt = Date.now() + IMPORTED_RESULT_TTL_MS;
    setImportedExpiresAt(expiresAt);
    importExpiryTimerRef.current = window.setTimeout(() => {
      importExpiryTimerRef.current = undefined;
      setImportedExpiresAt(undefined);
      const fallback = VIEWER_ASSETS[0];
      setActiveAssetId(fallback.id);
      setAssetKind(fallback.kind);
      if (fallback.kind === 'product') {
        setProductSpec(fallback.spec);
        setAssemblyIR(fallback.assemblyIR);
      } else {
        setSpec(fallback.spec);
        setAssemblyIR(undefined);
      }
      setSelectedPart(undefined);
      setDeliveryAudit(undefined);
      setDeliveryVerifying(true);
      setTelemetry(undefined);
      setViewerNote('가져온 결과가 30분 보존기간 만료로 브라우저 메모리에서 자동 제거되었습니다.');
    }, IMPORTED_RESULT_TTL_MS);
  };

  const runAction = (name: string, action: () => Promise<ExportReceipt | void>) => {
    const unfinished = jobsRef.current.filter((job) => job.status === 'queued' || job.status === 'running').length;
    if (unfinished >= 6) {
      setViewerNote('로컬 내보내기 대기열은 최대 6개입니다. 완료 또는 취소 후 다시 시도하세요.');
      return;
    }
    const job: LocalJob = { id: ++jobSequenceRef.current, name, action, status: 'queued' };
    const retainedUnfinished = jobsRef.current.filter((item) => item.status === 'queued' || item.status === 'running');
    const retainedFinished = jobsRef.current
      .filter((item) => item.status !== 'queued' && item.status !== 'running')
      .slice(-Math.max(0, 7 - retainedUnfinished.length));
    const retained = retainedUnfinished.concat(retainedFinished);
    jobsRef.current = [...retained, job];
    syncJobs();
    setViewerNote(`${name} 작업을 로컬 대기열에 추가했습니다.`);
    window.queueMicrotask(() => processNextJobRef.current());
  };

  const cancelJob = (id: number) => {
    const job = jobsRef.current.find((item) => item.id === id);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    if (job.status === 'running') viewportRef.current?.cancelExport();
    job.status = 'cancelled';
    syncJobs();
    setViewerNote(`${job.name} 작업을 취소했습니다.`);
  };

  const retryJob = (id: number) => {
    const job = jobsRef.current.find((item) => item.id === id);
    if (!job || job.status !== 'failed') return;
    runAction(job.name, job.action);
  };

  const queueLocked = jobs.some((job) => job.status === 'queued' || job.status === 'running');

  const activeName = assetKind === 'human'
    ? spec.outfit === 'web-hero' ? 'ML—WEB_HERO_01' : 'ML—HUMAN_BASE'
    : assemblyIR ? assemblyIR.name.toUpperCase() : productSpec.kind === 'smartphone' ? 'ML—PHONE_ASSEMBLY' : 'ML—ORNATE_BLADE';
  const sourcePayload = assetKind === 'human'
    ? { schema: 'morphloom.character/0.2', spec, interpretation: spec.outfit === 'web-hero' ? WEB_HERO_VISUAL_INTERPRETATION : undefined }
    : assemblyIR
      ?? (productSpec.kind === 'ornate-knife'
        ? createOrnateKnifeIR(productSpec)
        : { schema: 'morphloom.product/0.2', units: 'mm', kind: productSpec.kind, spec: productSpec });
  const sourceFileName = assetKind === 'human'
    ? 'character-ir.json'
    : 'components' in sourcePayload ? 'assembly-ir.json' : 'product-spec.json';
  const evidenceBoundary = assetKind === 'human'
    ? spec.outfit === 'web-hero'
      ? 'Single-view character likeness and hidden depth remain evidence-limited; this is an editable previs base.'
      : 'Procedural editable human base; identity likeness is not claimed.'
    : productEngineering?.productionReady
      ? 'All recorded digital and physical release gates pass.'
      : architecturalResult
        ? 'Architectural review shell only; survey, structure, MEP and as-built certification are excluded.'
        : productEngineering?.electricalApplicable
          ? 'Digital assembly is separate from physical bench continuity and manufacturing approval.'
          : 'Editable visualization asset; manufacturing STEP/BREP approval is excluded.';
  const primaryMeasurement = measurementResult
    ? measurementResult.distanceMeters
    : undefined;
  const measurementPrompt = !measurementEnabled
    ? '실측 시작을 눌러 켜세요'
    : measurementMissed
      ? '표면이 선택되지 않았습니다 · 모델 위를 다시 선택하세요'
    : measurementPoints === 0
      ? '표면에서 A점을 선택하세요'
      : measurementPoints === 1
        ? '표면에서 B점을 선택하세요'
        : '완료 · 다음 선택은 새 A점';

  return (
    <main className={`app-shell viewer-shell${pipelineCollapsed ? ' pipeline-is-collapsed' : ''}`}>
      <header className="topbar viewer-topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><AppIcon /></span>
          <span className="brand-name">MORPHLOOM</span>
          <span className="brand-edition">Result Viewer / α04</span>
        </div>
        <div className="result-selector">
          <span>ACTIVE RESULT</span>
          <select
            disabled={queueLocked}
            aria-disabled={queueLocked || deliveryVerifying}
            value={activeAssetId}
            onChange={(event) => { if (!deliveryVerifying) selectAsset(event.target.value); }}
            aria-label="검수할 결과 선택"
          >
            {activeAssetId === 'imported' && <option value="imported">Imported AssemblyIR</option>}
            {VIEWER_ASSETS.map((item) => <option value={item.id} key={item.id}>{item.label} — {item.caption}</option>)}
          </select>
        </div>
        <div className="topbar-status">
          <span><i className="pulse-dot" /> LOCAL · NO UPLOAD</span>
          <span>{assetKind === 'product' ? `${productPartCount ?? '—'} PART NODES` : pack ? `${(buildMetrics?.vertices ?? 0).toLocaleString()} SKIN VERTICES` : 'LOADING PACK'}</span>
          <a href="https://github.com/djfksjd/morphloom" target="_blank" rel="noreferrer">OPEN SOURCE ↗</a>
        </div>
      </header>

      <section className={`studio-grid viewer-grid${inspectorCollapsed ? ' inspector-is-collapsed' : ''}`}>
        <section className="viewport-panel" aria-label="3D 결과 검수 뷰포트">
          <div className="viewport-toolbar">
            <div className="toolbar-cluster">
              <div className="mode-switcher" role="group" aria-label="뷰포트 표시 모드">
                {MODES.map((item) => (
                  <button key={item.id} className={mode === item.id ? 'active' : ''} onClick={() => setMode(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="view-switcher" role="group" aria-label="고정 카메라 시점">
                {assetKind === 'human' && <button onClick={() => viewportRef.current?.setView('front')}>FRONT</button>}
                <button onClick={() => viewportRef.current?.setView('iso')}>ISO</button>
                {assetKind === 'product' && <button onClick={() => viewportRef.current?.setView('top')}>
                  {assemblyIR?.metadata?.assetKind === 'building' ? 'PLAN' : 'TOP'}
                </button>}
                <button onClick={() => viewportRef.current?.setView('rear')}>REAR</button>
              </div>
              {assemblyIR?.metadata?.assetKind === 'building' && (
                <div className="view-switcher level-switcher" role="group" aria-label="건물 층 표시">
                  {(['all', 'L1', 'L2'] as BuildingLevel[]).map((level) => (
                    <button
                      key={level}
                      className={buildingLevel === level ? 'active' : ''}
                      aria-pressed={buildingLevel === level}
                      onClick={() => {
                        setBuildingLevel(level);
                        setSelectedPart(undefined);
                        clearMeasurement();
                        viewportRef.current?.setBuildingLevel(level);
                      }}
                    >
                      {level === 'all' ? 'ALL' : level}
                    </button>
                  ))}
                </div>
              )}
              {assemblyIR?.metadata?.assetKind === 'building' && (
                <div className="view-switcher lighting-switcher" role="group" aria-label="낮과 밤 조명 미리보기">
                  {(['day', 'night'] as LightingMode[]).map((item) => (
                    <button
                      key={item}
                      className={lightingMode === item ? 'active' : ''}
                      aria-pressed={lightingMode === item}
                      onClick={() => {
                        setLightingMode(item);
                        viewportRef.current?.setLighting(item);
                        setViewerNote(item === 'night' ? '야간 조명과 등기구 광원을 표시합니다.' : '주간 자연광 검수 모드입니다.');
                      }}
                    >{item === 'day' ? 'DAY' : 'NIGHT'}</button>
                  ))}
                </div>
              )}
            </div>
            <span className="viewport-hint">DRAG ORBIT · WHEEL ZOOM · SPACE + DRAG PAN</span>
          </div>

          {assetKind === 'product' && (
            <div className={`cad-measure-toolbar${measurementEnabled ? ' is-active' : ''}`} aria-label="CAD 실측 도구">
              <button
                className="measure-toggle"
                aria-pressed={measurementEnabled}
                aria-label={measurementEnabled ? '실측 도구 끄기' : '실측 도구 켜기'}
                title="실측 켜기/끄기 (M)"
                onClick={toggleMeasurement}
              >
                <i /> {measurementEnabled ? '실측 켜짐' : '실측 시작'}
              </button>
              <div className="measure-progress" aria-label={`실측 진행 ${measurementPoints}/2점`}>
                <span className={measurementPoints >= 1 ? 'is-complete' : measurementEnabled ? 'is-current' : ''}><b>A</b><small>시작점</small></span>
                <i />
                <span className={measurementPoints >= 2 ? 'is-complete' : measurementPoints === 1 ? 'is-current' : ''}><b>B</b><small>끝점</small></span>
              </div>
              <div className="measure-mode-switch" role="group" aria-label="측정 종류">
                <button aria-pressed="true" disabled={!measurementEnabled} className="active">직선거리</button>
                <button
                  aria-pressed={dimensionOverviewEnabled}
                  className={dimensionOverviewEnabled ? 'active overview-active' : ''}
                  onClick={() => {
                    setDimensionOverviewEnabled((enabled) => !enabled);
                    setViewerNote(dimensionOverviewEnabled ? '주요 부재 치수선을 숨겼습니다.' : '주요 부재의 폭·깊이와 세로 높이 치수선을 겹침 없이 표시합니다.');
                  }}
                >주요 치수 보기</button>
              </div>
              <label className="measure-unit-select">
                <span>UNIT</span>
                <select disabled={!measurementEnabled && !dimensionOverviewEnabled} value={measurementUnit} onChange={(event) => setMeasurementUnit(event.target.value as MeasurementUnit)}>
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </label>
              <button className="measure-clear" title="측정 지우기 (Esc)" onClick={clearMeasurement} disabled={!measurementEnabled || measurementPoints === 0}>지우기</button>
              <span className="measure-prompt"><b>SURFACE PICK · 2 POINT</b>{measurementPrompt}</span>
              {measurementResult && primaryMeasurement !== undefined && (
                <div className="measure-live-result">
                  <span><b>DISTANCE</b>{formatMeasurement(primaryMeasurement, measurementUnit)}</span>
                </div>
              )}
            </div>
          )}

          {dimensionOverviewEnabled && (
            <div className="dimension-overview-key" role="status">
              <b>ARCHITECTURAL DIMENSIONS</b>
              <span><i className="dimension-width-key" /> W 폭 · D 깊이</span>
              <span><i className="dimension-height-key" /> H 높이</span>
              <small>주요 부재 우선 · 반복 소부품 자동 정리</small>
            </div>
          )}

          <div className="viewport-zoom-controls" role="group" aria-label="화면 확대 축소와 초기화">
            <button aria-label="확대" title="확대" onClick={() => viewportRef.current?.zoomBy(1.25)}>+</button>
            <button aria-label="축소" title="축소" onClick={() => viewportRef.current?.zoomBy(0.8)}>−</button>
            <button className="reset-view" aria-label="화면 초기화" title="화면 초기화" onClick={() => {
              viewportRef.current?.fitAsset();
              setViewerNote('카메라 중심과 배율을 초기 상태로 되돌렸습니다.');
            }}>↺</button>
          </div>

          <div className="viewfinder-corners" aria-hidden="true"><i /><i /><i /><i /></div>
          {pack ? (
            <ViewportErrorBoundary resetKey={activeAssetId}>
              <ResultViewport
                ref={viewportRef}
                assetKind={assetKind}
                pack={pack}
                spec={spec}
                productSpec={productSpec}
                assemblyIR={assemblyIR}
                mode={mode}
                measurementEnabled={measurementEnabled}
                measurementMode={measurementMode}
                measurementUnit={measurementUnit}
                dimensionOverviewEnabled={dimensionOverviewEnabled}
                onBuilt={handleBuilt}
                onPartSelected={setSelectedPart}
                onMeasurementChange={handleMeasurementChange}
                onMeasurementMiss={() => setMeasurementMissed(true)}
                onDeliveryAudit={handleDeliveryAudit}
                onTelemetry={setTelemetry}
              />
            </ViewportErrorBoundary>
          ) : (
            <div className="viewport-loading">
              {packError ? <><b>인체 팩 로드 실패</b><span>{packError}</span></> : <><i /><b>결과 뷰어 준비 중</b><span>로컬 메시와 재질을 불러옵니다.</span></>}
            </div>
          )}

          <div className="viewport-title">
            <span>REVIEWING</span>
            <strong>{activeName}</strong>
          </div>
          {architecturalResult && mode === 'beauty' && (
            <div className="architectural-material-legend" aria-label="공간 마감 색상 범례">
              <span className="legend-title">ROOM FINISH</span>
              <span><i className="finish-living" />거실</span>
              <span><i className="finish-bedroom" />침실</span>
              <span><i className="finish-kitchen" />주방</span>
              <span><i className="finish-bath" />욕실</span>
              <span><i className="finish-passage" />통로</span>
            </div>
          )}
          <div className="measure-readout">
            <span>{assetKind === 'human' ? 'HEIGHT' : 'ENVELOPE'} <b>{assetKind === 'human'
              ? `${spec.heightCm} cm`
              : assemblyIR && productEnvelope
                ? `${productEnvelope.x}×${productEnvelope.y}×${productEnvelope.z}`
                : `${productSpec.widthMm}×${productSpec.heightMm}`}</b></span>
            {assetKind === 'product' && <span>PARTS <b>{productPartCount ?? '—'}</b></span>}
            <span>TRIS <b>{displayedTriangles?.toLocaleString() ?? '—'}</b></span>
            <span>ENGINE <b>{assetKind === 'human' ? 'OHPK/JS' : 'IR/JS'}</b></span>
          </div>
          <div className="axis-glyph" aria-hidden="true"><i className="axis-y" /><i className="axis-x" /><span>Y</span><b>X</b></div>
        </section>

        <aside className={`panel inspector-panel result-inspector${inspectorCollapsed ? ' is-collapsed' : ''}`}>
          <button
            className="panel-collapse-button inspector-collapse-button"
            aria-expanded={!inspectorCollapsed}
            aria-label={inspectorCollapsed ? '오른쪽 검사 패널 펼치기' : '오른쪽 검사 패널 접기'}
            title={inspectorCollapsed ? '검사 패널 펼치기' : '검사 패널 접기'}
            onClick={() => setInspectorCollapsed((collapsed) => !collapsed)}
          >{inspectorCollapsed ? '‹' : '›'}</button>
          <div className="panel-heading quality-heading">
            <div><span className="eyebrow">model completeness</span><h2>Model quality</h2></div>
            <div className={`quality-total ${qualityBlocked ? 'has-blocker' : ''}`}>
              <strong>{quality?.total ?? '—'}</strong><span>/100</span>{qualityBlocked && <em>BLOCKED</em>}
            </div>
          </div>

          {(architecturalResult || surfaceBenchmarkResult) && quality && (
            <div className={`evidence-boundary ${quality.deliveryReady ? 'is-ready' : 'is-review'}`}>
              <span>SOURCE CONFIDENCE</span><b>{quality.evidenceScore ?? '—'}/100</b>
              <p>{quality.deliveryReady
                ? '검증된 실측 근거로 납품 판정 가능'
                : surfaceBenchmarkResult
                  ? '모델 완성도와 별도입니다. 특정 현장의 스캔·입도·높이 보정 전에는 재질 프리셋으로 사용합니다.'
                  : '모델 완성도와 별도입니다. 현장 실측·검증 단면이 없어 시공 납품은 보류됩니다.'}</p>
            </div>
          )}

          <div className="viewer-note"><span>CLI → IR → VIEWER</span><p>{viewerNote}</p></div>

          {assemblyIR?.fidelity && fidelityAudit && (
            <div className={`selected-part-card fidelity-contract-card${fidelityAudit.pass ? ' is-ready' : ' is-blocked'}`}>
              <span className="eyebrow">locked fidelity contract</span>
              <b>{fidelityAudit.pass ? '8-PASS REVIEW READY' : 'FIDELITY CONTRACT BLOCKED'}</b>
              <small>{assemblyIR.fidelity.details.length} DETAILS · {assemblyIR.fidelity.materialRegions.length} MATERIAL REGIONS · {assemblyIR.fidelity.cameras.length} CALIBRATED VIEWS</small>
              <p>{fidelityAudit.pass
                ? `부품 매핑 ${Math.round(fidelityAudit.componentCoverage * 100)}% · 특징별 합격선 ${Math.round(assemblyIR.fidelity.targetFidelity * 100)}% · 최대 ${assemblyIR.fidelity.maxTotalIterations}회`
                : fidelityAudit.blockers.slice(0, 3).join(' · ')}</p>
            </div>
          )}

          {assetKind === 'product' && (
            <section className={`measurement-console${measurementEnabled ? ' is-active' : ''}`} aria-label="실측 결과" aria-live="polite">
              <header>
                <div><span>02 / SURFACE MEASURE</span><b>두 점 실측</b></div>
                <em>{measurementEnabled ? `${measurementPoints}/2 POINTS` : 'OFF'}</em>
              </header>
              {measurementResult && primaryMeasurement !== undefined ? (
                <>
                  <div className="measurement-primary">
                    <span>3D 직선거리</span>
                    <strong>{formatMeasurement(primaryMeasurement, measurementUnit)}</strong>
                  </div>
                  <div className="measurement-deltas">
                    <span>ΔX<b>{formatMeasurement(measurementResult.deltaMeters.x, measurementUnit)}</b></span>
                    <span>ΔY<b>{formatMeasurement(measurementResult.deltaMeters.y, measurementUnit)}</b></span>
                    <span>ΔZ<b>{formatMeasurement(measurementResult.deltaMeters.z, measurementUnit)}</b></span>
                  </div>
                  <p>A·B 표면 좌표 기준 · 다음 표면을 선택하면 새 측정이 시작됩니다.</p>
                </>
              ) : (
                <div className="measurement-empty">
                  <div className="measurement-caliper" aria-hidden="true"><i>A</i><span /><i>B</i></div>
                  <p>{measurementPrompt}</p>
                  <small>모델을 드래그하면 회전 · 클릭하면 점 선택 · M 켜기/끄기 · Esc 지우기</small>
                </div>
              )}
            </section>
          )}

          <div className="quality-list">
            {quality?.checks.map((check) => (
              <div className="quality-row" key={check.id}>
                <StatusMark status={check.status} />
                <div><b>{check.label}</b><small>{check.detail}</small></div>
                <strong>{check.score}</strong>
              </div>
            )) ?? <div className="quality-skeleton" />}
          </div>

          {selectedPart && (
            <div className="selected-part-card">
              <span className="eyebrow">selected component</span><b>{selectedPart.name}</b>
              <small>{selectedPart.category.toUpperCase()} · {selectedPart.material} · {selectedPart.surface.toUpperCase()}</small>
              <p>{selectedPart.detail}</p>
              {layoutEditable && assemblyIR && (
                <div className="layout-editor" aria-label="선택 가구 배치 편집">
                  <span>LAYOUT EDIT · 250 mm</span>
                  <div>
                    <button onClick={() => editSelectedLayout({ kind: 'translate', deltaMm: [-250, 0, 0] })}>←</button>
                    <button onClick={() => editSelectedLayout({ kind: 'translate', deltaMm: [0, 0, -250] })}>↑</button>
                    <button onClick={() => editSelectedLayout({ kind: 'translate', deltaMm: [0, 0, 250] })}>↓</button>
                    <button onClick={() => editSelectedLayout({ kind: 'translate', deltaMm: [250, 0, 0] })}>→</button>
                    <button onClick={() => editSelectedLayout({ kind: 'rotateY', radians: -Math.PI / 12 })}>↺ 15°</button>
                    <button onClick={() => editSelectedLayout({ kind: 'rotateY', radians: Math.PI / 12 })}>↻ 15°</button>
                    <button onClick={() => baselineAssemblyIR && editSelectedLayout({ kind: 'reset', source: baselineAssemblyIR })}>RESET</button>
                  </div>
                  <small>새 가구·조명은 CLI/Codex에 자연어로 요청하면 같은 편집 가능한 IR 부품으로 추가됩니다.</small>
                </div>
              )}
            </div>
          )}

          {assetKind === 'product' && productMetrics && (
            <div className="surface-audit" aria-label="PBR 표면 검사 결과">
              <span><b>{productMetrics.surfaces.distinctFinishes}</b> finishes</span>
              <span><b>{productMetrics.surfaces.microNormalMaterials}</b> micro normal</span>
              <span><b>{productMetrics.surfaces.anisotropicMaterials}</b> anisotropic</span>
              <span><b>{productMetrics.surfaces.transmissionMaterials}</b> optical</span>
            </div>
          )}

          {assetKind === 'product' && productEngineering && (
            <div className="selected-part-card engineering-read-card">
              <span className="eyebrow">engineering evidence audit</span>
              <b>{productEngineering.electricalApplicable
                ? `${productEngineering.digitalReady ? 'DIGITAL CONNECTED' : 'DIGITAL BLOCKED'} · ${productEngineering.productionReady ? 'BENCH RELEASED' : 'PHYSICAL QA REQUIRED'}`
                : architecturalResult
                  ? `${productEngineering.digitalReady ? 'ARCHITECTURE COMPILED' : 'EVIDENCE BLOCKED'} · ${productEngineering.productionReady ? 'SOURCE RELEASED' : 'SITE QA REQUIRED'}`
                : `${productEngineering.digitalReady ? 'EXTERIOR COMPILED' : 'EVIDENCE BLOCKED'} · ${productEngineering.productionReady ? 'SOURCE RELEASED' : 'SOURCE QA REQUIRED'}`}</b>
              <small>{productEngineering.electricalApplicable
                ? `PIN ${Math.round(productEngineering.physicalPinCoverage * 100)}% · AWG ${Math.round(productEngineering.conductorGaugeCoverage * 100)}% · VERIFY ${Math.round(productEngineering.conductorVerificationCoverage * 100)}%`
                : architecturalResult
                  ? `PLAN EVIDENCE ${Math.round(productEngineering.componentEvidenceCoverage * 100)}% · STRUCTURE/MEP EXCLUDED`
                : 'EXTERIOR SCOPE · INTERNAL ELECTRICAL EXCLUDED'}</small>
              <p>실측/데이터시트 {productEngineering.componentEvidence.measured + productEngineering.componentEvidence.datasheet} · 추정 {productEngineering.componentEvidence.estimated} · 숨은 형상 {productEngineering.componentEvidence.inferred}</p>
              <div className="semantic-tags">
                {productEngineering.electricalApplicable ? <>
                  <span>{productEngineering.passiveNodes} passive nodes</span>
                  <span>{productEngineering.benchRequiredWires} polarity checks</span>
                  <span>live anchors {productConnectivity?.liveAnchors ? 'on' : 'off'}</span>
                </> : <>
                  <span>{architecturalResult ? 'architectural shell' : 'exterior only'}</span><span>{productEngineering.componentEvidence.datasheet} datasheet</span>
                  <span>{productEngineering.componentEvidence.estimated} image-scaled</span>
                </>}
              </div>
            </div>
          )}

          {assetKind === 'human' && spec.outfit === 'web-hero' && (
            <div className="selected-part-card semantic-read-card">
              <span className="eyebrow">agent visual interpretation</span><b>일반인 코스프레 · 슬림 소프트</b>
              <small>HIDDEN DEPTH = INFERRED</small>
              <p>{WEB_HERO_VISUAL_INTERPRETATION.observations.slice(1, 6).map((item) => item.label).join(' · ')}</p>
            </div>
          )}

          {assetKind === 'product' && assemblyIR && (
            <div className="parameter-section product-controls">
              <div className="subheading-row"><span className="eyebrow">assembly ir inspector</span><span className="local-badge">READ ONLY</span></div>
              <div className="assembly-summary">
                <span><b>{assemblyIR.components.length}</b> source parts</span>
                <span><b>{productConnectivity?.wires ?? 0}</b> conductors</span>
                <span><b>{productConnectivity?.documentedPhysicalPins ?? 0}</b> physical pins</span>
              </div>
              <div className="selected-part-card imported-ir-card">
                <b>{assemblyIR.name}</b><small>{assemblyIR.units.toUpperCase()} · {assemblyIR.schema}</small>
                <p>{String(assemblyIR.metadata?.evidencePolicy ?? '에이전트가 기록한 근거와 추정값을 보존합니다.')}</p>
              </div>
            </div>
          )}

          <section className={`delivery-console status-${deliveryAudit?.status ?? 'running'}`} aria-label="내보내기 및 비용 검증">
            <header>
              <div><span className="eyebrow">delivery proof</span><b>실제 GLB 재열기</b></div>
              <em>{deliveryAudit ? deliveryAudit.status.toUpperCase() : 'VERIFYING'}</em>
            </header>
            <div className="delivery-grid">
              <span>FINGERPRINT<b>{deliveryAudit?.fingerprint ?? '계산 중'}</b></span>
              <span>BUILD KEY<b>{deliveryAudit?.buildFingerprint ?? '계산 중'}</b></span>
              <span>INPUT KEY<b>{deliveryAudit?.inputFingerprint ?? '계산 중'}</b></span>
              <span>GLB SIZE<b>{bytesLabel(deliveryAudit?.glbBytes ?? 0)}</b></span>
              <span>BOUNDS DRIFT<b>{deliveryAudit ? `${deliveryAudit.boundsErrorMm.toFixed(3)} mm` : '—'}</b></span>
              <span>NAMED NODES<b>{deliveryAudit ? `${Math.round(deliveryAudit.namedNodeCoverage * 100)}%` : '—'}</b></span>
              {(deliveryAudit?.source?.skeletons ?? 0) > 0 && (
                <span>RIG / MOTION<b>{deliveryAudit?.reopened?.skeletons ?? 0} skeleton · {deliveryAudit?.reopened?.bones ?? 0} bones · {deliveryAudit?.reopened?.animationClips ?? 0} clip / {deliveryAudit?.reopened?.animationTracks ?? 0} tracks</b></span>
              )}
              {(deliveryAudit?.source?.morphTargets ?? 0) > 0 && (
                <span>FACE CONTROLS<b>{deliveryAudit?.reopened?.morphTargets ?? 0} morph targets · GLB names preserved</b></span>
              )}
              {(deliveryAudit?.source?.gameLods ?? 0) > 0 && (
                <span>GAME DELIVERY<b>{deliveryAudit?.reopened?.gameLods ?? 0} LOD profile · {deliveryAudit?.reopened?.collisionPrimitives ?? 0} collision primitives</b></span>
              )}
            </div>
            <p>{deliveryAudit?.status === 'blocked'
              ? deliveryAudit.blockers.join(' · ')
              : 'GLB를 메모리에서 다시 열어 메시·삼각형·명명 노드·포락을 원본과 비교합니다.'}</p>
            <div className="browser-proof-progress" aria-label="브라우저 왕복 검증 수집 현황">
              <span><b>ACTUAL BROWSER PROOF</b>{Object.keys(browserProofReceipts).length}/{BROWSER_PROOF_EXPECTED_COUNT} ASSETS</span>
              <button
                disabled={Object.keys(browserProofReceipts).length === 0}
                onClick={() => {
                  const report = createBrowserRoundTripReport(
                    Object.values(browserProofReceipts),
                    getBrowserConsoleEvidence(),
                  );
                  downloadJson(report, 'morphloom-browser-roundtrip.json');
                  setViewerNote(`실제 브라우저 왕복 증빙 ${report.assets.length}/${BROWSER_PROOF_EXPECTED_COUNT}개를 저장했습니다.`);
                }}
              >SAVE PROOF</button>
            </div>
          </section>

          <section className="local-telemetry" aria-label="로컬 비용 및 개인정보 추적">
            <header><span className="eyebrow">local build trace</span><b>비용·보안 경계</b></header>
            <div>
              <span>COMPILE<b>{telemetry ? `${telemetry.compileMs.toFixed(1)} ms` : '—'}</b></span>
              <span>RENDER MEMORY<b>{bytesLabel(telemetry?.estimatedRenderBytes ?? 0)}</b></span>
              <span>LLM COST<b>BYOK · 미관측</b></span>
              <span>UPLOAD<b>없음</b></span>
            </div>
            <p>뷰어는 파일을 서버로 보내거나 자동 저장하지 않습니다. 가져온 IR은 메모리에만 두며 새로고침·명시적 제거·30분 만료 시 삭제됩니다.</p>
            {importedExpiresAt && <button onClick={clearImportedSession}>CLEAR IMPORTED SESSION · ≤{Math.max(1, Math.ceil((importedExpiresAt - Date.now()) / 60_000))} MIN</button>}
          </section>

          <div className="export-actions">
            <button className="export-primary" disabled={!pack || qualityBlocked || deliveryAudit?.status === 'blocked'} onClick={() => runAction('ASSET PACK', () => viewportRef.current!.exportAssetPack({
              assetId: activeAssetId,
              assetName: activeName,
              sourceIr: sourcePayload,
              qualityReport: quality,
              evidenceBoundary,
            }))}>
              <span><b>SAVE ASSET PACK</b><small>GLB + OBJ/STL/PLY + IR + quality + preview + Figma SVG</small></span><i>↓</i>
            </button>
            <button disabled={!pack} title="PBR scene exchange for Blender, Unity glTF workflows, Unreal, Godot and web viewers" onClick={() => runAction('GLB', () => viewportRef.current!.exportGlb())}>GLB · BLENDER/UNITY/UNREAL/GODOT</button>
            <button disabled={!pack} title="Mesh reference only; not STEP/BREP" onClick={() => runAction('OBJ', () => viewportRef.current!.exportObj())}>CAD MESH · OBJ</button>
            <button disabled={!pack} title="Millimetre-valued print/CAD mesh; not STEP/BREP" onClick={() => runAction('STL', () => viewportRef.current!.exportStl())}>PRINT MESH · STL (MM)</button>
            <button disabled={!pack} title="Static mesh with positions, normals, vertex colors and UVs; textures are not embedded" onClick={() => runAction('PLY', () => viewportRef.current!.exportPly())}>PLY · MESHLAB/CLOUDCOMPARE</button>
            <button disabled={!pack} title="Apple AR Quick Look / Reality Composer handoff" onClick={() => runAction('USDZ', () => viewportRef.current!.exportUsdz())}>USDZ · APPLE AR</button>
            <button disabled={!pack} title="2D inspection sheet; not a 3D Figma object" onClick={() => runAction('FIGMA SVG', () => viewportRef.current!.exportFigmaSvg())}>FIGMA · SVG SHEET</button>
            <button disabled={!pack} onClick={() => runAction('PNG', () => viewportRef.current!.capturePng())}>CAPTURE PNG</button>
            <button onClick={() => irInputRef.current?.click()}>OPEN RESULT</button>
            <input
              ref={irInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 2_000_000) { setViewerNote('AssemblyIR은 최대 2MB입니다.'); return; }
                void file.text().then((text) => {
                  try {
                    const value: unknown = JSON.parse(text);
                    validateAssemblyIR(value);
                    setAssemblyIR(value);
                    setAssetKind('product');
                    setActiveAssetId('imported');
                    setSelectedPart(undefined);
                    setMeasurementEnabled(true);
                    setMeasurementUnit(value.metadata?.assetKind === 'building' ? 'm' : 'mm');
                    setDeliveryAudit(undefined);
                    setDeliveryVerifying(true);
                    setTelemetry(undefined);
                    scheduleImportedExpiry();
                    setViewerNote(`AssemblyIR 결과 로드 · ${value.components.length}개 부품`);
                  } catch (error) {
                    setViewerNote(error instanceof Error ? error.message : 'AssemblyIR을 읽지 못했습니다.');
                  }
                }).catch((error: unknown) => {
                  setViewerNote(error instanceof Error ? error.message : '로컬 파일을 읽지 못했습니다.');
                });
                event.target.value = '';
              }}
            />
            <button onClick={() => {
              downloadJson(sourcePayload, sourceFileName);
            }}>SAVE IR</button>
            {assetKind === 'product' && assemblyIR?.electrical && <button onClick={() => {
              downloadJson(buildPhysicalNetlist(assemblyIR), 'morphloom-physical-netlist.json');
              setViewerNote('물리 핀·AWG·검증 상태가 포함된 NETLIST를 저장했습니다.');
            }}>SAVE NETLIST</button>}
          </div>
          <section className="format-compatibility" aria-label="3D 프로그램 내보내기 범위">
            <span className="eyebrow">handoff scope</span>
            <p><b>GLB</b> Blender · Unity · Unreal · Godot · web</p>
            <p><b>OBJ / PLY</b> Maya · Cinema 4D · 3ds Max · MeshLab · CloudCompare</p>
            <p><b>STL (MM) / SVG / USDZ</b> Fusion·슬라이서 메시 · Figma 2D · Apple AR</p>
            <small>STEP/BREP·FBX·.blend·.uasset 네이티브 파일은 아니며 필요 시 대상 프로그램에서 변환합니다.</small>
          </section>
          {jobs.length > 0 && (
            <section className="local-job-queue" aria-label="로컬 작업 대기열" aria-live="polite">
              <header><span className="eyebrow">local job queue</span><b>{busyAction ? `${busyAction} 실행 중` : '대기열 유휴'}</b></header>
              {jobs.slice(-5).reverse().map((job) => (
                <div key={job.id}>
                  <span>#{job.id} · {job.name}</span><b className={`job-${job.status}`}>{job.status.toUpperCase()}</b>
                  {(job.status === 'queued' || job.status === 'running') && <button onClick={() => cancelJob(job.id)}>CANCEL</button>}
                  {job.status === 'failed' && <button onClick={() => retryJob(job.id)}>RETRY</button>}
                  {(job.durationMs !== undefined || job.outputBytes !== undefined) && (
                    <small>{job.durationMs !== undefined ? `${job.durationMs.toFixed(0)} ms` : ''}{job.outputBytes !== undefined ? ` · ${bytesLabel(job.outputBytes)}` : ''}</small>
                  )}
                  {job.error && <small>{job.error}</small>}
                </div>
              ))}
            </section>
          )}
        </aside>
      </section>

      <footer className={`pipeline-footer${pipelineCollapsed ? ' is-collapsed' : ''}`}>
        <button
          className="panel-collapse-button pipeline-collapse-button"
          aria-expanded={!pipelineCollapsed}
          aria-label={pipelineCollapsed ? '하단 파이프라인 펼치기' : '하단 파이프라인 접기'}
          title={pipelineCollapsed ? '파이프라인 펼치기' : '파이프라인 접기'}
          onClick={() => setPipelineCollapsed((collapsed) => !collapsed)}
        >{pipelineCollapsed ? 'PIPELINE ↑' : 'PIPELINE ↓'}</button>
        <span className="eyebrow">result pipeline</span>
        {(assetKind === 'human' ? [
          ['01', 'CHARACTER IR', 'pass'], ['02', 'MORPH', pack ? 'pass' : 'run'], ['03', 'MATERIAL', pack ? 'pass' : 'wait'],
          ['04', 'RIG', deliveryAudit?.status === 'blocked' ? 'blocked' : deliveryAudit?.reopened?.skeletons && deliveryAudit.reopened.animationClips >= 22 ? 'pass' : deliveryAudit ? 'warn' : 'run'],
          ['05', 'TOPOLOGY', pack ? 'pass' : 'wait'], ['06', 'EXPORT', qualityBlocked || deliveryAudit?.status === 'blocked' ? 'blocked' : deliveryAudit ? 'ready' : 'run'],
        ] : [
          ['01', 'SOURCE', 'pass'], ['02', assemblyIR || productSpec.kind === 'ornate-knife' ? 'ASSEMBLY IR' : 'PRODUCT SPEC', 'pass'], ['03', 'COMPILE', pack ? 'pass' : 'run'],
          ['04', 'TOPOLOGY', pack ? 'pass' : 'wait'], ['05', 'PART TREE', pack ? 'pass' : 'wait'], ['06', 'EXPORT', qualityBlocked || deliveryAudit?.status === 'blocked' ? 'blocked' : deliveryAudit ? 'ready' : 'run'],
        ]).map(([step, label, state], index) => (
          <div className="pipeline-step" key={step}>
            <i className={state} /><span>{step}</span><b>{label}</b><small>{state.toUpperCase()}</small>{index < 5 && <em>→</em>}
          </div>
        ))}
        <p>Natural language in CLI · results in browser</p>
      </footer>
    </main>
  );
}
