import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitPerspectiveCameraToBounds } from '../src/engine/camera-framing';

describe('element editor existing frustum fit across asset sizes', () => {
  it.each([0.008, 0.026, 0.125, 12])('includes every corner for a %sm asset in wide and narrow hosts', extent => {
    for (const aspect of [0.45, 1.8]) {
      const center = new THREE.Vector3(0.4, -0.2, 0.7);
      const half = new THREE.Vector3(extent / 2, extent / 4, extent / 2);
      const bounds = new THREE.Box3(center.clone().sub(half), center.clone().add(half));
      const fit = fitPerspectiveCameraToBounds({ bounds, direction: new THREE.Vector3(1, 0.55, 1), up: new THREE.Vector3(0, 1, 0), verticalFovDegrees: 45, aspect, padding: 1.22 });
      const camera = new THREE.PerspectiveCamera(45, aspect, Math.max(0.000001, fit.radius / 1000), Math.max(10, fit.radius * 20));
      camera.position.copy(fit.center).addScaledVector(fit.direction, fit.distance);
      camera.lookAt(fit.center); camera.updateMatrixWorld();
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(p.x)).toBeLessThan(0.84);
        expect(Math.abs(p.y)).toBeLessThan(0.84);
        expect(p.z).toBeGreaterThan(-1);
        expect(p.z).toBeLessThan(1);
      }
      expect(fit.center.distanceTo(center)).toBeLessThan(1e-10);
    }
  });
});
