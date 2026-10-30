import {
  calculateTieredCommissionRate,
  currentPeriodKey,
  TIERED_COMMISSION_THRESHOLD,
} from './tiered-commission.util';

describe('calculateTieredCommissionRate', () => {
  it('returns the low rate below the threshold', () => {
    expect(calculateTieredCommissionRate(9999999)).toBe(1);
  });

  it('returns the high rate exactly at the threshold', () => {
    expect(calculateTieredCommissionRate(TIERED_COMMISSION_THRESHOLD)).toBe(5);
  });

  it('returns the high rate above the threshold', () => {
    expect(calculateTieredCommissionRate(50000000)).toBe(5);
  });
});

describe('currentPeriodKey', () => {
  it('formats as YYYY-MM in UTC', () => {
    expect(currentPeriodKey(new Date('2026-10-31T23:00:00Z'))).toBe(
      '2026-10',
    );
    expect(currentPeriodKey(new Date('2026-01-05T00:00:00Z'))).toBe(
      '2026-01',
    );
  });
});
