import { calculateCustomAmountPricing } from './custom-amount-pricing.util';

describe('calculateCustomAmountPricing', () => {
  it('adds 0.7% of the amount as extra coin, floored to a whole coin', () => {
    // 350000 * 0.7% = 2450 exactly (a float 0.007 would floor this to 2449)
    expect(calculateCustomAmountPricing(350000, 0).extraCoin).toBe(2450);
    // 10001 * 0.7% = 70.007 -> 70
    expect(calculateCustomAmountPricing(10001, 0).extraCoin).toBe(70);
  });

  it('pays out exactly the nominal amount (1:1) with no bonus below the lowest tier', () => {
    expect(calculateCustomAmountPricing(25000, 0)).toEqual({
      coinAmount: 25175,
      bonusCoin: 0,
      extraCoin: 175,
      costBasis: 25175,
    });
  });

  it('applies no bonus just below the first tier threshold', () => {
    expect(calculateCustomAmountPricing(349999, 0)).toEqual({
      coinAmount: 352448,
      bonusCoin: 0,
      extraCoin: 2449,
      costBasis: 352448,
    });
  });

  it('applies the matching tier bonus exactly at a threshold', () => {
    expect(calculateCustomAmountPricing(350000, 0)).toEqual({
      coinAmount: 355950,
      bonusCoin: 3500,
      extraCoin: 2450,
      costBasis: 355950,
    });
  });

  it('floors to the lower tier for an amount between two tiers', () => {
    // Rp 512,000 is between the 500k (+5,000) and 550k (+5,500) tiers.
    expect(calculateCustomAmountPricing(512000, 0)).toEqual({
      coinAmount: 520584,
      bonusCoin: 5000,
      extraCoin: 3584,
      costBasis: 520584,
    });
  });

  it('matches the top published tier for Rp 30,000,000', () => {
    expect(calculateCustomAmountPricing(30000000, 0)).toEqual({
      coinAmount: 30810000,
      bonusCoin: 600000,
      extraCoin: 210000,
      costBasis: 30810000,
    });
  });

  it('keeps using the top tier bonus above the highest published amount', () => {
    expect(calculateCustomAmountPricing(50000000, 0)).toEqual({
      coinAmount: 50950000,
      bonusCoin: 600000,
      extraCoin: 350000,
      costBasis: 50950000,
    });
  });

  it('applies an additional configured margin rate on top of the published rate', () => {
    // full value = 25000 + 175 extra (no bonus); 10% cut -> floor(25175 * 0.9) = 22657
    expect(calculateCustomAmountPricing(25000, 10)).toEqual({
      coinAmount: 22657,
      bonusCoin: 0,
      extraCoin: 175,
      costBasis: 22657,
    });
  });

  it('reports bonusCoin as the raw published tier amount, unaffected by an additional margin cut', () => {
    // full value = 355950 (350000 + 3500 bonus + 2450 extra); 10% cut -> floor(355950*0.9) = 320355
    expect(calculateCustomAmountPricing(350000, 10)).toEqual({
      coinAmount: 320355,
      bonusCoin: 3500,
      extraCoin: 2450,
      costBasis: 320355,
    });
  });
});
