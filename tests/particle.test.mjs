import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHelix, makeProtein, createBiologyTimeline, mountHelix, HELIX_ZOOM } from '../web/src/particle/scene.js';

function checkGeometry(scene) {
  const baseline = JSON.stringify(scene.points);
  assert(scene.points.length > 10000 && scene.points.length < 30000);
  const [yaw, pitch] = scene.view;
  let maxX = 0, maxY = 0;
  for (let time = 0; time < 46; time += .5) {
    const pose = scene.animate(time);
    for (const point of scene.points) {
      const v = [point.x, point.y, point.z];
      pose(point, v);
      assert(v.every(Number.isFinite));
      const x = v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw);
      const rz = v[2] * Math.cos(yaw) - v[0] * Math.sin(yaw);
      const y = v[1] * Math.cos(pitch) + rz * Math.sin(pitch);
      const z = rz * Math.cos(pitch) - v[1] * Math.sin(pitch);
      const depth = 3.9 / (3.9 - z * .42);
      maxX = Math.max(maxX, Math.abs(x * depth));
      maxY = Math.max(maxY, Math.abs(y * depth));
    }
  }
  for (const [w, h] of [[600, 500], [700, 640], [342, 390], [272, 390]]) {
    const scale = Math.min(w * .34, h * .35) * HELIX_ZOOM;
    assert(maxX * scale < w / 2 - 8, `${scene.id}: horizontal clipping at ${w}`);
    assert(maxY * scale < h / 2 - 8, `${scene.id}: vertical clipping at ${w}`);
  }
  assert.equal(JSON.stringify(scene.points), baseline, 'animation must not change sampled rest points');
}

test('DNA and folded protein remain finite, immutable and inside desktop/mobile framing', () => {
  const helix = makeHelix(), protein = makeProtein();
  assert.equal(new Set(helix.points.map(point => point.part)).size, 4);
  assert.equal(protein.id, 'protein');
  assert(new Set(protein.points.map(point => point.material)).size >= 2);
  checkGeometry(helix);
  checkGeometry(protein);
});

const simpleScenes = () => ['double-helix', 'protein'].map(id => ({ id, points: [], animate: () => () => {}, view: [0, 0] }));
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, message ?? `${actual} != ${expected}`);

test('automatic sequence holds each shape, morphs both ways and keeps ambient rotation continuous', () => {
  const timeline = createBiologyTimeline(simpleScenes());
  close(timeline.at(0).mix, 0);
  close(timeline.at(5.9).mix, 0);
  const middle = timeline.at(6.575);
  assert.equal(middle.from.id, 'double-helix');
  assert.equal(middle.to.id, 'protein');
  assert.equal(middle.transition, 'morph');
  close(middle.mix, .5);
  close(timeline.at(7.15).mix, 1);
  close(timeline.at(13).mix, 1);
  close(timeline.at(13.725).mix, .5);
  close(timeline.at(14.3).mix, 0);
  for (const time of [6, 7.15, 13.15, 14.3, 142.999]) {
    const frame = timeline.at(time);
    close(frame.age, time);
    close(frame.nextAge, time);
    close(timeline.at(time - 1e-7).mix, timeline.at(time + 1e-7).mix, 'cycle boundary must not jump');
  }
});

test('click interrupts the wait, reverses a morph from its current position and restarts automatic cycling', () => {
  const timeline = createBiologyTimeline(simpleScenes());
  timeline.next(1);
  close(timeline.at(1).mix, 0);
  const before = timeline.at(1.4).mix;
  assert(before > 0 && before < 1, 'a click must begin morphing before the six-second automatic wait');
  timeline.next(1.4);
  close(timeline.at(1.4).mix, before, 'repeated click must not jump to a complete shape');
  assert(timeline.at(1.5).mix < before, 'second click reverses toward DNA immediately');
  close(timeline.at(2.55).mix, 0);
  // A manual change does not permanently pin the sequence to one object.
  assert(timeline.at(8.55).mix > 0);
  timeline.next(9, true);
  assert([0, 1].includes(timeline.at(9).mix), 'static/manual selection must use a complete endpoint');

  const earlyMorph = createBiologyTimeline(simpleScenes());
  earlyMorph.next(1);
  assert(earlyMorph.at(1.2).mix > 0 && earlyMorph.at(1.2).mix < .5);
  earlyMorph.next(1.2, true);
  close(earlyMorph.at(1.2).mix, 1, 'pausing an early morph and clicking must change the visible DNA to protein');
});

function environment(t, { reducedMotion = false, saveData = false } = {}) {
  const descriptors = new Map(), callbacks = new Map(), observers = [], targets = [], owners = [];
  let nextFrame = 0, clock = 100;
  function events() {
    const listeners = new Map();
    const target = {
      listeners,
      addEventListener(name, listener) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(listener);
      },
      removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
      dispatch(name, event = {}) { for (const listener of [...(listeners.get(name) ?? [])]) listener(event); },
    };
    targets.push(target);
    return target;
  }
  const root = { ...events(), className: '', parentElement: null };
  const host = { ...events(), parentElement: root };
  const reduced = { ...events(), matches: reducedMotion };
  const document = { ...events(), documentElement: root, hidden: false };
  const observerClass = kind => class {
    nodes = [];
    disconnected = false;
    constructor(callback) { this.callback = callback; this.kind = kind; observers.push(this); }
    observe(node) { this.nodes.push(node); }
    disconnect() { this.disconnected = true; }
  };
  for (const [name, value] of Object.entries({
    document, window: { devicePixelRatio: 1 }, navigator: { connection: { saveData } }, innerWidth: 1280,
    getComputedStyle: () => ({ getPropertyValue: () => '#f5f5ef' }),
    requestAnimationFrame: callback => { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => callbacks.delete(id),
    matchMedia: query => query.includes('reduced-motion') ? reduced : { ...events(), matches: true },
    ResizeObserver: observerClass('resize'), IntersectionObserver: observerClass('intersection'), MutationObserver: observerClass('theme'),
  })) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const owner of owners) owner.dispose();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const canvas = {
    ...events(), parentElement: host, dataset: {}, clientWidth: 320, clientHeight: 390, width: 0, height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    }),
  };
  return {
    canvas, document, reduced, callbacks, observers, targets,
    own(owner) { owners.push(owner); },
    step(ms = 20) {
      clock += ms;
      const pending = [...callbacks.values()];
      callbacks.clear();
      assert(pending.length <= 1, 'the sculpture must have only one animation owner');
      for (const callback of pending) callback(clock);
    },
    advance(ms) { for (let elapsed = 0; elapsed < ms; elapsed += 20) this.step(20); },
  };
}

test('primary click morphs the canvas; pause allows static changes without restarting its clock', t => {
  const env = environment(t), seen = [];
  const owner = mountHelix(env.canvas, { onScene: scene => seen.push(scene) });
  env.own(owner);
  env.step();
  assert.equal(env.canvas.dataset.sculpture, 'double-helix');
  env.canvas.dispatch('click', { button: 0 });
  env.advance(800);
  assert.equal(env.canvas.dataset.sculpture, 'protein');
  assert(seen.includes('protein'), 'accessible host state must follow the visible shape');
  owner.pause(true);
  env.step();
  const time = owner.inspect().time;
  assert.equal(env.callbacks.size, 0);
  env.canvas.dispatch('click', { button: 2 });
  env.step();
  assert.equal(env.canvas.dataset.sculpture, 'protein', 'secondary mouse button must not change the shape');
  env.canvas.dispatch('click', { button: 0 });
  env.step();
  assert.equal(env.canvas.dataset.sculpture, 'double-helix');
  assert.equal(owner.inspect().state, 'paused');
  assert.equal(owner.inspect().time, time);
  assert.equal(env.callbacks.size, 0);
  owner.next();
  env.step();
  assert.equal(env.canvas.dataset.sculpture, 'protein', 'keyboard/API activation uses the same shape change');
  assert.equal(owner.inspect().time, time);
});

test('reduced motion retains a real static shape while allowing manual selection', t => {
  const env = environment(t, { reducedMotion: true }), states = [];
  const owner = mountHelix(env.canvas, { onState: state => states.push(state) });
  env.own(owner);
  env.step();
  assert.equal(env.canvas.dataset.sculpture, 'double-helix');
  assert.equal(env.callbacks.size, 0);
  env.canvas.dispatch('click', { button: 0 });
  env.step();
  assert.equal(env.canvas.dataset.sculpture, 'protein');
  assert.equal(owner.inspect().time, 0);
  assert.equal(owner.inspect().state, 'reduced');
  assert.equal(env.callbacks.size, 0);
  assert(states.includes('reduced'));
});

test('data-saving startup stays paused after selecting another shape', t => {
  const env = environment(t, { saveData: true });
  const owner = mountHelix(env.canvas);
  env.own(owner);
  env.step();
  owner.next();
  env.step();
  assert.equal(env.canvas.dataset.sculpture, 'protein');
  assert.equal(owner.inspect().state, 'paused');
  assert.equal(owner.inspect().time, 0);
  assert.equal(env.callbacks.size, 0);
});

test('pointer response is visible, can be disabled, and recovers after the pointer leaves', t => {
  const env = environment(t);
  const owner = mountHelix(env.canvas);
  env.own(owner);
  env.step();
  owner.configure({ brush: 0 });
  for (let x = 100; x <= 220; x += 20) {
    env.canvas.dispatch('pointermove', { clientX: x, clientY: 195 });
    env.step();
  }
  assert.equal(owner.inspect().maxOffset, 0);
  owner.configure({ brush: 1.1 });
  let displaced = 0;
  for (let x = 220; x >= 100; x -= 20) {
    env.canvas.dispatch('pointermove', { clientX: x, clientY: 195 });
    env.step();
    displaced = Math.max(displaced, owner.inspect().maxOffset);
  }
  assert(displaced > 2, 'moving over the sculpture should visibly displace particles');
  assert(displaced < 160, 'response should stay bounded within the sculpture region');
  env.canvas.dispatch('pointerleave');
  env.advance(1000);
  assert(owner.inspect().maxOffset < .1, 'particles must return to their surface instead of drifting');
});

test('hidden and offscreen time does not skip shapes, and disposal removes every listener and frame', t => {
  const env = environment(t);
  const owner = mountHelix(env.canvas);
  env.step();
  const initial = owner.inspect().time;
  env.document.hidden = true;
  env.document.dispatch('visibilitychange');
  assert.equal(env.callbacks.size, 0);
  env.step(60000);
  assert.equal(owner.inspect().time, initial);
  env.document.hidden = false;
  env.document.dispatch('visibilitychange');
  env.step();
  assert(owner.inspect().time - initial < .1, 'returning to the page must not fast-forward the scene');
  const offscreen = env.observers.find(observer => observer.kind === 'intersection');
  offscreen.callback([{ isIntersecting: false }]);
  assert.equal(env.callbacks.size, 0);
  env.step(60000);
  offscreen.callback([{ isIntersecting: true }]);
  env.step();
  assert(owner.inspect().time - initial < .2);
  owner.dispose();
  assert(env.observers.every(observer => observer.disconnected));
  assert(env.targets.every(target => [...target.listeners.values()].every(listeners => listeners.size === 0)));
  assert.equal(env.callbacks.size, 0);
  assert.equal(env.canvas.width, 0);
  env.canvas.dispatch('click', { button: 0 });
  owner.next();
  owner.refresh();
  env.step();
  assert.equal(env.callbacks.size, 0, 'disposed callbacks must never revive the scene');
});
