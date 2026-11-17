import { SuperAffiliateThresholdMode } from './entities/super-affiliate-profile.entity';
import {
  bonusChargedToSuperAffiliate,
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

  it('deducts a charged bonus, floored at 0', () => {
    // Rp1.000.000 at 5%, 2% bonus (20.000) charged to the SA.
    expect(superAffiliateCommission(1000000, 5, 20000)).toBe('30000.00');
    expect(superAffiliateCommission(1000000, 1, 20000)).toBe('0.00');
  });
});

describe('bonusChargedToSuperAffiliate', () => {
  it('goes to the bigger gross commission, tie stays with the affiliate', () => {
    expect(bonusChargedToSuperAffiliate(50000, 10000)).toBe(true); // SA 5%, aff 1%
    expect(bonusChargedToSuperAffiliate(10000, 50000)).toBe(false); // SA 1%, aff 5%
    expect(bonusChargedToSuperAffiliate(30000, 30000)).toBe(false);
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
