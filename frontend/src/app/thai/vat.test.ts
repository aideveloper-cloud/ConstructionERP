import { describe, expect, it } from 'vitest';
import { computeVat, computeWht } from './vat';

describe('computeVat (matches backend compute_vat)', () => {
  it('adds 7% on top of a price before VAT', () => {
    expect(computeVat(46260, 'exclusive', 7)).toEqual({ net: 46260, vat: 3238.2, total: 49498.2 });
  });
  it('extracts VAT from a VAT-inclusive price', () => {
    expect(computeVat(49498.2, 'inclusive', 7)).toEqual({ net: 46260, vat: 3238.2, total: 49498.2 });
  });
  it('rounds VAT to satang half up', () => {
    // 10.05 × 7% = 0.7035 → 0.70 ; 0.15 × 7% = 0.0105 → 0.01
    expect(computeVat(10.05, 'exclusive', 7).vat).toBe(0.7);
    expect(computeVat(0.15, 'exclusive', 7).vat).toBe(0.01);
  });
  it('keeps net + VAT equal to the total when extracting', () => {
    const r = computeVat(1000, 'inclusive', 7);
    expect(Math.round((r.net + r.vat) * 100)).toBe(Math.round(r.total * 100));
    expect(r).toEqual({ net: 934.58, vat: 65.42, total: 1000 });
  });
  it('charges nothing when exempt', () => {
    expect(computeVat(1000, 'none', 7)).toEqual({ net: 1000, vat: 0, total: 1000 });
  });
});

describe('computeWht (matches backend compute_wht)', () => {
  it('takes 3% of the flagged lines', () => {
    expect(computeWht(40000, 'exclusive', 7, 3)).toEqual({ base: 40000, wht: 1200 });
  });
  it('brings VAT-inclusive lines back to net first', () => {
    expect(computeWht(42800, 'inclusive', 7, 3)).toEqual({ base: 40000, wht: 1200 });
  });
  it('withholds nothing at a zero rate', () => {
    expect(computeWht(1000, 'exclusive', 7, 0)).toEqual({ base: 1000, wht: 0 });
  });
});
