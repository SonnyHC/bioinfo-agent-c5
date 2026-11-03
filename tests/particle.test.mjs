import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHelix, HELIX_ZOOM } from '../web/src/particle/scene.js';

test('double helix remains finite and immutable through its complete rotation', () => {
  const scene = makeHelix();
  const baseline = JSON.stringify(scene.points);
  assert(scene.points.length > 10000 && scene.points.length < 30000);
  assert(new Set(scene.points.map(p=>p.part)).size === 4);
  const [yaw,pitch] = scene.view;
  let maxX=0,maxY=0;
  for(let time=0;time<46;time+=.5) {
    const pose=scene.animate(time);
    for(const p of scene.points) {
      const v=[p.x,p.y,p.z]; pose(p,v);
      assert(v.every(Number.isFinite));
      const x=v[0]*Math.cos(yaw)+v[2]*Math.sin(yaw);
      const rz=v[2]*Math.cos(yaw)-v[0]*Math.sin(yaw);
      const y=v[1]*Math.cos(pitch)+rz*Math.sin(pitch);
      const z=rz*Math.cos(pitch)-v[1]*Math.sin(pitch);
      const depth=3.9/(3.9-z*.42);
      maxX=Math.max(maxX,Math.abs(x*depth));maxY=Math.max(maxY,Math.abs(y*depth));
    }
  }
  for(const [w,h] of [[600,500],[700,640],[342,390],[272,390]]) {
    const scale=Math.min(w*.34,h*.35)*HELIX_ZOOM;
    assert(maxX*scale < w/2-8,`horizontal clipping at ${w}`);
    assert(maxY*scale < h/2-8,`vertical clipping at ${w}`);
  }
  assert.equal(JSON.stringify(scene.points),baseline);
});
