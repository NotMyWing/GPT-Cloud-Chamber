import { M4 } from './m4';

test('multiply identity matrices', () => {
  const I = new Float32Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1
  ]);
  const out = new Float32Array(16);
  M4.multiply(out, I, I);
  expect(Array.from(out)).toEqual(Array.from(I));
});

test('perspective matrix basic values', () => {
  const out = new Float32Array(16);
  M4.perspective(out, Math.PI / 2, 1, 1, 100);
  expect(out[0]).toBeCloseTo(1);
  expect(out[5]).toBeCloseTo(1);
  expect(out[11]).toBe(-1);
});
