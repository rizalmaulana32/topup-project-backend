import { calculateCustomAmountPricing } from './custom-amount-pricing.util';

describe('calculateCustomAmountPricing', () => {
  it('pays out exactly the nominal amount (1:1) with no bonus below the lowest tier', () => {
    expect(calculateCustomAmountPricing(25000, 0)).toEqual({
      coinAmount: 25000,
      bonusCoin: 0,
      costBasis: 25000,
    });
  });

  it('applies no bonus just below the first tier threshold', () => {
    expect(calculateCustomAmountPricing(349999, 0)).toEqual({
      coinAmount: 349999,
      bonusCoin: 0,
      costBasis: 349999,
    });
  });

  it('applies the matching tier bonus exactly at a threshold', () => {
    expect(calculateCustomAmountPricing(350000, 0)).toEqual({
      coinAmount: 353500,
      bonusCoin: 3500,
      costBasis: 353500,
    });
  });

  it('floors to the lower tier for an amount between two tiers', () => {
    // Rp 512,000 is between the 500k (+5,000) and 550k (+5,500) tiers.
    expect(calculateCustomAmountPricing(512000, 0)).toEqual({
      coinAmount: 517000,
      bonusCoin: 5000,
      costBasis: 517000,
    });
  });

  it('matches the top published tier for Rp 30,000,000', () => {
    expect(calculateCustomAmountPricing(30000000, 0)).toEqual({
      coinAmount: 30600000,
      bonusCoin: 600000,
      costBasis: 30600000,
    });
  });

  it('keeps using the top tier bonus above the highest published amount', () => {
    expect(calculateCustomAmountPricing(50000000, 0)).toEqual({
      coinAmount: 50600000,
      bonusCoin: 600000,
      costBasis: 50600000,
    });
  });

  it('applies an additional configured margin rate on top of the published rate', () => {
    // full value = 25000 (no bonus); 10% cut -> floor(25000 * 0.9) = 22500
    expect(calculateCustomAmountPricing(25000, 10)).toEqual({
      coinAmount: 22500,
      bonusCoin: 0,
      costBasis: 22500,
    });
  });

  it('reports bonusCoin as the raw published tier amount, unaffected by an additional margin cut', () => {
    // full value = 353500 (350000 + 3500 bonus); 10% cut -> floor(353500*0.9) = 318150
    expect(calculateCustomAmountPricing(350000, 10)).toEqual({
      coinAmount: 318150,
      bonusCoin: 3500,
      costBasis: 318150,
    });
  });
});
