import test from 'node:test';
import assert from 'node:assert/strict';
import { fitMolecule, MOLECULE_CAMERA, rotateForView } from '../web/src/particle/runtime/molecular-fit.js';
import { createMolecules } from '../web/src/particle/molecules.js';

test('independent molecular fitting keeps complete silhouettes inside desktop and narrow canvases', () => {
  const models = [
    { min: [-1.4, -1.8, -.6], max: [1.4, 1.8, .6] },
    { min: [-1.8, -1.55, -.8], max: [1.8, 1.55, .8] },
    { min: [-.3, -.7, -1.8], max: [.3, .7, 1.8] },
  ];
  const { distance, fov, yaw, pitch } = MOLECULE_CAMERA;
  const tangent = Math.tan(fov * Math.PI / 360);
  for (const [width, height] of [[620, 530], [700, 640], [342, 390], [272, 390]]) {
    for (const projection of ['perspective', 'orthographic']) {
      for (const bounds of models) {
        const scale = fitMolecule(bounds, width, height, { projection });
        assert(Number.isFinite(scale) && scale > 0);
        for (let corner = 0; corner < 8; corner++) {
          const point = bounds.min.map((low, axis) => corner & (1 << axis) ? bounds.max[axis] : low);
          for (let angle = 0; angle <= 100; angle++) {
            const [x, y, z] = rotateForView(point, yaw * Math.sin(angle * 1.31), pitch * Math.cos(angle * 2.73));
            const depth = projection === 'perspective' ? distance - z * scale : distance;
            const projectedX = Math.abs(x * scale / (depth * tangent * width / height));
            const projectedY = Math.abs((y * scale + .02) / (depth * tangent));
            assert(projectedX < .92 && projectedY < .92, `cropped ${projection} silhouette at ${width}×${height}`);
          }
        }
      }
    }
  }
});

test('actual DNA and protein fill the stage while retaining their complete geometry through viewing sway', () => {
  const models = createMolecules();
  const { distance, fov, yaw, pitch } = MOLECULE_CAMERA;
  const tangent = Math.tan(fov * Math.PI / 360);
  for (const [width, height] of [[620, 530], [342, 390], [272, 390]]) {
    for (const projection of ['perspective', 'orthographic']) for (const model of models) {
      const positions = model.geometry.attributes.position.array;
      const scale = fitMolecule(model.bounds, width, height, { projection }, positions);
      assert(scale > fitMolecule(model.bounds, width, height, { projection }), 'fitting the actual surface must recover the empty box-corner margin');
      let frontWidth = 0, frontHeight = 0;
      for (let angle = 0; angle < 29; angle++) {
        const ay = angle ? yaw * Math.sin(angle * 1.41) : 0;
        const ax = angle ? pitch * Math.cos(angle * 2.73) : 0;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < positions.length; i += 3) {
          const [x, y, z] = rotateForView([positions[i], positions[i + 1], positions[i + 2]], ay, ax);
          const depth = projection === 'perspective' ? distance - z * scale : distance;
          const px = x * scale / (depth * tangent * width / height);
          const py = (y * scale + .015) / (depth * tangent);
          assert(Math.abs(px) < .93 && Math.abs(py) < .93, `${model.id} clipped at ${width}×${height}`);
          minX = Math.min(minX, px); maxX = Math.max(maxX, px);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
        if (!angle) { frontWidth = (maxX - minX) / 2; frontHeight = (maxY - minY) / 2; }
      }
      assert(Math.max(frontWidth, frontHeight) > .8, `${model.id} should fill at least80% of the limiting dimension: ${frontWidth},${frontHeight}`);
    }
  }
  for (const model of models) model.geometry.dispose();
});

test('smaller model bounds receive their own larger scale and zoom cannot crop the fitted silhouette', () => {
  const small = { min: [-1, -1, -.4], max: [1, 1, .4] };
  const large = { min: [-1.8, -1.8, -.8], max: [1.8, 1.8, .8] };
  assert(fitMolecule(small, 600, 500) > fitMolecule(large, 600, 500));
  assert.equal(fitMolecule(small, 600, 500, { zoom: 2 }), fitMolecule(small, 600, 500));
  assert.equal(fitMolecule(small, 0, 0), 1);
});
