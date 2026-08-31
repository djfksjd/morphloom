import type { AssemblyIR } from './assembly-ir';

const EDITABLE_LAYOUT_PATTERN = /bed|chair|table|sofa|console|counter|island|wardrobe|nightstand|toilet|basin|vanity|shower|light|cabinet/i;

export type LayoutEdit =
  | { kind: 'translate'; deltaMm: [number, number, number] }
  | { kind: 'rotateY'; radians: number }
  | { kind: 'reset'; source: AssemblyIR };

export function isLayoutEditable(partId: string): boolean {
  return EDITABLE_LAYOUT_PATTERN.test(partId);
}

export function editAssemblyLayout(ir: AssemblyIR, componentId: string, edit: LayoutEdit): AssemblyIR {
  if (!isLayoutEditable(componentId)) return ir;
  const sourceComponent = edit.kind === 'reset'
    ? edit.source.components.find((component) => component.id === componentId)
    : undefined;
  let changed = false;
  const components = ir.components.map((component) => {
    if (component.id !== componentId) return component;
    if (edit.kind === 'reset') {
      if (!sourceComponent) return component;
      changed = true;
      return { ...component, position: sourceComponent.position, rotation: sourceComponent.rotation };
    }
    if (edit.kind === 'translate') {
      const position = component.position ?? [0, 0, 0];
      changed = true;
      return {
        ...component,
        position: position.map((value, index) => value + edit.deltaMm[index]) as [number, number, number],
      };
    }
    const rotation = component.rotation ?? [0, 0, 0];
    changed = true;
    return {
      ...component,
      rotation: [rotation[0], rotation[1] + edit.radians, rotation[2]] as [number, number, number],
    };
  });
  return changed ? { ...ir, components } : ir;
}
