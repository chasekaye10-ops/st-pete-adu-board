import { describe, expect, it } from 'vitest';
import { calculateMaxAdu } from '../../src/domain/calculations.js';

describe('calculateMaxAdu', () => {
  it('caps a 1,950-square-foot home at 800 square feet', () => {
    expect(calculateMaxAdu(1950)).toBe(800);
  });

  it('uses 67 percent, rounded, below the city cap', () => {
    expect(calculateMaxAdu(975)).toBe(653);
  });
});
