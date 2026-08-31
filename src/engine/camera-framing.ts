import * as THREE from 'three';

export interface CameraFitOptions {
  bounds: THREE.Box3;
  direction: THREE.Vector3;
  up: THREE.Vector3;
  verticalFovDegrees: number;
  aspect: number;
  padding?: number;
}

export interface CameraFit {
  center: THREE.Vector3;
  direction: THREE.Vector3;
  up: THREE.Vector3;
  distance: number;
  radius: number;
}

/**
 * Keeps atmospheric depth subtle across millimetre-scale products and
 * building-scale scenes. A fixed density turns a 40 m building into the fog
 * colour as soon as the camera is fitted far enough away to see it.
 */
export function fogDensityForAssetRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Asset radius must be positive and finite.');
  return THREE.MathUtils.clamp(0.065 / radius, 0.0018, 0.055);
}

/** Fits every box corner inside both axes of a perspective frustum. */
export function fitPerspectiveCameraToBounds({
  bounds,
  direction,
  up,
  verticalFovDegrees,
  aspect,
  padding = 1.22,
}: CameraFitOptions): CameraFit {
  if (bounds.isEmpty()) throw new Error('Cannot frame an empty asset bounds.');
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Camera aspect must be positive and finite.');
  if (!Number.isFinite(verticalFovDegrees) || verticalFovDegrees <= 0 || verticalFovDegrees >= 179) {
    throw new Error('Camera field of view must be between 0 and 179 degrees.');
  }

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 0.001);
  const viewDirection = direction.clone().normalize();
  const requestedUp = up.clone().normalize();
  if (viewDirection.lengthSq() < 0.99 || requestedUp.lengthSq() < 0.99) {
    throw new Error('Camera direction and up vectors must be non-zero.');
  }

  let right = new THREE.Vector3().crossVectors(requestedUp, viewDirection);
  if (right.lengthSq() < 1e-8) {
    right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), viewDirection);
  }
  right.normalize();
  const fittedUp = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
  const tanVertical = Math.tan(THREE.MathUtils.degToRad(verticalFovDegrees * 0.5));
  const tanHorizontal = tanVertical * aspect;
  const safePadding = Math.max(1, padding);

  let distance = radius;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new THREE.Vector3(x, y, z).sub(center);
        const depthTowardCamera = corner.dot(viewDirection);
        const horizontal = Math.abs(corner.dot(right)) * safePadding;
        const vertical = Math.abs(corner.dot(fittedUp)) * safePadding;
        distance = Math.max(
          distance,
          depthTowardCamera + horizontal / tanHorizontal,
          depthTowardCamera + vertical / tanVertical,
        );
      }
    }
  }

  return {
    center,
    direction: viewDirection,
    up: fittedUp,
    distance: Math.max(distance, radius * 1.05),
    radius,
  };
}
