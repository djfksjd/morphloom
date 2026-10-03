import type {AssemblyMaterialIR} from './assembly-ir';
type Projection = NonNullable<AssemblyMaterialIR['referenceProjection']>;
export function validateReferenceProjectionOrientation(value: unknown): void {
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Reference projection orientation is invalid.');
 const v=value as Record<string,unknown>;
 if(v.schema!=='morphloom.reference-projection-orientation/0.1'||(v.direction!=='positive'&&v.direction!=='negative')||(v.flipU!==undefined&&typeof v.flipU!=='boolean')||Object.keys(v).some(k=>!['schema','direction','flipU'].includes(k)))throw new Error('Reference projection orientation version/direction/reflection is invalid.');
}
/** Explicit deep-copy opt-in; never guesses a camera or changes the source image. */
export function migrateReferenceProjectionOrientation(projection: Projection, direction: 'positive'|'negative'='positive', flipU=false): Projection {
 validateReferenceProjectionOrientation(projection.orientation);
 const next=structuredClone(projection);next.orientation={schema:'morphloom.reference-projection-orientation/0.1',direction,flipU};validateReferenceProjectionOrientation(next.orientation);return next;
}
