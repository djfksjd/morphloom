import { describe, expect, it } from 'vitest';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs';
import { bearingPack } from '../src/engine/bearing-pack';
import { appendWorkspaceAsset, generateWorkspaceAsset, serializeWorkspace, type ElementWorkspace } from '../src/engine/element-workspace';
import { createWorkspaceEditorSession, parseWorkspaceEditorFile, serializeWorkspaceEditorSession, validateWorkspaceEditorSession } from '../src/engine/workspace-editor-session';

function fixture(): ElementWorkspace {
  const registry = createElementDomainRegistry(); registry.register(bearingPack);
  let w: ElementWorkspace = { schema: 'morphloom.workspace/0.1', units: 'mm', coordinates: 'right-handed-y-up', assets: [] };
  for (const id of ['a', 'b']) w = appendWorkspaceAsset(w, generateWorkspaceAsset(registry, { id, packId: bearingPack.metadata.id, input: {}, requiredCapabilities: [], positionMm: [id==='a'?-100:100, 0, 0], rotationRad: [0, 0.2, 0] }));
  return w;
}
describe('separate versioned workspace editing session', () => {
  it('restores an explicit namespace and part without changing the existing source', () => {
    const w = fixture(), source = serializeWorkspace(w), session = createWorkspaceEditorSession(w, 'b', 'ball_0000');
    const parsed = parseWorkspaceEditorFile(serializeWorkspaceEditorSession(session));
    expect(parsed.format).toBe('editor-session'); expect(parsed.session.activeAssetId).toBe('b'); expect(parsed.session.selectedId).toBe('ball_0000');
    expect(serializeWorkspace(parsed.session.workspace)).toBe(source);
    expect(serializeWorkspace(w)).toBe(source);
    session.workspace.assets[0].positionMm[0] = 900;
    expect(serializeWorkspace(w)).toBe(source);
  });
  it('keeps legacy source loading policy explicit and lossless', () => {
    const w = fixture(), parsed = parseWorkspaceEditorFile(serializeWorkspace(w));
    expect(parsed.format).toBe('workspace-source'); expect(parsed.session.activeAssetId).toBe('a'); expect(parsed.session.selectedId).toBe('');
    expect(parsed.session.workspace).toEqual(w);
  });
  it.each([
    { schema: 'morphloom.workspace-editor-session/9' }, { activeAssetId: 'missing' },
    { activeAssetId: '' }, { selectedId: 'missing' }, { selectedId: 'b::ball_0000' },
    { selectedId: null }, { extra: true },
  ])('rejects invalid context %j without modifying source', patch => {
    const w = fixture(), before = serializeWorkspace(w), session = createWorkspaceEditorSession(w, 'b', 'ball_0000');
    expect(() => validateWorkspaceEditorSession({ ...session, ...patch })).toThrow(/workspace-session:/);
    expect(serializeWorkspace(w)).toBe(before);
  });
  it('allows an empty source only with empty editing context', () => {
    const empty: ElementWorkspace = { schema: 'morphloom.workspace/0.1', units: 'mm', coordinates: 'right-handed-y-up', assets: [] };
    expect(parseWorkspaceEditorFile(serializeWorkspaceEditorSession(createWorkspaceEditorSession(empty, '', ''))).session.workspace).toEqual(empty);
    expect(() => createWorkspaceEditorSession(empty, 'a', '')).toThrow(/workspace-session:/);
  });
  it('supports a valid asset ID that is an Object prototype property', () => {
    const w = fixture(); w.assets[1].id = 'constructor';
    expect(parseWorkspaceEditorFile(serializeWorkspaceEditorSession(createWorkspaceEditorSession(w, 'constructor', 'ball_0000'))).session.activeAssetId).toBe('constructor');
  });
  it('rejects over-budget or unknown files before source replacement', () => {
    expect(() => parseWorkspaceEditorFile(' '.repeat(2_000_001))).toThrow(/budget/);
    expect(() => parseWorkspaceEditorFile('{"schema":"unknown"}')).toThrow(/version/);
  });
});
