/* BioInfoBuddy particle scene. Uses Particle Sculpture by LIghtJUNction.
 * SPDX-License-Identifier: AGPL-3.0-or-later; see web/public/particle/LICENSE and NOTICE. */
import { Shape, rotate, TAU } from './runtime/geometry.js';
import { createTimeline } from './runtime/timeline.js';
import { mountSculpture } from './runtime/motion.js';

// A stylized double helix, not a molecular-scale structural model.
export function makeHelix() {
  const shape = new Shape();
  const path = (t, phase) => [Math.cos(t * TAU * 2.3 + phase) * .63, (t - .5) * 2.85, Math.sin(t * TAU * 2.3 + phase) * .63];
  for (let strand = 0; strand < 2; strand++) shape.tube(t => path(t, strand * Math.PI), .085, [77, 153, 139], strand, 440, 14);
  for (let i = 1; i < 31; i++) {
    const t = i / 31, a = path(t, 0), b = path(t, Math.PI), mid = a.map((v,j)=>(v+b[j])/2);
    shape.line(a, mid, .035, [125, 168, 157], 2, 24);
    shape.line(mid, b, .035, [191, 156, 108], 3, 24);
  }
  for (const point of shape.points) {
    point.material = point.part === 0 ? 'primary' : point.part === 1 ? 'secondary' : point.part === 2 ? 'primary' : 'accent';
    point.shade = .70 + .30 * (point.color[1] / 168);
  }
  return {id:'double-helix', ...shape.model(time => {
    const turn = rotate(1, time * .14 + .3), tilt = rotate(2, -.35);
    const lift = Math.sin(time * .42) * .025;
    return (point, scratch) => {turn(point,scratch); tilt(point,scratch); scratch[1] += lift;};
  }, [.12,-.06])};
}

export const themes = {
  light: {primary:[47,145,125],secondary:[108,172,153],accent:[193,153,95]},
  dark: {primary:[96,221,185],secondary:[155,202,191],accent:[224,185,124]},
};
export const HELIX_ZOOM = .79;
export function mountHelix(canvas, {theme = 'light', onState} = {}) {
  return mountSculpture(canvas, createTimeline([makeHelix()], {transition:'cut'}), {
    onState,
    render:{projection:'perspective', zoom:HELIX_ZOOM, spacing:1.3, brush:.45, materials:themes[theme]},
  });
}
