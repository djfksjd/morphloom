import { describe, expect, it } from 'vitest';
import { createBirdProject, createFurProject } from '../src/engine/bird-element-demo.js';
import {
  ProjectError, ElementHistory, deleteElement, detachElement, detachPart,
  duplicateElement, editElement, editGroup, editPart, parseProject,
  resolveElements, restoreElement, restorePart, serializeProject, slotId,
  validateProject
} from '../src/engine/element-project.js';

describe('element projects', () => {
  it('resolves deterministic stable slots independent of count', () => {
    const p = createBirdProject();
    expect(p.parts).toHaveLength(13);
    const id = slotId('left_primary', 3), before = resolveElements(p).find(x => x.id === id)!;
    const grown = editGroup(p, 'left_primary', { count: 14 });
    expect(grown.receipt.added).toEqual([slotId('left_primary', 12), slotId('left_primary', 13)]);
    expect(resolveElements(grown.project).find(x => x.id === id)).toEqual(before);
    expect(p.groups[0].count).toBe(12);
  });

  it('preserves overrides and clears truncated slots permanently', () => {
    const id = slotId('left_primary', 11);
    let p = editElement(createBirdProject(), id, { params: { color: '#abcdef' }, visible: false });
    expect(resolveElements(p).find(x => x.id === id)?.params.color).toBe('#abcdef');
    p = editGroup(p, 'left_primary', { count: 10 }).project;
    expect(p.groups[0].overrides[id]).toBeUndefined();
    p = editGroup(p, 'left_primary', { count: 12 }).project;
    expect(resolveElements(p).find(x => x.id === id)?.params.color).not.toBe('#abcdef');
  });

  it('keeps a stable ID through detach and restore, retaining detached edits', () => {
    const slot = slotId('left_primary', 0);
    let p = editElement(createBirdProject(), slot, {
      params: { width: 9 }, position: [2, 3, 4], rotation: [0, 0, 0.2]
    });
    const before = resolveElements(p).find(x => x.id === slot)!;
    p = detachElement(p, slot);
    expect(p.elements[0].id).toBe(slot);
    expect(resolveElements(p).filter(x => x.id === slot)).toHaveLength(1);
    p = editElement(p, slot, { params: { width: 11 }, visible: false });
    p = editPart(p, 'wing_left', { position: [-100, 105, 0] });
    expect(resolveElements(p).find(x => x.id === slot)?.position).toEqual(before.position);
    p = restoreElement(p, slot);
    expect(p.elements).toHaveLength(0);
    const restored = resolveElements(p).find(x => x.id === slot)!;
    expect(restored.source).toBe('generated');
    expect(restored.params.width).toBe(11);
    expect(restored.visible).toBe(false);
    expect(p.groups[0].overrides[slot].position).toEqual([2, 3, 4]);
    expect(p.groups[0].overrides[slot].rotation).toEqual([0, 0, 0.2]);
  });

  it('rejects restoration after slot removal', () => {
    const slot = slotId('left_primary', 11);
    let p = detachElement(createBirdProject(), slot);
    p = editGroup(p, 'left_primary', { count: 10 }).project;
    expect(() => restoreElement(p, slot)).toThrow(ProjectError);
  });

  it('unlocks only with a standalone unlock and cannot bypass a locked parent', () => {
    const p = createBirdProject();
    const locked = editPart(p, 'eye_left', { locked: true });
    expect(() => editPart(locked, 'eye_left', { locked: false, color: '#ffffff' })).toThrow(ProjectError);
    expect(editPart(locked, 'eye_left', { locked: false }).parts.find(x => x.id === 'eye_left')?.locked).toBe(false);

    const slot = slotId('left_primary', 0);
    const elementLocked = editElement(p, slot, { locked: true });
    expect(() => editElement(elementLocked, slot, { locked: false, visible: false })).toThrow(ProjectError);
    expect(() => editGroup(elementLocked, 'left_primary', { params: { width: 12 } })).toThrow(ProjectError);
    expect(resolveElements(editElement(elementLocked, slot, { locked: false })).find(x => x.id === slot)?.locked).toBe(false);

    const parentLocked = editPart(p, 'wing_left', { locked: true });
    expect(() => editElement(parentLocked, slot, { locked: false })).toThrow(ProjectError);
    expect(() => detachPart(parentLocked, 'wing_left')).toThrow(ProjectError);
  });

  it('validates patches and does not retain mutable patch aliases', () => {
    const p = createBirdProject();
    expect(() => editPart(p, 'eye_left', { id: 'changed' } as any)).toThrow(ProjectError);
    expect(() => editPart(p, 'eye_left', { schema: 'changed' } as any)).toThrow(ProjectError);
    expect(() => editGroup(p, 'left_primary', { id: 'changed' } as any)).toThrow(ProjectError);
    expect(() => editGroup(p, 'left_primary', { params: { id: 'changed' } } as any)).toThrow(ProjectError);
    const position: [number, number, number] = [1, 2, 3];
    const next = editPart(p, 'eye_left', { position });
    position[0] = 999;
    expect(next.parts.find(x => x.id === 'eye_left')?.position).toEqual([1, 2, 3]);
    const params = { width: 9 };
    const changed = editGroup(p, 'left_primary', { params }).project;
    params.width = 99;
    expect(changed.groups[0].params.width).toBe(9);
    const overridePosition: [number, number, number] = [4, 5, 6];
    const edited = editElement(p, slotId('left_primary', 0), { position: overridePosition });
    overridePosition[0] = 999;
    expect(edited.groups[0].overrides[slotId('left_primary', 0)].position).toEqual([4, 5, 6]);
  });

  it('applies partial group params while slot overrides win', () => {
    const slot = slotId('left_primary', 0);
    const p = editElement(createBirdProject(), slot, { params: { width: 9 } });
    const changed = editGroup(p, 'left_primary', { params: { width: 12, color: '#abcdef' } }).project;
    expect(resolveElements(changed).find(x => x.id === slot)?.params.width).toBe(9);
    expect(resolveElements(changed).find(x => x.id === slot)?.params.color).toBe('#abcdef');
  });

  it('detaches and restores an independent part across serialization', () => {
    const p = createBirdProject();
    const initial = p.parts.find(x => x.id === 'eye_left')!;
    let next = detachPart(p, 'eye_left', [10, 0, 0]);
    expect(next.parts.find(x => x.id === 'eye_left')?.home?.position).toEqual(initial.position);
    next = detachPart(next, 'eye_left');
    expect(next.parts.find(x => x.id === 'eye_left')?.home?.position).toEqual(initial.position);
    next = restorePart(parseProject(serializeProject(next)), 'eye_left');
    expect(next.parts.find(x => x.id === 'eye_left')?.position).toEqual(initial.position);
    expect(next.parts.find(x => x.id === 'eye_left')?.home).toBeUndefined();
  });

  it('returns defensive resolved records', () => {
    const p = createBirdProject();
    const result = resolveElements(p);
    const first = result[0];
    first.evidence.source = 'modified';
    first.position[0] = 999;
    first.params.width = 999;
    expect(resolveElements(p)[0].evidence.source).not.toBe('modified');
    expect(resolveElements(p)[0].position[0]).not.toBe(999);
    expect(resolveElements(p)[0].params.width).not.toBe(999);
  });

  it('rejects malformed attachment references and duplicate ID categories', () => {
    const base = detachElement(createBirdProject(), slotId('left_primary', 0));
    for (const mutation of [
      (x: any) => { x.elements[0].original.slot = slotId('left_primary', 1); },
      (x: any) => { x.elements[0].original.groupId = 'tail_feathers'; },
      (x: any) => { x.elements[0].partId = 'eye_left'; },
      (x: any) => { x.elements[0].kind = 'strand'; },
      (x: any) => { x.elements[0].groupId = 'tail_feathers'; },
      (x: any) => { x.elements[0].id = 'wing_left'; },
      (x: any) => { x.regions[0].id = x.parts[0].id; },
      (x: any) => { x.groups[0].id = x.regions[0].id; }
    ]) {
      const p: any = structuredClone(base);
      mutation(p);
      expect(() => validateProject(p)).toThrow(ProjectError);
    }
  });

  it('rejects non-plain overrides, unsafe keys, budgets and overlong text', () => {
    const base = createBirdProject();
    for (const mutation of [
      (x: any) => { x.groups[0].overrides = JSON.parse('{"__proto__":{}}'); },
      (x: any) => { x.groups[0].overrides = Object.create({ inherited: {} }); },
      (x: any) => { x.groups[0].deleted = Array(5001).fill(slotId('left_primary', 0)); },
      (x: any) => { x.groups[0].count = 5000; },
      (x: any) => { x.parts[0].name = 'x'.repeat(513); },
      (x: any) => { x.parts[0].id = 'x'.repeat(129); },
      (x: any) => { x.groups[0].overrides = { [slotId('left_primary', 99)]: {} }; }
    ]) {
      const p: any = structuredClone(base);
      mutation(p);
      expect(() => validateProject(p)).toThrow(ProjectError);
    }
    expect(() => parseProject('x'.repeat(2_000_001))).toThrow(ProjectError);
  });

  it('uses all safe-integer seed bits', () => {
    const a = createBirdProject();
    const b = structuredClone(a);
    b.seed = a.seed + 4294967296;
    expect(resolveElements(a)[0].position).not.toEqual(resolveElements(b)[0].position);
  });

  it('duplicates and deletes without resurrecting generated slots', () => {
    const slot = slotId('tail_feathers', 0);
    let p = duplicateElement(createBirdProject(), slot, 'copy');
    expect(resolveElements(p).find(x => x.id === 'copy')?.source).toBe('explicit');
    expect(() => duplicateElement(p, slot, 'copy')).toThrow(ProjectError);
    p = deleteElement(p, slot);
    expect(resolveElements(p).find(x => x.id === 'copy')).toBeDefined();
    p = deleteElement(p, 'copy');
    expect(resolveElements(p).find(x => x.id === 'copy')).toBeUndefined();
  });

  it('round trips JSON and bounded undo/redo snapshots', () => {
    const p = createBirdProject(), q = parseProject(serializeProject(p)), h = new ElementHistory(q);
    expect(q).toEqual(p);
    h.commit(editPart(q, 'eye_left', { color: '#ffffff' }));
    expect(h.undo()).toEqual(p);
    expect(h.redo().parts[2].color).toBe('#ffffff');
  });

  it('provides a bounded strand example', () => {
    const p = createFurProject();
    expect(resolveElements(p)).toHaveLength(50);
    expect(resolveElements(p)[0].kind).toBe('strand');
  });

  it('places strand roots on the declared ideal surface and follows the owner', () => {
    const p = createFurProject(), owner = p.parts[0], root = resolveElements(p)[0];
    const equation = root.position.reduce((sum, n, i) => sum + ((n - owner.position[i]) / (owner.scale[i] / 2)) ** 2, 0);
    expect(equation).toBeCloseTo(1, 12);
    const moved = resolveElements(editPart(p, owner.id, { position: [10, 65, 0] }))[0];
    expect(moved.id).toBe(root.id);
    expect(moved.position[0] - root.position[0]).toBeCloseTo(10, 12);
  });

  it('does not report a detached surviving ID as deleted or add a duplicate on growth', () => {
    const id = slotId('left_primary', 11);
    const p = detachElement(createBirdProject(), id);
    const shrunk = editGroup(p, 'left_primary', { count: 10 });
    expect(shrunk.receipt.deleted).not.toContain(id);
    const grown = editGroup(shrunk.project, 'left_primary', { count: 12 });
    expect(grown.receipt.added).not.toContain(id);
    expect(resolveElements(grown.project).filter(e => e.id === id)).toHaveLength(1);
    expect(resolveElements(restoreElement(grown.project, id)).filter(e => e.id === id)).toHaveLength(1);
  });
});
