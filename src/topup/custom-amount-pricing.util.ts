/**
 * Adjustable-amount top-up pricing, corrected 2026-10-05 against the
 * client's real, already-published pricing poster ("YAY AGENCY - TOPUP
 * RESMI KOIN MOMO LIVE"): coin = amount at a flat 1:1 ratio (NOT the
 * earlier-assumed 100-coin-per-10000-rupiah/10% cut guess), plus a bonus
 * tier for larger amounts, taken straight from the poster. An amount that
 * falls between two tiers floors to the lower tier (confirmed with the
 * client 2026-10-05) - e.g. Rp 512,000 gets the Rp 500,000 tier's bonus.
 * Amounts above the highest published tier (Rp 30,000,000) keep using
 * that tier's bonus, since the poster doesn't go higher - revisit if the
 * client publishes a higher tier.
 */
export const MIN_CUSTOM_AMOUNT_RUPIAH = 10000;

/**
 * Extra coin on every custom-amount top-up, per mille (‰) of the amount
 * paid, on top of the poster's tier bonus (client request 2026-11-03:
 * "koin yang akan dikirim ditambahkan 0.7% dari transaksi"). It compensates
 * the customer for the LinkQu admin fee in coin - the amount charged
 * through LinkQu stays exactly the typed nominal. Floored to a whole coin.
 * Switched off by default since 2026-11-05 (client via Ricky: "ekstra
 * disable dulu") - see PlatformSettings.customAmountExtraCoinEnabled.
 */
export const CUSTOM_AMOUNT_EXTRA_COIN_PER_MILLE = 7; // 0.7%

const BONUS_TIERS: { threshold: number; bonus: number }[] = [
  { threshold: 30000000, bonus: 600000 },
  { threshold: 20000000, bonus: 400000 },
  { threshold: 10000000, bonus: 200000 },
  { threshold: 7000000, bonus: 140000 },
  { threshold: 5000000, bonus: 100000 },
  { threshold: 3000000, bonus: 60000 },
  { threshold: 2000000, bonus: 40000 },
  { threshold: 1000000, bonus: 20000 },
  { threshold: 800000, bonus: 8000 },
  { threshold: 700000, bonus: 7000 },
  { threshold: 650000, bonus: 6500 },
  { threshold: 600000, bonus: 6000 },
  { threshold: 550000, bonus: 5500 },
  { threshold: 500000, bonus: 5000 },
  { threshold: 450000, bonus: 4500 },
  { threshold: 400000, bonus: 4000 },
  { threshold: 350000, bonus: 3500 },
];

export interface CustomAmountPricing {
  coinAmount: number;
  bonusCoin: number;
  /** The 0.7% extra (CUSTOM_AMOUNT_EXTRA_COIN_PER_MILLE, pre-cut), already included in coinAmount. */
  extraCoin: number;
  costBasis: number;
}

export function bonusForAmount(amount: number): number {
  const tier = BONUS_TIERS.find((t) => amount >= t.threshold);
  return tier?.bonus ?? 0;
}

/**
 * marginRatePercent is an optional additional platform cut layered on top
 * of the published 1:1 + bonus rate - defaults to 0 (i.e. exactly matches
 * the poster) and is configurable via PlatformSettings.customAmountMarginRate
 * so the business can introduce a cut later without a redeploy.
 *
 * bonusCoin is the raw published-tier bonus (pre-cut), returned separately
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
  marginRatePercent: number,
  extraCoinEnabled = true,
): CustomAmountPricing {
  const bonusCoin = bonusForAmount(amount);
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
