import {
  calculateTieredCommissionRate,
  currentPeriodKey,
  monthPayoutPeriods,
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
    expect(currentPeriodKey(new Date('2026-10-31T23:00:00Z'))).toBe('2026-10');
    expect(currentPeriodKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01');
  });
});

describe('monthPayoutPeriods', () => {
  it('splits a month into 1-15 and 16-last day, leap February included', () => {
    expect(monthPayoutPeriods('2026-11')).toEqual({
      period_1: { date_from: '2026-11-01', date_to: '2026-11-15' },
      period_2: { date_from: '2026-11-16', date_to: '2026-11-30' },
    });
    expect(monthPayoutPeriods('2028-02').period_2.date_to).toBe('2028-02-29');
    expect(monthPayoutPeriods('2026-12').period_2.date_to).toBe('2026-12-31');
  });
});
