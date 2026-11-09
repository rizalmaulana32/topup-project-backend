import { SuperAffiliateThresholdMode } from './entities/super-affiliate-profile.entity';

/**
 * Whether a downline transaction earns the super affiliate commission.
 * monthVolumeIncludingThis is the month's paid volume (all downline, or just
 * the source affiliate, depending on mode) INCLUDING this transaction - so
 * the transaction that crosses the threshold earns, earlier ones that month
 * don't (not retroactive, same as the affiliate tiered commission).
 */
export function qualifiesForSuperAffiliateCommission(params: {
  mode: SuperAffiliateThresholdMode;
  thresholdAmount: number;
  grossAmount: number;
  monthVolumeIncludingThis: number;
}): boolean {
  const amount =
    params.mode === SuperAffiliateThresholdMode.PER_TRANSACTION
      ? params.grossAmount
      : params.monthVolumeIncludingThis;
  return amount >= params.thresholdAmount;
}

/** commission_rate% of the full gross amount - no bonus-coin deduction. */
export function superAffiliateCommission(
  grossAmount: number,
  ratePercent: number,
): string {
  return ((grossAmount * ratePercent) / 100).toFixed(2);
}

/** [start, end) in UTC of a 'YYYY-MM' period key (see currentPeriodKey). */
export function periodRange(periodKey: string): { start: Date; end: Date } {
  const [year, month] = periodKey.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}
