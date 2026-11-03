import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticleBrush } from '../web/src/particle/runtime/molecular-brush.js';

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function fixture() {
  return {
    positions: new Float32Array([0, 0, 0, .12, .08, .2, -.14, -.05, -.1, .99, 0, 0]),
    destination: new Float32Array([.08, .02, .1, -.12, .08, -.1, .1, -.08, .2, .99, 0, 0]),
    scatter: new Float32Array([.4, -.2, .1, -.4, .3, -.2, .1, -.5, .4, .3, .1, .2]),
    matrix: identity, mix: 0, scaleFrom: 1, scaleTo: 1, width: 620, height: 530,
    pointer: { active: true, x: 310, y: 265, previousX: 310, previousY: 265, vx: 900, vy: -450 },
    delta: 1 / 60, still: false, brush: 1.1,
  };
}
function advance(brush, options, seconds, hz = 60) {
  let result = 0;
  for (let i = 0; i < Math.round(seconds * hz); i++) result = brush.update({ ...options, delta: 1 / hz });
  return result;
}

test('fast sweeps produce a strong bounded scatter while stationary pointers retain particles', () => {
  const options = fixture(), fast = createParticleBrush(4), slow = createParticleBrush(4);
  const originals = [options.positions.slice(), options.destination.slice(), options.scatter.slice()];
  const fastDistance = advance(fast, options, .3);
  const slowDistance = advance(slow, { ...options, pointer: { ...options.pointer, vx: 120, vy: -60 } }, .3);
  assert(fastDistance > 90, 'a fast sweep must visibly displace the particle cloud');
  assert(fastDistance > slowDistance * 4, 'speed must make the disturbance clearly stronger');
  assert(fastDistance <= 159.0001, 'displacements must respect the canvas-sized limit');
  assert.notDeepEqual([...fast.offsets.slice(0, 2)], [...fast.offsets.slice(2, 4)], 'particles should scatter separately');
  assert.deepEqual([...fast.offsets.slice(6)], [0, 0], 'particles at the frame edge must stay inside the silhouette margin');
  for (let i = 0; i < 3; i++) assert.deepEqual([options.positions, options.destination, options.scatter][i], originals[i]);
  fast.reset();
  assert.equal(advance(fast, { ...options, pointer: { ...options.pointer, vx: 0, vy: 0 } }, 1), 0,
    'a stationary pointer must not open a persistent hole');
});

test('leaving the sculpture preserves inertia and settles smoothly back to the surface', () => {
  const options = fixture(), brush = createParticleBrush(4);
  const before = advance(brush, options, .5);
  const inactive = { ...options, pointer: { ...options.pointer, active: false } };
  const first = brush.update(inactive);
  assert(first > before * .85 && first < before, 'leaving must begin a smooth recovery without snapping');
  const later = advance(brush, inactive, .25);
  assert(later > 0 && later < first * .1);
  assert(advance(brush, inactive, 1.5) < .00001, 'the particles must fully recover');
  assert(brush.offsets.every(Number.isFinite));
});

test('a fast swept path catches particles between pointer samples without expanding the brush radius', () => {
  const options = fixture(), swept = createParticleBrush(4), outside = createParticleBrush(4);
  const pointer = { ...options.pointer, previousX: 100, x: 520, previousY: 265, y: 265, vy: 0 };
  swept.update({ ...options, pointer });
  outside.update({ ...options, pointer: { ...pointer, previousX: 520 } });
  assert(Math.abs(swept.offsets[0]) > 1, 'the segment must catch a particle even when both samples are outside its radius');
  assert.equal(outside.offsets[0], 0, 'the same particle must stay still when the pointer remains outside the radius');
});

test('pause, disabled interaction and smaller draw budgets clear their particle state', () => {
  const options = fixture(), brush = createParticleBrush(4);
  for (const override of [{ still: true }, { brush: 0 }]) {
    assert(advance(brush, options, .2) > 0);
    assert.equal(brush.update({ ...options, ...override }), 0);
    assert(brush.offsets.every(value => value === 0));
  }
  advance(brush, options, .2);
  brush.update({ ...options, drawCount: 1 });
  assert(brush.offsets.slice(2).every(value => value === 0));
  brush.reset();
  assert(brush.offsets.every(value => value === 0));
});

test('critical damping agrees at 30 and 60 Hz and remains finite across morphs and projected views', () => {
  const options = fixture(), at30 = createParticleBrush(4), at60 = createParticleBrush(4);
  advance(at30, options, .5, 30);
  advance(at60, options, .5, 60);
  for (let i = 0; i < at30.offsets.length; i++) assert(Math.abs(at30.offsets[i] - at60.offsets[i]) < .0001);
  const inactive = { ...options, pointer: { ...options.pointer, active: false } };
  advance(at30, inactive, .5, 30);
  advance(at60, inactive, .5, 60);
  for (let i = 0; i < at30.offsets.length; i++) assert(Math.abs(at30.offsets[i] - at60.offsets[i]) < .0001);
  const perspective = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -.2, 0, 0, 0, 1]);
  for (const mix of [0, .25, .5, .75, 1]) for (const delta of [0, 1 / 30, .08, 100, NaN]) {
    const distance = at60.update({ ...options, width: 342, height: 390, matrix: perspective, mix, delta,
      pointer: { ...options.pointer, x: 171, y: 195, previousX: 165, previousY: 190, vx: 1e6, vy: -1e6 } });
    assert(Number.isFinite(distance) && distance <= 342 * .3 + .0001);
    assert(at60.offsets.every(Number.isFinite));
  }
});
