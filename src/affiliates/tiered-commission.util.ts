/**
 * Opt-in tiered commission (Ricky/client request, 2026-10-31, via WhatsApp):
 * below Rp 10,000,000 of an affiliate's referred volume in a calendar
 * month, they earn 1%; once the month's cumulative volume crosses that
 * threshold, that transaction and the rest of the month earn 5%. Not
 * retroactive - transactions already credited earlier in the month keep
 * whatever rate they were credited at (confirmed 2026-10-31).
 */
export const TIERED_COMMISSION_THRESHOLD = 10000000;
export const TIERED_COMMISSION_LOW_RATE = 1;
export const TIERED_COMMISSION_HIGH_RATE = 5;

/**
 * periodVolumeIncludingThisTransaction is the affiliate's running total for
 * the month INCLUDING the transaction being priced right now - the
 * transaction that itself pushes the total past the threshold earns the
 * high rate, not just ones strictly after it.
 */
export function calculateTieredCommissionRate(
  periodVolumeIncludingThisTransaction: number,
): number {
  return periodVolumeIncludingThisTransaction >= TIERED_COMMISSION_THRESHOLD
    ? TIERED_COMMISSION_HIGH_RATE
    : TIERED_COMMISSION_LOW_RATE;
}

/** 'YYYY-MM' in UTC, matching how currentPeriodMonth is stored/compared. */
export function currentPeriodKey(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Payout periods of a 'YYYY-MM' month: periode 1 = 1-15, periode 2 = 16-last day (YYYY-MM-DD, inclusive). */
export function monthPayoutPeriods(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    period_1: { date_from: `${month}-01`, date_to: `${month}-15` },
    period_2: { date_from: `${month}-16`, date_to: `${month}-${lastDay}` },
  };
}
