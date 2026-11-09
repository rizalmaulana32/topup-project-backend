/**
 * Adjustable-amount top-up pricing: coin = amount at a flat 1:1 ratio
 * (client's published poster, 2026-10-05), plus a percentage bonus from
 * the superadmin-managed bonus_tiers table (replaced the poster's
 * hardcoded floor-to-lower-tier table 2026-11-09). A tier covers
 * min_amount <= amount < max_amount (max_amount NULL = no upper bound).
 */
export const MIN_CUSTOM_AMOUNT_RUPIAH = 10000;

/**
 * Extra coin on every custom-amount top-up, per mille (‰) of the amount
 * paid, on top of the tier bonus (client request 2026-11-03:
 * "koin yang akan dikirim ditambahkan 0.7% dari transaksi"). It compensates
 * the customer for the LinkQu admin fee in coin - the amount charged
 * through LinkQu stays exactly the typed nominal. Floored to a whole coin.
 * Switched off by default since 2026-11-05 (client via Ricky: "ekstra
 * disable dulu") - see PlatformSettings.customAmountExtraCoinEnabled.
 */
export const CUSTOM_AMOUNT_EXTRA_COIN_PER_MILLE = 7; // 0.7%

export interface BonusTierRange {
  minAmount: number;
  maxAmount: number | null;
  bonusPercent: number;
  isActive: boolean;
}

export interface CustomAmountPricing {
  coinAmount: number;
  bonusCoin: number;
  /** The 0.7% extra (CUSTOM_AMOUNT_EXTRA_COIN_PER_MILLE, pre-cut), already included in coinAmount. */
  extraCoin: number;
  costBasis: number;
}

export function bonusForAmount(
  amount: number,
  tiers: BonusTierRange[],
): number {
  const tier = tiers.find(
    (t) =>
      t.isActive && t.minAmount <= amount && amount < (t.maxAmount ?? Infinity),
  );
  if (!tier) return 0;
  // Percent in hundredths keeps this integer math - 1.15 as a float times
  // an amount can land a hair under the true value and floor away a coin
  // (same issue as the 0.7% extra below).
  return Math.floor((amount * Math.round(tier.bonusPercent * 100)) / 10000);
}

/**
 * marginRatePercent is an optional additional platform cut layered on top
 * of the published 1:1 + bonus rate - defaults to 0 (i.e. exactly matches
 * the poster) and is configurable via PlatformSettings.customAmountMarginRate
 * so the business can introduce a cut later without a redeploy.
 *
 * bonusCoin is the raw tier bonus (pre-cut), returned separately
 * so the frontend can display base/bonus like the poster (coin: X, bonus:
 * Y) without recalculating anything itself - coinAmount is still the one
 * true final payout (base + bonus, minus any configured cut) and is what
 * actually gets injected.
 *
 * costBasis is the rupiah-equivalent value of the coin actually delivered
 * (at face value, coin:rupiah = 1:1) - stands in for product.basePrice so
 * the existing platform-revenue formula (gross - cost - commission - fee)
 * correctly shows a loss on the bonus (no built-in margin) unless/until
 * marginRatePercent is set above 0.
 */
export function calculateCustomAmountPricing(
  amount: number,
  tiers: BonusTierRange[],
  marginRatePercent: number,
  extraCoinEnabled = true,
): CustomAmountPricing {
  const bonusCoin = bonusForAmount(amount, tiers);
  // Per mille keeps this integer math - 0.7 as a float makes e.g.
  // 350000 * 0.007 land a hair under 2450 and floor away a coin.
  const extraCoin = extraCoinEnabled
    ? Math.floor((amount * CUSTOM_AMOUNT_EXTRA_COIN_PER_MILLE) / 1000)
    : 0;
  const fullValueCoin = amount + bonusCoin + extraCoin;
  const coinAmount = Math.floor(fullValueCoin * (1 - marginRatePercent / 100));
  const costBasis = coinAmount;

  return { coinAmount, bonusCoin, extraCoin, costBasis };
}
