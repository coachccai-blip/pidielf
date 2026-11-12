import { describe, expect, it } from 'vitest';
import { straighten } from '@/core/marker';

const page = { width: 600, height: 800 };

describe('surligneur : redressement du trait', () => {
  it('redresse un trait presque horizontal', () => {
    const wobbly = [[0.1, 0.5], [0.3, 0.504], [0.5, 0.497], [0.7, 0.503], [0.9, 0.5]];
    const out = straighten(wobbly, page, 14);
    expect(out).toHaveLength(2);
    expect(out[0][0]).toBeCloseTo(0.1);
    expect(out[1][0]).toBeCloseTo(0.9);
    expect(out[0][1]).toBe(out[1][1]);
    expect(out[0][1]).toBeCloseTo(0.5, 2);
  });

  it('redresse un trait presque vertical', () => {
    const out = straighten([[0.2, 0.1], [0.203, 0.3], [0.198, 0.6]], page, 14);
    expect(out).toHaveLength(2);
    expect(out[0][0]).toBe(out[1][0]);
    expect(out[0][1]).toBeCloseTo(0.1);
    expect(out[1][1]).toBeCloseTo(0.6);
  });

  it('laisse intacts une courbe, un trait court ou un simple point', () => {
    const curve = [[0.1, 0.1], [0.3, 0.2], [0.5, 0.4], [0.7, 0.7]];
    expect(straighten(curve, page, 14)).toBe(curve);
    const short = [[0.1, 0.1], [0.11, 0.1], [0.12, 0.1]];
    expect(straighten(short, page, 14)).toBe(short);
    const dot = [[0.5, 0.5]];
    expect(straighten(dot, page, 14)).toBe(dot);
    expect(straighten(curve, undefined, 14)).toBe(curve);
  });
});
