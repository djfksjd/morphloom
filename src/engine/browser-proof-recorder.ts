import {
  DELIVERY_PIPELINE_REVISION,
  SCENE_FINGERPRINT_REVISION,
  type DeliveryAudit,
} from './delivery-validation';
import { BROWSER_ROUNDTRIP_PROOF_SCHEMA } from './browser-roundtrip-proof';

export interface BrowserConsoleEvidence {
  errors: number;
  warnings: number;
  samples: string[];
}

export interface BrowserProofDefinition {
  id: string;
  scope: string;
  qualityReleaseReady: boolean;
}

export interface BrowserRoundTripAssetReceipt {
  id: string;
  scope: string;
  status: DeliveryAudit['status'];
  inputFingerprint: string;
  buildFingerprint: string;
  sceneFingerprint: string;
  glbBytes: number;
  boundsErrorMm: number;
  namedNodeCoverage: number;
  morphTargetPayloadParity: boolean;
  texturePayloadParity: boolean;
  materialPayloadParity: boolean;
  qualityReleaseReady: boolean;
  validatorErrors: number | null;
  validatorWarnings: number | null;
  blockers: string[];
}

export interface BrowserRoundTripReport {
  schema: typeof BROWSER_ROUNDTRIP_PROOF_SCHEMA;
  compilerRevision: typeof DELIVERY_PIPELINE_REVISION;
  fingerprintRevision: typeof SCENE_FINGERPRINT_REVISION;
  generatedAt: string;
  console: BrowserConsoleEvidence;
  assets: BrowserRoundTripAssetReceipt[];
}

const RUNTIME_KEY = '__MORPHLOOM_BROWSER_PROOF_RUNTIME__';
const MAX_CONSOLE_SAMPLES = 20;

interface BrowserRuntimeState extends BrowserConsoleEvidence {
  installed: boolean;
}

type ProofWindow = Window & {
  [RUNTIME_KEY]?: BrowserRuntimeState;
};

function safeConsoleText(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function recordRuntimeIssue(state: BrowserRuntimeState, kind: 'errors' | 'warnings', values: unknown[]): void {
  state[kind] += 1;
  if (state.samples.length < MAX_CONSOLE_SAMPLES) {
    state.samples.push(`${kind === 'errors' ? 'ERROR' : 'WARN'} · ${values.map(safeConsoleText).join(' ')}`);
  }
}

/** Install once at viewer startup so a proof receipt cannot claim a clean console
 * merely because automation attached after the model finished loading. */
export function installBrowserProofRecorder(): void {
  if (typeof window === 'undefined') return;
  const proofWindow = window as ProofWindow;
  const existing = proofWindow[RUNTIME_KEY];
  if (existing?.installed) return;
  const state: BrowserRuntimeState = existing ?? { errors: 0, warnings: 0, samples: [], installed: true };
  state.installed = true;
  proofWindow[RUNTIME_KEY] = state;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  console.error = (...values: unknown[]) => {
    recordRuntimeIssue(state, 'errors', values);
    originalError(...values);
  };
  console.warn = (...values: unknown[]) => {
    recordRuntimeIssue(state, 'warnings', values);
    originalWarn(...values);
  };
  window.addEventListener('error', (event) => {
    recordRuntimeIssue(state, 'errors', [event.error ?? event.message]);
  });
  window.addEventListener('unhandledrejection', (event) => {
    recordRuntimeIssue(state, 'errors', [event.reason]);
  });
}

export function getBrowserConsoleEvidence(): BrowserConsoleEvidence {
  if (typeof window === 'undefined') return { errors: 0, warnings: 0, samples: [] };
  const state = (window as ProofWindow)[RUNTIME_KEY];
  return state
    ? { errors: state.errors, warnings: state.warnings, samples: [...state.samples] }
    : { errors: 0, warnings: 0, samples: [] };
}

export function createBrowserRoundTripAssetReceipt(
  definition: BrowserProofDefinition,
  audit: DeliveryAudit,
): BrowserRoundTripAssetReceipt {
  return {
    id: definition.id,
    scope: definition.scope,
    status: audit.status,
    inputFingerprint: audit.inputFingerprint,
    buildFingerprint: audit.buildFingerprint,
    sceneFingerprint: audit.fingerprint,
    glbBytes: audit.glbBytes,
    boundsErrorMm: audit.boundsErrorMm,
    namedNodeCoverage: audit.namedNodeCoverage,
    morphTargetPayloadParity: audit.morphTargetPayloadParity,
    texturePayloadParity: audit.texturePayloadParity,
    materialPayloadParity: audit.materialPayloadParity,
    qualityReleaseReady: definition.qualityReleaseReady,
    validatorErrors: audit.standardValidation?.errors ?? null,
    validatorWarnings: audit.standardValidation?.warnings ?? null,
    blockers: [...audit.blockers],
  };
}

export function createBrowserRoundTripReport(
  receipts: Iterable<BrowserRoundTripAssetReceipt>,
  consoleEvidence: BrowserConsoleEvidence,
  generatedAt = new Date().toISOString(),
): BrowserRoundTripReport {
  return {
    schema: BROWSER_ROUNDTRIP_PROOF_SCHEMA,
    compilerRevision: DELIVERY_PIPELINE_REVISION,
    fingerprintRevision: SCENE_FINGERPRINT_REVISION,
    generatedAt,
    console: {
      errors: consoleEvidence.errors,
      warnings: consoleEvidence.warnings,
      samples: [...consoleEvidence.samples],
    },
    assets: [...receipts].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  };
}
