import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterBuild } from './engine/character';
import type { ProductBuild, ProductPartInfo } from './engine/product';
import type { AssemblyIR } from './engine/assembly-ir';
import { validateAssemblyIR } from './engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from './engine/cooling-assembly';
import { GALAXY_Z_FOLD8_EXTERIOR_IR } from './engine/galaxy-fold8-exterior';
import { POOR_COYOTES_CABIN_IR } from './engine/poor-coyotes-cabin';
import { loadHumanPack } from './engine/ohpk';
import { evaluateProductQuality, evaluateQuality } from './engine/quality';
import { WEB_HERO_VISUAL_INTERPRETATION } from './engine/reference-pose';
import { buildPhysicalNetlist } from './engine/netlist';
import { ResultViewport, type ViewportHandle } from './components/ResultViewport';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec, ViewMode } from './types';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC, DEFAULT_SPEC, WEB_HERO_SPEC } from './types';

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: 'beauty', label: 'Beauty' },
  { id: 'clay', label: 'Clay' },
  { id: 'wireframe', label: 'Wire' },
  { id: 'rig', label: 'X-Ray' },
];

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

const VIEWER_ASSETS: ViewerAsset[] = [
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
    spec: { ...DEFAULT_SPEC, muscle: 0.72, weight: 0.56, shoulderScale: 1.1, outfit: 'field', suitColor: '#242a33' },
  },
];

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
  const [pack, setPack] = useState<HumanPack>();
  const [packError, setPackError] = useState<string>();
  const [assetKind, setAssetKind] = useState<AssetKind>('product');
  const [activeAssetId, setActiveAssetId] = useState('fold8');
  const [spec, setSpec] = useState<CharacterSpec>(DEFAULT_SPEC);
  const [productSpec, setProductSpec] = useState<ProductSpec>(DEFAULT_PRODUCT_SPEC);
  const [assemblyIR, setAssemblyIR] = useState<AssemblyIR | undefined>(GALAXY_Z_FOLD8_EXTERIOR_IR);
  const [mode, setMode] = useState<ViewMode>('beauty');
  const [buildMetrics, setBuildMetrics] = useState<CharacterBuild['metrics'] | ProductBuild['metrics']>();
  const [selectedPart, setSelectedPart] = useState<ProductPartInfo>();
  const [busyAction, setBusyAction] = useState<string>();
  const [viewerNote, setViewerNote] = useState('CLI/Codex에서 생성한 결과를 검수하는 읽기 전용 화면입니다.');
  const viewportRef = useRef<ViewportHandle>(null);
  const irInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    loadHumanPack('/assets/oxihuman-core-v1.ohpk')
      .then((loaded) => { if (active) setPack(loaded); })
      .catch((error: unknown) => {
        if (active) setPackError(error instanceof Error ? error.message : '인체 팩을 불러오지 못했습니다.');
      });
    return () => { active = false; };
  }, []);

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
      ? evaluateQuality(pack, spec, undefined, characterMetrics)
      : evaluateProductQuality(productSpec, undefined, productMetrics, assemblyIR);
  }, [assemblyIR, assetKind, characterMetrics, pack, productMetrics, productSpec, spec]);
  const qualityBlocked = quality?.checks.some((check) => check.status === 'blocked') ?? false;
  const productPartCount = productMetrics?.parts;
  const architecturalResult = assemblyIR?.metadata?.assetKind === 'building';
  const displayedTriangles = buildMetrics && 'renderedTriangles' in buildMetrics
    ? buildMetrics.renderedTriangles
    : buildMetrics?.triangles;

  const handleBuilt = useCallback((build: CharacterBuild | ProductBuild) => {
    setBuildMetrics(build.metrics);
  }, []);

  const selectAsset = (id: string) => {
    const next = VIEWER_ASSETS.find((item) => item.id === id);
    if (!next) return;
    setActiveAssetId(next.id);
    setAssetKind(next.kind);
    setSelectedPart(undefined);
    setMode('beauty');
    if (next.kind === 'human') {
      setSpec(next.spec);
      setAssemblyIR(undefined);
    } else {
      setProductSpec(next.spec);
      setAssemblyIR(next.assemblyIR);
    }
    setViewerNote(`${next.label} 결과를 불러왔습니다.`);
  };

  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    try {
      await action();
    } finally {
      setBusyAction(undefined);
    }
  };

  const activeName = assetKind === 'human'
    ? spec.outfit === 'web-hero' ? 'ML—WEB_HERO_01' : 'ML—HUMAN_BASE'
    : assemblyIR ? assemblyIR.name.toUpperCase() : productSpec.kind === 'smartphone' ? 'ML—PHONE_ASSEMBLY' : 'ML—ORNATE_BLADE';

  return (
    <main className="app-shell viewer-shell">
      <header className="topbar viewer-topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><AppIcon /></span>
          <span className="brand-name">MORPHLOOM</span>
          <span className="brand-edition">Result Viewer / α03</span>
        </div>
        <div className="result-selector">
          <span>ACTIVE RESULT</span>
          <select value={activeAssetId} onChange={(event) => selectAsset(event.target.value)} aria-label="검수할 결과 선택">
            {activeAssetId === 'imported' && <option value="imported">Imported AssemblyIR</option>}
            {VIEWER_ASSETS.map((item) => <option value={item.id} key={item.id}>{item.label} — {item.caption}</option>)}
          </select>
        </div>
        <div className="topbar-status">
          <span><i className="pulse-dot" /> LOCAL · VIEW ONLY</span>
          <span>{assetKind === 'product' ? `${productPartCount ?? '—'} PART NODES` : pack ? `${(buildMetrics?.vertices ?? 0).toLocaleString()} SKIN VERTICES` : 'LOADING PACK'}</span>
          <a href="https://github.com/djfksjd/morphloom" target="_blank" rel="noreferrer">OPEN SOURCE ↗</a>
        </div>
      </header>

      <section className="studio-grid viewer-grid">
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
            </div>
            <span className="viewport-hint">AUTO FIT · DRAG TO ORBIT · SCROLL TO DOLLY</span>
          </div>

          <div className="viewfinder-corners" aria-hidden="true"><i /><i /><i /><i /></div>
          {pack ? (
            <ResultViewport
              ref={viewportRef}
              assetKind={assetKind}
              pack={pack}
              spec={spec}
              productSpec={productSpec}
              assemblyIR={assemblyIR}
              mode={mode}
              onBuilt={handleBuilt}
              onPartSelected={setSelectedPart}
            />
          ) : (
            <div className="viewport-loading">
              {packError ? <><b>인체 팩 로드 실패</b><span>{packError}</span></> : <><i /><b>결과 뷰어 준비 중</b><span>로컬 메시와 재질을 불러옵니다.</span></>}
            </div>
          )}

          <div className="viewport-title">
            <span>REVIEWING</span>
            <strong>{activeName}</strong>
          </div>
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

        <aside className="panel inspector-panel result-inspector">
          <div className="panel-heading quality-heading">
            <div><span className="eyebrow">result integrity</span><h2>Quality gate</h2></div>
            <div className={`quality-total ${qualityBlocked ? 'has-blocker' : ''}`}>
              <strong>{quality?.total ?? '—'}</strong><span>/100</span>{qualityBlocked && <em>BLOCKED</em>}
            </div>
          </div>

          <div className="viewer-note"><span>CLI → IR → VIEWER</span><p>{viewerNote}</p></div>

          <div className="quality-list">
            {quality?.checks.map((check) => (
              <div className="quality-row" key={check.id}>
                <StatusMark status={check.status} />
                <div><b>{check.label}</b><small>{check.detail}</small></div>
                <strong>{check.score}</strong>
              </div>
            )) ?? <div className="quality-skeleton" />}
          </div>

          {assetKind === 'product' && selectedPart && (
            <div className="selected-part-card">
              <span className="eyebrow">selected component</span><b>{selectedPart.name}</b>
              <small>{selectedPart.category.toUpperCase()} · {selectedPart.material} · {selectedPart.surface.toUpperCase()}</small>
              <p>{selectedPart.detail}</p>
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

          <div className="export-actions">
            <button className="export-primary" disabled={!pack || Boolean(busyAction)} onClick={() => void runAction('GLB', () => viewportRef.current!.exportGlb())}>
              <span><b>{busyAction === 'GLB' ? 'PACKING…' : 'EXPORT GLB'}</b><small>{assetKind === 'human' ? 'Editable human + CharacterIR' : 'Named parts + AssemblyIR/BOM'}</small></span><i>↓</i>
            </button>
            <button disabled={!pack || Boolean(busyAction)} onClick={() => void runAction('PNG', () => viewportRef.current!.capturePng())}>CAPTURE PNG</button>
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
                    setViewerNote(`AssemblyIR 결과 로드 · ${value.components.length}개 부품`);
                  } catch (error) {
                    setViewerNote(error instanceof Error ? error.message : 'AssemblyIR을 읽지 못했습니다.');
                  }
                });
                event.target.value = '';
              }}
            />
            <button onClick={() => {
              const payload = assetKind === 'human'
                ? { schema: 'morphloom.character/0.2', spec, interpretation: spec.outfit === 'web-hero' ? WEB_HERO_VISUAL_INTERPRETATION : undefined }
                : assemblyIR ?? { schema: 'morphloom.assembly/0.1', kind: productSpec.kind, spec: productSpec };
              downloadJson(payload, assetKind === 'human' ? 'character-ir.json' : 'assembly-ir.json');
            }}>SAVE IR</button>
            {assetKind === 'product' && assemblyIR?.electrical && <button onClick={() => {
              downloadJson(buildPhysicalNetlist(assemblyIR), 'morphloom-physical-netlist.json');
              setViewerNote('물리 핀·AWG·검증 상태가 포함된 NETLIST를 저장했습니다.');
            }}>SAVE NETLIST</button>}
          </div>
        </aside>
      </section>

      <footer className="pipeline-footer">
        <span className="eyebrow">result pipeline</span>
        {(assetKind === 'human' ? [
          ['01', 'CHARACTER IR', 'pass'], ['02', 'MORPH', pack ? 'pass' : 'run'], ['03', 'MATERIAL', pack ? 'pass' : 'wait'],
          ['04', 'RIG', 'warn'], ['05', 'TOPOLOGY', pack ? 'pass' : 'wait'], ['06', 'EXPORT', pack ? 'ready' : 'wait'],
        ] : [
          ['01', 'SOURCE', assemblyIR ? 'pass' : 'wait'], ['02', 'ASSEMBLY IR', 'pass'], ['03', 'COMPILE', pack ? 'pass' : 'run'],
          ['04', 'TOPOLOGY', pack ? 'pass' : 'wait'], ['05', 'PART TREE', pack ? 'pass' : 'wait'], ['06', 'EXPORT', pack ? 'ready' : 'wait'],
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
