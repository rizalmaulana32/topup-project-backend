import {
  BonusTierRange,
  bonusForAmount,
  calculateCustomAmountPricing,
} from './custom-amount-pricing.util';

const tier = (
  minAmount: number,
  maxAmount: number | null,
  bonusPercent: number,
  isActive = true,
): BonusTierRange => ({ minAmount, maxAmount, bonusPercent, isActive });

// Same as the migration seed.
const SEED = [tier(350000, 1000000, 1), tier(1000000, null, 2)];

describe('bonusForAmount', () => {
  const tiers = [tier(100000, 300000, 1), tier(300000, 500000, 2)];

  it('puts an amount exactly on a boundary in the upper tier (max is exclusive)', () => {
    expect(bonusForAmount(300000, tiers)).toBe(6000);
    expect(bonusForAmount(299999, tiers)).toBe(2999);
  });

  it('gives 0 below the lowest tier and at/above a bounded top tier', () => {
    expect(bonusForAmount(99999, tiers)).toBe(0);
    expect(bonusForAmount(500000, tiers)).toBe(0);
    expect(bonusForAmount(500000, [])).toBe(0);
  });

  it('applies a tier with no upper bound to any larger amount', () => {
    expect(bonusForAmount(50000000, SEED)).toBe(1000000);
  });

  it('ignores inactive tiers', () => {
    expect(bonusForAmount(350000, [tier(350000, null, 1, false)])).toBe(0);
  });

  it('floors with integer math, no float off-by-one', () => {
    // 1.15% of 100000 = 1150 exactly; 100000 * 1.15 / 100 as floats is 1149.999...
    expect(bonusForAmount(100000, [tier(0, null, 1.15)])).toBe(1150);
    // 512000 * 1% = 5120 (the old floor-to-tier table gave 5000)
    expect(bonusForAmount(512000, SEED)).toBe(5120);
  });
});

describe('calculateCustomAmountPricing', () => {
  it('adds 0.7% of the amount as extra coin, floored to a whole coin', () => {
    // 350000 * 0.7% = 2450 exactly (a float 0.007 would floor this to 2449)
    expect(calculateCustomAmountPricing(350000, SEED, 0).extraCoin).toBe(2450);
    // 10001 * 0.7% = 70.007 -> 70
    expect(calculateCustomAmountPricing(10001, SEED, 0).extraCoin).toBe(70);
  });

  it('pays out exactly the nominal amount (1:1) with no bonus below the lowest tier', () => {
    expect(calculateCustomAmountPricing(25000, SEED, 0)).toEqual({
      coinAmount: 25175,
      bonusCoin: 0,
      extraCoin: 175,
      costBasis: 25175,
    });
  });

  it('adds the tier bonus and leaves the extra out when disabled', () => {
    expect(calculateCustomAmountPricing(1000000, SEED, 0, false)).toEqual({
      coinAmount: 1020000,
      bonusCoin: 20000,
      extraCoin: 0,
      costBasis: 1020000,
    });
  });

  it('applies an additional configured margin rate on top of the published rate', () => {
    // full value = 25000 + 175 extra (no bonus); 10% cut -> floor(25175 * 0.9) = 22657
    expect(calculateCustomAmountPricing(25000, SEED, 10)).toEqual({
      coinAmount: 22657,
      bonusCoin: 0,
      extraCoin: 175,
      costBasis: 22657,
    });
  });

  it('reports bonusCoin as the raw tier amount, unaffected by an additional margin cut', () => {
    // full value = 355950 (350000 + 3500 bonus + 2450 extra); 10% cut -> floor(355950*0.9) = 320355
    expect(calculateCustomAmountPricing(350000, SEED, 10)).toEqual({
      coinAmount: 320355,
      bonusCoin: 3500,
      extraCoin: 2450,
      costBasis: 320355,
    });
  });
});
