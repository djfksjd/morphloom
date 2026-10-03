import { resolveElements } from './element-project';
import { parseWorkspace, validateWorkspace, type ElementWorkspace } from './element-workspace';

export const WORKSPACE_EDITOR_SESSION_SCHEMA = 'morphloom.workspace-editor-session/0.1';
export type WorkspaceEditorSession = {
  schema: typeof WORKSPACE_EDITOR_SESSION_SCHEMA;
  workspace: ElementWorkspace;
  activeAssetId: string;
  selectedId: string;
};
const budget = 2_000_000;
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fail(code: string): never { throw new Error('workspace-session:' + code); }
function bounded(text: string): void { if (new TextEncoder().encode(text).byteLength > budget) fail('budget'); }

/** Editing context only; never mutates or migrates the embedded modelling source. */
export function validateWorkspaceEditorSession(value: unknown): WorkspaceEditorSession {
  if (!plain(value) || Object.keys(value).length !== 4 || ['schema', 'workspace', 'activeAssetId', 'selectedId'].some(k => !Object.hasOwn(value, k))) fail('fields');
  if (value.schema !== WORKSPACE_EDITOR_SESSION_SCHEMA) fail('version');
  if (typeof value.activeAssetId !== 'string' || typeof value.selectedId !== 'string' || value.activeAssetId.length > 48 || value.selectedId.length > 135) fail('context');
  const workspace = validateWorkspace(value.workspace);
  if (!workspace.assets.length) {
    if (value.activeAssetId || value.selectedId) fail('context');
  } else {
    const active = workspace.assets.find(a => a.id === value.activeAssetId);
    if (!active) fail('asset');
    if (value.selectedId && !active.source.parts.some(p => p.id === value.selectedId) && !active.source.groups.some(g => g.id === value.selectedId) && !resolveElements(active.source).some(e => e.id === value.selectedId)) fail('selection');
  }
  bounded(JSON.stringify(value));
  return value as unknown as WorkspaceEditorSession;
}

/** Explicit source-to-envelope conversion. Legacy source loading keeps its previous default. */
export function createWorkspaceEditorSession(workspace: ElementWorkspace, activeAssetId: string, selectedId: string): WorkspaceEditorSession {
  const session = validateWorkspaceEditorSession({ schema: WORKSPACE_EDITOR_SESSION_SCHEMA, workspace, activeAssetId, selectedId });
  return structuredClone(session);
}

export function serializeWorkspaceEditorSession(session: WorkspaceEditorSession): string {
  validateWorkspaceEditorSession(session);
  const text = JSON.stringify(session, (_key, value: unknown) => plain(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value, 2);
  bounded(text); return text;
}

export function parseWorkspaceEditorFile(text: string): { format: 'workspace-source' | 'editor-session'; session: WorkspaceEditorSession } {
  bounded(text); const value: unknown = JSON.parse(text);
  if (!plain(value)) fail('fields');
  if (value.schema === 'morphloom.workspace/0.1') {
    const workspace = parseWorkspace(text);
    return { format: 'workspace-source', session: createWorkspaceEditorSession(workspace, workspace.assets[0]?.id ?? '', '') };
  }
  if (value.schema !== WORKSPACE_EDITOR_SESSION_SCHEMA) fail('version');
  return { format: 'editor-session', session: validateWorkspaceEditorSession(value) };
}
