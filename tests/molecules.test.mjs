import test from 'node:test';
import assert from 'node:assert/strict';
import { createMolecules } from '../web/src/particle/molecules.js';

test('DNA and protein sampling surfaces have finite indexed geometry and normalized normals', () => {
  const models = createMolecules({samples:1024});
  try {
    assert.deepEqual(models.map(model => model.id),['double-helix','protein']);
    for (const model of models) {
      const {geometry,bounds} = model;
      const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), color = geometry.getAttribute('color');
      assert(geometry.index.count > 10000 && geometry.index.count/3 < 45000, 'keep the surface detailed within the geometry budget');
      assert.equal(position.count,normal.count);
      assert.equal(position.count,color.count);
      assert([...position.array,...normal.array,...color.array].every(Number.isFinite));
      assert([...color.array].every(value => value >= 0 && value <= 1));
      assert([...geometry.index.array].every(index => index >= 0 && index < position.count));
      for (let i=0;i<normal.count;i++) {
        const length = Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i));
        assert(Math.abs(length-1)<.001, `${model.id}: invalid normal at vertex ${i}`);
      }
      const extents = bounds.max.map((value,i) => value-bounds.min[i]);
      assert(Math.abs(Math.max(...extents)-3.6)<.00001, 'each model gets its own full-size normalization');
      for(let axis=0;axis<3;axis++) assert(Math.abs(bounds.max[axis]+bounds.min[axis])<.00001, 'center each model independently');
      assert(extents[2]>.9, 'retain visible three-dimensional depth');
      assert(bounds.radius>1.5 && bounds.radius<3);
    }
    const protein = models[1].geometry.userData.parts;
    assert.equal(protein.filter(part=>part.kind==='alpha-helix').length,6);
    assert.equal(protein.filter(part=>part.kind==='beta-sheet').length,4);
    assert.equal(protein.filter(part=>part.kind==='connecting-loop').length,9);
    assert.equal(models[0].geometry.userData.parts.filter(part=>part.kind==='backbone').length,2);
  } finally { models.forEach(model=>model.geometry.dispose()); }
});

test('particles deterministically sample centered DNA and protein surfaces and colors', () => {
  const first = createMolecules({samples:1536}), second = createMolecules({samples:1536});
  try {
    for(let index=0;index<first.length;index++) {
      const model = first[index];
      assert.equal(model.positions.length,1536*3);
      assert.equal(model.colors.length,1536*3);
      assert.deepEqual(model.positions,second[index].positions);
      assert.deepEqual(model.colors,second[index].colors);
      assert([...model.positions,...model.colors].every(Number.isFinite));
      assert([...model.colors].every(value=>value>=0 && value<=1));
      for(let i=0;i<model.positions.length;i++) {
        const axis=i%3;
        assert(model.positions[i]>=model.bounds.min[axis]-.00001 && model.positions[i]<=model.bounds.max[axis]+.00001, 'particle endpoints must fit the visible model');
      }
      // The blue-to-cyan body and limited warmer accent both survive sampling.
      let blueDominant=0, warm=0;
      for(let i=0;i<model.colors.length;i+=3) {
        if(model.colors[i+2]>model.colors[i])blueDominant++;
        if(model.colors[i]>model.colors[i+2])warm++;
      }
      assert(blueDominant>1000);
      assert(warm>0 && warm<300);
    }
  } finally { [...first,...second].forEach(model=>model.geometry.dispose()); }
});

test('sample budgets reject invalid input before constructing sampling surfaces', () => {
  for(const samples of [0,-1,1.5,Infinity,NaN,100001]) assert.throws(()=>createMolecules({samples}),RangeError);
});

test('mobile particle prefixes span the full DNA and protein silhouettes', () => {
  const models = createMolecules({samples:10000});
  try {
    for (const model of models) {
      const minimum = [Infinity,Infinity,Infinity], maximum = [-Infinity,-Infinity,-Infinity];
      // The narrow renderer draws this prefix, including later sheet and loop parts.
      for (let i = 0; i < 6500*3; i++) {
        const axis = i%3;
        minimum[axis] = Math.min(minimum[axis],model.positions[i]);
        maximum[axis] = Math.max(maximum[axis],model.positions[i]);
      }
      for (let axis = 0; axis < 3; axis++) {
        const fullSpan = model.bounds.max[axis]-model.bounds.min[axis];
        assert((maximum[axis]-minimum[axis])/fullSpan > .97,
          `${model.id}: mobile particle budget must span at least97% of axis${axis}`);
      }
    }
  } finally { models.forEach(model=>model.geometry.dispose()); }
});
