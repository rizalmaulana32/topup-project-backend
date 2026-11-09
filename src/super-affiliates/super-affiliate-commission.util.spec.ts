import { SuperAffiliateThresholdMode } from './entities/super-affiliate-profile.entity';
import {
  periodRange,
  qualifiesForSuperAffiliateCommission,
  superAffiliateCommission,
} from './super-affiliate-commission.util';

describe('qualifiesForSuperAffiliateCommission', () => {
  const base = { thresholdAmount: 1000000 };

  it('per_transaction looks only at the transaction itself', () => {
    const mode = SuperAffiliateThresholdMode.PER_TRANSACTION;
    expect(
      qualifiesForSuperAffiliateCommission({
        ...base,
        mode,
        grossAmount: 1000000,
        monthVolumeIncludingThis: 0,
      }),
    ).toBe(true);
    expect(
      qualifiesForSuperAffiliateCommission({
        ...base,
        mode,
        grossAmount: 999999,
        monthVolumeIncludingThis: 50000000,
      }),
    ).toBe(false);
  });

  it.each([
    SuperAffiliateThresholdMode.MONTHLY_TOTAL_DOWNLINE,
    SuperAffiliateThresholdMode.MONTHLY_PER_AFFILIATE,
  ])('%s qualifies from the transaction that reaches the threshold', (mode) => {
    const check = (monthVolumeIncludingThis: number) =>
      qualifiesForSuperAffiliateCommission({
        ...base,
        mode,
        grossAmount: 100000,
        monthVolumeIncludingThis,
      });
    expect(check(999999)).toBe(false);
    expect(check(1000000)).toBe(true);
  });
});

describe('superAffiliateCommission', () => {
  it('takes the rate of the full gross amount, 2 decimals', () => {
    expect(superAffiliateCommission(1000000, 1)).toBe('10000.00');
    expect(superAffiliateCommission(123457, 1.5)).toBe('1851.86');
  });
});

describe('periodRange', () => {
  it('spans the UTC month, December rolling into the next year', () => {
    expect(periodRange('2026-12')).toEqual({
      start: new Date('2026-12-01T00:00:00Z'),
      end: new Date('2027-01-01T00:00:00Z'),
    });
  });
});
