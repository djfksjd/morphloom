import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterBuild } from './engine/character';
import type { ProductBuild, ProductPartInfo } from './engine/product';
import type { AssemblyIR } from './engine/assembly-ir';
import { validateAssemblyIR } from './engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from './engine/cooling-assembly';
import { analyzeReference } from './engine/reference';
import {
  buildReferenceManifest,
  evaluateReferenceSet,
  inferReferenceRole,
  inferHumanOutfitFromReferenceNames,
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_TOTAL_BYTES,
  normalizeComponentId,
  REFERENCE_ROLE_LABELS,
  REFERENCE_ROLES,
  referenceIdentity,
  type ReferenceRole,
  type ReferenceView,
} from './engine/reference-set';
import { loadHumanPack } from './engine/ohpk';
import { applyProductPrompt, applyPrompt } from './engine/prompt';
import { evaluateProductQuality, evaluateQuality } from './engine/quality';
import { WEB_HERO_VISUAL_INTERPRETATION } from './engine/reference-pose';
import { buildPhysicalNetlist } from './engine/netlist';
import { CharacterViewport, type ViewportHandle } from './components/CharacterViewport';
import { ParameterControl } from './components/ParameterControl';
import type {
  CharacterSpec,
  AssetKind,
  HairStyle,
  HumanPack,
  OutfitStyle,
  PoseStyle,
  ProductSpec,
  ReferenceEvidence,
  ViewMode,
} from './types';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC, DEFAULT_SPEC, WEB_HERO_SPEC } from './types';

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: 'beauty', label: 'Beauty' },
  { id: 'clay', label: 'Clay' },
  { id: 'wireframe', label: 'Wire' },
  { id: 'rig', label: 'Rig' },
];

const PRESETS: Array<{ name: string; caption: string; patch: Partial<CharacterSpec>; prompt?: string }> = [
  {
    name: 'FIELD / 01',
    caption: '전술형 휴먼',
    patch: { muscle: 0.72, weight: 0.56, shoulderScale: 1.1, outfit: 'field', suitColor: '#242a33' },
  },
  {
    name: 'STUDIO / 02',
    caption: '캡처 스테이지',
    patch: { muscle: 0.48, weight: 0.47, outfit: 'studio', suitColor: '#d0d0c9', accentColor: '#f05d47' },
  },
  {
    name: 'RUNNER / 03',
    caption: '경량 실루엣',
    patch: { muscle: 0.61, weight: 0.35, legScale: 1.055, shoulderScale: 1.01, outfit: 'second-skin' },
  },
  {
    name: 'WEB HERO / 04',
    caption: '마스크·렌즈·웹 슈트',
    patch: WEB_HERO_SPEC,
    prompt: '일반인이 스파이더맨을 코스튬한 슬림 소프트 체형. 배와 가슴은 살짝 나오고 엉덩이는 작음. 약한 거북목, 무게중심은 뒤. 오른발은 앞, 왼발은 뒤에서 굽힘. 오른손은 왼손보다 더 앞이고 조금 높으며 양손은 거미줄을 쏘는 모양.',
  },
];

const PRODUCT_PRESETS: Array<{ name: string; caption: string; spec: ProductSpec; prompt: string; assemblyIR?: AssemblyIR }> = [
  { name: 'PHONE / 01', caption: '164부품·28도체', spec: DEFAULT_PRODUCT_SPEC, prompt: '76.7×159.9×8.25mm 실버 스마트폰을 부품별 분해도로' },
  { name: 'BLADE / 02', caption: '장식 단검', spec: DEFAULT_KNIFE_SPEC, prompt: '장식 단검: 뾰족한 양날 검신, 혈조, 가드, 가죽 손잡이와 보석 폼멜' },
  { name: 'COOLER / 03', caption: `${COOLING_ASSEMBLY_IR.components.length}부품·${COOLING_ASSEMBLY_IR.electrical?.wires.length ?? 0}도체`, spec: DEFAULT_PRODUCT_SPEC, prompt: '첨부 분해도를 근거로 TEC 냉각 장치와 모든 전선을 포트에 연결', assemblyIR: COOLING_ASSEMBLY_IR },
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

export function App() {
  const [pack, setPack] = useState<HumanPack>();
  const [packError, setPackError] = useState<string>();
  const [assetKind, setAssetKind] = useState<AssetKind>('product');
  const [spec, setSpec] = useState<CharacterSpec>(DEFAULT_SPEC);
  const [productSpec, setProductSpec] = useState<ProductSpec>(DEFAULT_PRODUCT_SPEC);
  const [assemblyIR, setAssemblyIR] = useState<AssemblyIR>();
  const [mode, setMode] = useState<ViewMode>('beauty');
  const [prompt, setPrompt] = useState('76.7×159.9×8.25mm 실버 스마트폰을 부품별 분해도로');
  const [promptNote, setPromptNote] = useState('공통 IR은 로컬 엔진에서만 실행됩니다.');
  const [referenceViews, setReferenceViews] = useState<ReferenceView[]>([]);
  const [activeReferenceId, setActiveReferenceId] = useState<string>();
  const [referenceError, setReferenceError] = useState<string>();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingReferences, setIsProcessingReferences] = useState(false);
  const [buildMetrics, setBuildMetrics] = useState<CharacterBuild['metrics'] | ProductBuild['metrics']>();
  const [selectedPart, setSelectedPart] = useState<ProductPartInfo>();
  const [busyAction, setBusyAction] = useState<string>();
  const viewportRef = useRef<ViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const irInputRef = useRef<HTMLInputElement>(null);
  const referenceViewsRef = useRef<ReferenceView[]>([]);
  const processingReferencesRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    let active = true;
    loadHumanPack('/assets/oxihuman-core-v1.ohpk')
      .then((loaded) => {
        if (active) setPack(loaded);
      })
      .catch((error: unknown) => {
        if (active) setPackError(error instanceof Error ? error.message : '인체 팩을 불러오지 못했습니다.');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    referenceViewsRef.current = referenceViews;
  }, [referenceViews]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      referenceViewsRef.current.forEach((view) => URL.revokeObjectURL(view.url));
    };
  }, []);

  const activeReferenceViews = useMemo(
    () => referenceViews.filter((view) => view.assetKind === assetKind),
    [assetKind, referenceViews],
  );
  const activeReference = activeReferenceViews.find((view) => view.id === activeReferenceId) ?? activeReferenceViews[0];
  const referenceCoverage = useMemo(
    () => evaluateReferenceSet(activeReferenceViews, assetKind),
    [activeReferenceViews, assetKind],
  );
  const reference = useMemo<ReferenceEvidence | undefined>(() => {
    if (!activeReference) return undefined;
    return {
      ...activeReference.evidence,
      fileName: activeReferenceViews.length > 1 ? `${activeReferenceViews.length}개 증거 이미지` : activeReference.fileName,
      portraitSuitability: referenceCoverage.score,
      notes: referenceCoverage.warnings.length > 0
        ? referenceCoverage.warnings
        : ['다중 시점과 부품 식별 기준을 충족했습니다.'],
    };
  }, [activeReference, activeReferenceViews.length, referenceCoverage]);

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
      ? evaluateQuality(pack, spec, reference, characterMetrics)
      : evaluateProductQuality(productSpec, reference, productMetrics, assemblyIR);
  }, [assemblyIR, assetKind, characterMetrics, pack, productMetrics, productSpec, reference, spec]);
  const qualityBlocked = quality?.checks.some((check) => check.status === 'blocked') ?? false;
  const productPartCount = productMetrics?.parts;
  const displayedTriangles = buildMetrics && 'renderedTriangles' in buildMetrics
    ? buildMetrics.renderedTriangles
    : buildMetrics?.triangles;

  const updateSpec = useCallback(<K extends keyof CharacterSpec>(key: K, value: CharacterSpec[K]) => {
    setSpec((current) => ({ ...current, [key]: value }));
  }, []);

  const updateProductSpec = useCallback(<K extends keyof ProductSpec>(key: K, value: ProductSpec[K]) => {
    setProductSpec((current) => ({ ...current, [key]: value }));
  }, []);

  const handleBuilt = useCallback((build: CharacterBuild | ProductBuild) => {
    setBuildMetrics(build.metrics);
  }, []);

  const processFiles = useCallback(async (source: FileList | File[]) => {
    const files = Array.from(source);
    if (files.length === 0 || processingReferencesRef.current) return;
    setReferenceError(undefined);
    const known = new Set(activeReferenceViews.map((view) => `${view.fileName}:${view.fileSize}:${view.lastModified}`));
    const uniqueFiles = files.filter((file) => !known.has(referenceIdentity(file)));
    if (uniqueFiles.length === 0) {
      setReferenceError('이미 추가된 사진입니다.');
      return;
    }
    if (referenceViews.length + uniqueFiles.length > MAX_REFERENCE_FILES) {
      setReferenceError(`증거 이미지는 최대 ${MAX_REFERENCE_FILES}개까지 추가할 수 있습니다.`);
      return;
    }
    const totalBytes = referenceViews.reduce((sum, view) => sum + view.fileSize, 0)
      + uniqueFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) {
      setReferenceError('전체 증거 이미지 용량은 최대 96MB입니다.');
      return;
    }
    processingReferencesRef.current = true;
    setIsProcessingReferences(true);
    const accepted: ReferenceView[] = [];
    const failures: string[] = [];
    try {
      for (let start = 0; start < uniqueFiles.length; start += 2) {
        const batch = uniqueFiles.slice(start, start + 2);
        const results = await Promise.allSettled(batch.map(async (file, offset) => {
          const analyzed = await analyzeReference(file, assetKind);
          return {
            id: crypto.randomUUID(),
            assetKind,
            url: analyzed.url,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            lastModified: file.lastModified,
            role: inferReferenceRole(file.name, referenceViews.length + start + offset),
            evidence: analyzed.evidence,
          } satisfies ReferenceView;
        }));
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') accepted.push(result.value);
          else failures.push(`${batch[index].name}: ${result.reason instanceof Error ? result.reason.message : '분석 실패'}`);
        });
      }
      if (!mountedRef.current) {
        accepted.forEach((view) => URL.revokeObjectURL(view.url));
        return;
      }
      if (accepted.length > 0) {
        setReferenceViews((current) => [...current, ...accepted]);
        setActiveReferenceId((current) => (
          activeReferenceViews.some((view) => view.id === current) ? current : accepted[0].id
        ));
        const inferredOutfit = assetKind === 'human'
          ? inferHumanOutfitFromReferenceNames(accepted.map((view) => view.fileName))
          : undefined;
        if (inferredOutfit === 'web-hero') {
          setSpec(WEB_HERO_SPEC);
          setPrompt('일반인이 스파이더맨을 코스튬한 슬림 소프트 체형. 배와 가슴은 살짝 나오고 엉덩이는 작음. 약한 거북목, 무게중심은 뒤. 오른발은 앞, 왼발은 뒤에서 굽힘. 오른손은 왼손보다 더 앞이고 조금 높으며 양손은 거미줄을 쏘는 모양.');
        }
        setPromptNote(inferredOutfit === 'web-hero'
          ? '웹 히어로 참조 파일명 감지 · 마스크·렌즈·슈트 상세 CharacterIR을 적용했습니다.'
          : `${accepted.length}개 사진 분석 완료 · 시점과 부품 ID를 확인한 뒤 EVIDENCE JSON을 저장하세요.`);
      }
      if (failures.length > 0) setReferenceError(failures.join(' · '));
    } catch (error) {
      accepted.forEach((view) => URL.revokeObjectURL(view.url));
      if (mountedRef.current) {
        setReferenceError(error instanceof Error ? error.message : '참고 이미지 분석을 완료하지 못했습니다.');
      }
    } finally {
      processingReferencesRef.current = false;
      if (mountedRef.current) setIsProcessingReferences(false);
    }
  }, [activeReferenceViews, assetKind, referenceViews]);

  const updateReferenceView = useCallback((id: string, patch: Partial<Pick<ReferenceView, 'role' | 'componentId'>>) => {
    setReferenceViews((current) => current.map((view) => view.id === id ? { ...view, ...patch } : view));
  }, []);

  const removeReferenceView = useCallback((id: string) => {
    const removed = referenceViewsRef.current.find((view) => view.id === id);
    if (removed) URL.revokeObjectURL(removed.url);
    setReferenceViews((current) => current.filter((view) => view.id !== id));
    setActiveReferenceId((current) => current === id ? undefined : current);
  }, []);

  const saveEvidenceManifest = useCallback(() => {
    if (activeReferenceViews.length === 0) return;
    downloadJson(buildReferenceManifest(activeReferenceViews, assetKind), 'morphloom-evidence.json');
    setPromptNote(referenceCoverage.ready
      ? 'EVIDENCE JSON 저장 완료 · 이미지 파일들과 함께 Codex/Claude에 전달하세요.'
      : `EVIDENCE JSON 저장 완료 · ${referenceCoverage.warnings[0] ?? '누락 증거를 확인하세요.'}`);
  }, [activeReferenceViews, assetKind, referenceCoverage]);

  const runPrompt = () => {
    if (assetKind === 'product') {
      const result = applyProductPrompt(prompt, productSpec);
      setProductSpec(result.spec);
      setAssemblyIR(undefined);
      setPromptNote(
        result.changes.length > 0
          ? `AssemblyIR 적용 · ${result.changes.join(' · ')}`
          : '변경 가능한 치수·분해 상태·재질 지시를 찾지 못했습니다.',
      );
      return;
    }
    const result = applyPrompt(prompt, spec);
    setSpec(result.spec);
    setPromptNote(
      result.changes.length > 0
        ? `적용됨 · ${result.changes.join(' · ')}`
        : '변경할 수 있는 치수·체형·헤어·의상 지시를 찾지 못했습니다.',
    );
  };

  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    try {
      await action();
    } finally {
      setBusyAction(undefined);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><AppIcon /></span>
          <span className="brand-name">MORPHLOOM</span>
          <span className="brand-edition">Asset Foundry / α03</span>
        </div>
        <div className="topbar-status">
          <span><i className="pulse-dot" /> LOCAL MESH</span>
          <span>{assetKind === 'product' ? `${productPartCount ?? '—'} PART NODES` : pack ? `${(buildMetrics?.vertices ?? 0).toLocaleString()} SKIN VERTICES` : 'LOADING PACK'}</span>
          <a href="https://github.com/djfksjd/morphloom" target="_blank" rel="noreferrer">OPEN SOURCE ↗</a>
        </div>
      </header>

      <section className="studio-grid">
        <aside className="panel reference-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">01 / visual evidence</span>
              <h1>Reference</h1>
            </div>
            <span className="local-badge">LOCAL</span>
          </div>

          <button
            className={`reference-drop ${isDragging ? 'is-dragging' : ''} ${activeReference ? 'has-image' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              void processFiles(event.dataTransfer.files);
            }}
          >
            {activeReference ? (
              <>
                <img src={activeReference.url} alt={`${REFERENCE_ROLE_LABELS[activeReference.role]} 참고 자료`} />
                <span className="reference-role-label">{REFERENCE_ROLE_LABELS[activeReference.role]}</span>
                <span className="replace-label">+ 사진 추가</span>
              </>
            ) : (
              <span className="drop-copy">
                <b>{assetKind === 'human' ? '인물 사진 묶음을 놓으세요' : '제품 증거 사진을 모두 놓으세요'}</b>
                <small>{assetKind === 'human' ? '정면·후면·좌우측' : '6면·분해도·부품·재질'} · 파일당 16MB · 최대 24장</small>
                <em>{isProcessingReferences ? 'Analyzing…' : 'Browse images'}</em>
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              if (event.target.files) void processFiles(event.target.files);
              event.target.value = '';
            }}
          />

          {referenceError && <p className="inline-error">{referenceError}</p>}
          {activeReferenceViews.length > 0 && (
            <div className="evidence-set">
              <div className="evidence-coverage" aria-label="필수 시점 촬영 현황">
                {referenceCoverage.requiredRoles.map((role) => (
                  <span
                    className={referenceCoverage.presentRequiredRoles.includes(role) ? 'is-present' : ''}
                    key={role}
                    title={REFERENCE_ROLE_LABELS[role]}
                  >
                    {role.slice(0, 2).toUpperCase()}
                  </span>
                ))}
              </div>

              <div className="reference-filmstrip">
                {activeReferenceViews.map((view, index) => {
                  const needsComponentId = view.role === 'component' || view.role === 'material' || view.role === 'measurement';
                  const normalizedId = normalizeComponentId(view.componentId ?? '');
                  return (
                    <article className={`reference-view ${activeReference?.id === view.id ? 'is-active' : ''}`} key={view.id}>
                      <button
                        className="reference-thumb"
                        onClick={() => setActiveReferenceId(view.id)}
                        aria-label={`${index + 1}번 ${REFERENCE_ROLE_LABELS[view.role]} 사진 보기`}
                      >
                        <img src={view.url} alt="" />
                        <span>{String(index + 1).padStart(2, '0')}</span>
                      </button>
                      <div className="reference-view-fields">
                        <select
                          value={view.role}
                          aria-label={`${index + 1}번 사진 역할`}
                          onChange={(event) => updateReferenceView(view.id, { role: event.target.value as ReferenceRole })}
                        >
                          {REFERENCE_ROLES.map((role) => <option value={role} key={role}>{REFERENCE_ROLE_LABELS[role]}</option>)}
                        </select>
                        {needsComponentId ? (
                          <input
                            value={view.componentId ?? ''}
                            className={view.role === 'component' && !normalizedId ? 'is-invalid' : ''}
                            placeholder="component_id"
                            maxLength={80}
                            aria-label={`${index + 1}번 사진 부품 ID`}
                            onChange={(event) => updateReferenceView(view.id, { componentId: normalizeComponentId(event.target.value) })}
                          />
                        ) : <small>{view.evidence.width}×{view.evidence.height} · FIT {view.evidence.portraitSuitability}</small>}
                      </div>
                      <button className="remove-reference" onClick={() => removeReferenceView(view.id)} aria-label={`${index + 1}번 사진 삭제`}>×</button>
                    </article>
                  );
                })}
              </div>

              <div className="evidence-summary">
                <div className="evidence-score">
                  <strong>{referenceCoverage.score}</strong>
                  <span>EVIDENCE<br />FIT</span>
                </div>
                <div>
                  <b>{referenceCoverage.presentRequiredRoles.length}/{referenceCoverage.requiredRoles.length} 필수 시점 · {activeReferenceViews.length}장</b>
                  <small>{referenceCoverage.ready ? '병합 준비 완료' : referenceCoverage.warnings[0]}</small>
                </div>
                <button onClick={saveEvidenceManifest}>SAVE<br />EVIDENCE</button>
              </div>
            </div>
          )}

          <div className="prompt-block">
            <div className="subheading-row">
              <span className="eyebrow">02 / agent direction</span>
              <span className="agent-pair"><b>CODEX</b><b>CLAUDE</b></span>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') runPrompt();
              }}
              aria-label="3D 에셋 생성 및 수정 지시"
            />
            <div className="prompt-footer">
              <small>{promptNote}</small>
              <button className="primary-action" onClick={runPrompt}>Build IR <span>⌘↵</span></button>
            </div>
          </div>

          <div className="preset-list">
            <span className="eyebrow">quick forms</span>
            {assetKind === 'human' ? PRESETS.map((preset) => (
              <button key={preset.name} onClick={() => {
                setSpec((current) => ({ ...current, ...preset.patch }));
                if (preset.prompt) setPrompt(preset.prompt);
              }}>
                <span>{preset.name}</span><small>{preset.caption}</small><i>↗</i>
              </button>
            )) : PRODUCT_PRESETS.map((preset) => (
              <button key={preset.name} onClick={() => { setProductSpec(preset.spec); setAssemblyIR(preset.assemblyIR); setPrompt(preset.prompt); setSelectedPart(undefined); }}>
                <span>{preset.name}</span><small>{preset.caption}</small><i>↗</i>
              </button>
            ))}
          </div>
        </aside>

        <section className="viewport-panel" aria-label="3D 에셋 제작 뷰포트">
          <div className="viewport-toolbar">
            <div className="toolbar-cluster">
              <div className="asset-switcher" role="group" aria-label="에셋 종류">
                <button className={assetKind === 'product' ? 'active' : ''} onClick={() => {
                  setAssetKind('product');
                  setPrompt('76.7×159.9×8.25mm 실버 스마트폰을 부품별 분해도로');
                }}>PRODUCT</button>
                <button className={assetKind === 'human' ? 'active' : ''} onClick={() => {
                  setAssetKind('human');
                  setPrompt('178cm의 탄탄한 전술 요원, 짧은 머리와 검정 전투복');
                }}>HUMAN</button>
              </div>
              <div className="mode-switcher" role="group" aria-label="뷰포트 표시 모드">
                {MODES.map((item) => (
                  <button
                    key={item.id}
                    className={mode === item.id ? 'active' : ''}
                    onClick={() => setMode(item.id)}
                  >
                    {assetKind === 'product' && item.id === 'rig' ? 'X-Ray' : item.label}
                  </button>
                ))}
              </div>
              <div className="view-switcher" role="group" aria-label="고정 카메라 시점">
                {assetKind === 'human' && <button onClick={() => viewportRef.current?.setView('front')}>FRONT</button>}
                <button onClick={() => viewportRef.current?.setView('iso')}>ISO</button>
                {assetKind === 'product' && <button onClick={() => viewportRef.current?.setView('top')}>TOP</button>}
                <button onClick={() => viewportRef.current?.setView('rear')}>REAR</button>
              </div>
            </div>
            <span className="viewport-hint">DRAG TO ORBIT · SCROLL TO DOLLY</span>
          </div>

          {pack ? (
            <CharacterViewport
              ref={viewportRef}
              assetKind={assetKind}
              pack={pack}
              spec={spec}
              productSpec={productSpec}
              assemblyIR={assemblyIR}
              referenceImageUrl={activeReference?.url}
              mode={mode}
              onBuilt={handleBuilt}
              onPartSelected={setSelectedPart}
            />
          ) : (
            <div className="viewport-loading">
              {packError ? <><b>인체 팩 로드 실패</b><span>{packError}</span></> : <><i /><b>인체 팩을 직조하는 중</b><span>CC0 토폴로지와 모프 타깃을 로컬에서 복원합니다.</span></>}
            </div>
          )}

          <div className="viewport-title">
            <span>ACTIVE FORM</span>
            <strong>{assetKind === 'human' ? spec.outfit === 'web-hero' ? 'ML—WEB_HERO_01' : `ML—HUMAN_${String(Math.round(spec.muscle * 100)).padStart(2, '0')}` : assemblyIR ? assemblyIR.name.toUpperCase() : productSpec.kind === 'smartphone' ? 'ML—PHONE_ASSEMBLY' : 'ML—ORNATE_BLADE'}</strong>
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

        <aside className="panel inspector-panel">
          <div className="panel-heading quality-heading">
            <div>
              <span className="eyebrow">03 / build quality</span>
              <h2>Quality gate</h2>
            </div>
            <div className={`quality-total ${qualityBlocked ? 'has-blocker' : ''}`}>
              <strong>{quality?.total ?? '—'}</strong><span>/100</span>
              {qualityBlocked && <em>BLOCKED</em>}
            </div>
          </div>

          <div className="quality-list">
            {quality?.checks.map((check) => (
              <div className="quality-row" key={check.id}>
                <StatusMark status={check.status} />
                <div><b>{check.label}</b><small>{check.detail}</small></div>
                <strong>{check.score}</strong>
              </div>
            )) ?? <div className="quality-skeleton" />}
          </div>

          {assetKind === 'human' && spec.outfit === 'web-hero' && (
            <div className="selected-part-card semantic-read-card">
              <span className="eyebrow">agent visual interpretation</span>
              <b>일반인 코스프레 · 슬림 소프트</b>
              <small>ANATOMICAL RIGHT = VIEWER LEFT · HIDDEN DEPTH = INFERRED</small>
              <p>{WEB_HERO_VISUAL_INTERPRETATION.observations.slice(1, 6).map((item) => item.label).join(' · ')}</p>
              <div className="semantic-tags">
                <span>오른손 더 앞/위</span><span>왼발 뒤 굽힘</span><span>웹 슈팅 손</span>
              </div>
            </div>
          )}

          {assetKind === 'product' && selectedPart && (
            <div className="selected-part-card">
              <span className="eyebrow">selected component</span>
              <b>{selectedPart.name}</b>
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
              <b>{productEngineering.digitalReady ? 'DIGITAL CONNECTED' : 'DIGITAL BLOCKED'} · {productEngineering.productionReady ? 'BENCH RELEASED' : 'PHYSICAL QA REQUIRED'}</b>
              <small>PIN {Math.round(productEngineering.physicalPinCoverage * 100)}% · AWG {Math.round(productEngineering.conductorGaugeCoverage * 100)}% · VERIFY {Math.round(productEngineering.conductorVerificationCoverage * 100)}%</small>
              <p>실측/데이터시트 {productEngineering.componentEvidence.measured + productEngineering.componentEvidence.datasheet} · 추정 {productEngineering.componentEvidence.estimated} · 숨은 형상 {productEngineering.componentEvidence.inferred} · 벤치 대기 {productEngineering.outstandingBenchChecks}</p>
              <div className="semantic-tags">
                <span>{productEngineering.passiveNodes} passive nodes</span>
                <span>{productEngineering.benchRequiredWires} polarity checks</span>
                <span>live anchors {productConnectivity?.liveAnchors ? 'on' : 'off'}</span>
              </div>
            </div>
          )}

          {assetKind === 'human' ? <div className="parameter-section">
            <div className="subheading-row">
              <span className="eyebrow">morph controls</span>
              <button className="text-button" onClick={() => setSpec(DEFAULT_SPEC)}>RESET</button>
            </div>
            <ParameterControl label="키" value={spec.heightCm} min={155} max={205} step={1} display={`${spec.heightCm} cm`} onChange={(value) => updateSpec('heightCm', value)} />
            <ParameterControl label="체격" value={spec.weight} min={0.12} max={0.92} step={0.01} onChange={(value) => updateSpec('weight', value)} />
            <ParameterControl label="근육" value={spec.muscle} min={0.08} max={0.96} step={0.01} onChange={(value) => updateSpec('muscle', value)} />
            <ParameterControl label="어깨" value={spec.shoulderScale} min={0.9} max={1.16} step={0.01} onChange={(value) => updateSpec('shoulderScale', value)} />
            <ParameterControl label="다리 비율" value={spec.legScale} min={0.94} max={1.08} step={0.005} onChange={(value) => updateSpec('legScale', value)} />
            <ParameterControl label="머리 비율" value={spec.headScale} min={0.92} max={1.08} step={0.005} onChange={(value) => updateSpec('headScale', value)} />
            <ParameterControl label="복부 돌출" value={spec.abdominalProjection} min={0} max={0.7} step={0.01} onChange={(value) => updateSpec('abdominalProjection', value)} />
            <ParameterControl label="가슴 연조직" value={spec.chestSoftness} min={0} max={0.7} step={0.01} onChange={(value) => updateSpec('chestSoftness', value)} />
            <ParameterControl label="둔부 비율" value={spec.gluteScale} min={0.75} max={1.2} step={0.01} onChange={(value) => updateSpec('gluteScale', value)} />
            <ParameterControl label="전방 머리" value={spec.forwardHead} min={0} max={0.7} step={0.01} onChange={(value) => updateSpec('forwardHead', value)} />
            <ParameterControl label="후방 무게중심" value={spec.rearBalance} min={0} max={0.7} step={0.01} onChange={(value) => updateSpec('rearBalance', value)} />
          </div> : assemblyIR ? <div className="parameter-section product-controls">
            <div className="subheading-row">
              <span className="eyebrow">assembly ir inspector</span>
              <span className="local-badge">READ ONLY</span>
            </div>
            <div className="assembly-summary">
              <span><b>{assemblyIR.components.length}</b> source parts</span>
              <span><b>{productConnectivity?.wires ?? 0}</b> conductors</span>
              <span><b>{productConnectivity?.documentedPhysicalPins ?? 0}</b> physical pins</span>
            </div>
            <div className="selected-part-card imported-ir-card">
              <b>{assemblyIR.name}</b>
              <small>{assemblyIR.units.toUpperCase()} · {assemblyIR.schema}</small>
              <p>{String(assemblyIR.metadata?.evidencePolicy ?? '에이전트가 기록한 근거와 추정값을 보존합니다.')}</p>
            </div>
          </div> : <div className="parameter-section product-controls">
            <div className="subheading-row">
              <span className="eyebrow">assembly controls</span>
              <button className="text-button" onClick={() => setProductSpec(productSpec.kind === 'smartphone' ? DEFAULT_PRODUCT_SPEC : DEFAULT_KNIFE_SPEC)}>RESET</button>
            </div>
            <ParameterControl label={productSpec.kind === 'smartphone' ? '폭' : '가드 폭'} value={productSpec.widthMm} min={productSpec.kind === 'smartphone' ? 55 : 70} max={productSpec.kind === 'smartphone' ? 100 : 140} step={0.1} display={`${productSpec.widthMm} mm`} onChange={(value) => updateProductSpec('widthMm', value)} />
            <ParameterControl label={productSpec.kind === 'smartphone' ? '높이' : '전체 길이'} value={productSpec.heightMm} min={productSpec.kind === 'smartphone' ? 120 : 320} max={productSpec.kind === 'smartphone' ? 200 : 520} step={0.1} display={`${productSpec.heightMm} mm`} onChange={(value) => updateProductSpec('heightMm', value)} />
            <ParameterControl label="두께" value={productSpec.depthMm} min={productSpec.kind === 'smartphone' ? 5 : 12} max={productSpec.kind === 'smartphone' ? 15 : 38} step={0.05} display={`${productSpec.depthMm} mm`} onChange={(value) => updateProductSpec('depthMm', value)} />
            <ParameterControl label="모서리 R" value={productSpec.cornerRadiusMm} min={4} max={18} step={0.1} display={`${productSpec.cornerRadiusMm} mm`} onChange={(value) => updateProductSpec('cornerRadiusMm', value)} />
            <ParameterControl label="분해 간격" value={productSpec.explode} min={0} max={1} step={0.01} display={`${Math.round(productSpec.explode * 100)}%`} onChange={(value) => updateProductSpec('explode', value)} />
            <div className="assembly-summary">
              <span><b>{productSpec.kind === 'smartphone' ? 8 : 6}</b> systems</span><span><b>{productPartCount ?? '—'}</b> parts</span><span><b>{productSpec.kind === 'smartphone' ? 5 : 4}</b> detail passes</span>
            </div>
          </div>}

          {(assetKind === 'human' || !assemblyIR) && <div className="material-section">
            <span className="eyebrow">surface system</span>
            <div className="color-controls">
              {assetKind === 'human' ? <>
                <label><span>SKIN</span><input type="color" value={spec.skinTone} onChange={(event) => updateSpec('skinTone', event.target.value)} /></label>
                <label><span>SUIT</span><input type="color" value={spec.suitColor} onChange={(event) => updateSpec('suitColor', event.target.value)} /></label>
                <label><span>ACCENT</span><input type="color" value={spec.accentColor} onChange={(event) => updateSpec('accentColor', event.target.value)} /></label>
                <label><span>HAIR</span><input type="color" value={spec.hairColor} onChange={(event) => updateSpec('hairColor', event.target.value)} /></label>
              </> : <>
                <label><span>FRAME</span><input type="color" value={productSpec.frameColor} onChange={(event) => updateProductSpec('frameColor', event.target.value)} /></label>
                <label><span>GLASS</span><input type="color" value={productSpec.glassColor} onChange={(event) => updateProductSpec('glassColor', event.target.value)} /></label>
                <label><span>PCB</span><input type="color" value={productSpec.boardColor} onChange={(event) => updateProductSpec('boardColor', event.target.value)} /></label>
                <label><span>BATTERY</span><input type="color" value={productSpec.batteryColor} onChange={(event) => updateProductSpec('batteryColor', event.target.value)} /></label>
              </>}
            </div>
            {assetKind === 'human' && <div className="select-grid">
              <label>HAIR
                <select value={spec.hairStyle} onChange={(event) => updateSpec('hairStyle', event.target.value as HairStyle)}>
                  <option value="crop">Crop</option><option value="bob">Bob</option><option value="buzz">Buzz</option><option value="none">None</option>
                </select>
              </label>
              <label>OUTFIT
                <select value={spec.outfit} onChange={(event) => updateSpec('outfit', event.target.value as OutfitStyle)}>
                  <option value="field">Field</option><option value="studio">Studio</option><option value="second-skin">Second skin</option><option value="web-hero">Web hero</option>
                </select>
              </label>
              <label>POSE
                <select value={spec.pose} onChange={(event) => updateSpec('pose', event.target.value as PoseStyle)}>
                  <option value="neutral">Neutral A</option><option value="reference-action">Reference action</option>
                </select>
              </label>
            </div>}
          </div>}

          <div className="export-actions">
            <button
              className="export-primary"
              disabled={!pack || Boolean(busyAction)}
              onClick={() => void runAction('GLB', () => viewportRef.current!.exportGlb())}
            >
              <span><b>{busyAction === 'GLB' ? 'PACKING…' : 'EXPORT GLB'}</b><small>{assetKind === 'human' ? 'Editable human + CharacterIR' : 'Named parts + AssemblyIR/BOM'}</small></span><i>↓</i>
            </button>
            <button disabled={!pack || Boolean(busyAction)} onClick={() => void runAction('PNG', () => viewportRef.current!.capturePng())}>CAPTURE PNG</button>
            {assetKind === 'product' && <button onClick={() => irInputRef.current?.click()}>LOAD IR</button>}
            <input
              ref={irInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 2_000_000) { setPromptNote('AssemblyIR은 최대 2MB입니다.'); return; }
                void file.text().then((text) => {
                  try {
                    const value: unknown = JSON.parse(text);
                    validateAssemblyIR(value);
                    setAssemblyIR(value);
                    setAssetKind('product');
                    setPromptNote(`AssemblyIR 로드 · ${value.components.length}개 부품`);
                  } catch (error) {
                    setPromptNote(error instanceof Error ? error.message : 'AssemblyIR을 읽지 못했습니다.');
                  }
                });
                event.target.value = '';
              }}
            />
            <button onClick={() => {
              const payload = assetKind === 'human'
                ? {
                    schema: 'morphloom.character/0.2',
                    spec,
                    interpretation: spec.outfit === 'web-hero' ? WEB_HERO_VISUAL_INTERPRETATION : undefined,
                  }
                : assemblyIR ?? { schema: 'morphloom.assembly/0.1', kind: productSpec.kind, spec: productSpec };
              downloadJson(payload, assetKind === 'human' ? 'character-ir.json' : 'assembly-ir.json');
            }}>SAVE IR</button>
            {assetKind === 'product' && assemblyIR?.electrical && <button onClick={() => {
              downloadJson(buildPhysicalNetlist(assemblyIR), 'morphloom-physical-netlist.json');
              setPromptNote('물리 핀·AWG·검증 상태·벤치 체크가 포함된 NETLIST JSON을 저장했습니다.');
            }}>SAVE NETLIST</button>}
          </div>
        </aside>
      </section>

      <footer className="pipeline-footer">
        <span className="eyebrow">deterministic pipeline</span>
        {(assetKind === 'human' ? [
          ['01', 'EVIDENCE', referenceCoverage.ready ? 'pass' : reference ? 'blocked' : 'wait'],
          ['02', 'CHARACTER IR', 'pass'],
          ['03', 'MORPH', pack ? 'pass' : 'run'],
          ['04', 'MATERIAL', pack ? 'pass' : 'wait'],
          ['05', 'RIG', 'warn'],
          ['06', 'EXPORT', pack ? 'ready' : 'wait'],
        ] : [
          ['01', 'EVIDENCE', referenceCoverage.ready ? 'pass' : reference ? 'blocked' : 'wait'],
          ['02', 'ASSEMBLY IR', 'pass'],
          ['03', 'COMPILE', pack ? 'pass' : 'run'],
          ['04', 'TOPOLOGY', pack ? 'pass' : 'wait'],
          ['05', 'PART TREE', pack ? 'pass' : 'wait'],
          ['06', 'EXPORT', pack ? 'ready' : 'wait'],
        ]).map(([step, label, state], index) => (
          <div className="pipeline-step" key={step}>
            <i className={state} />
            <span>{step}</span>
            <b>{label}</b>
            <small>{state.toUpperCase()}</small>
            {index < 5 && <em>→</em>}
          </div>
        ))}
        <p>No Meshy · No Tripo · No dedicated 3D model</p>
      </footer>
    </main>
  );
}
