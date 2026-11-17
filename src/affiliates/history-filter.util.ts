/**
 * Server-side filter + page for the affiliate history lists
 * (referred transactions, commission history). They're built in memory
 * (gateway transactions merged with manual sends, usernames from a live
 * MomoLive lookup), so they're filtered in memory too.
 * ponytail: loads and looks up the affiliate's whole history per request,
 * same cost as the detail endpoint; move to SQL + a stored username if an
 * affiliate's history grows into the tens of thousands.
 */
export interface HistoryFilter {
  search?: string;
  /** paid = paid/success/settlement, pending, expired = anything else. */
  status?: 'paid' | 'pending' | 'expired';
  source?: 'gateway' | 'manual';
  type?: string;
  /** YYYY-MM-DD, inclusive, Asia/Jakarta. */
  dateFrom?: string;
  dateTo?: string;
  /** 0 = Sunday, Asia/Jakarta. */
  weekday?: number;
  amountMin?: number;
  amountMax?: number;
  limit: number;
  offset: number;
}

interface HistoryItem {
  created_at: Date;
  payment_status?: string;
  source?: string;
  type?: string;
}

const PAID_STATUSES = ['paid', 'success', 'settlement'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function jakartaDay(date: Date) {
  return {
    date: date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }),
    weekday: WEEKDAYS.indexOf(
      date.toLocaleDateString('en-US', {
        timeZone: 'Asia/Jakarta',
        weekday: 'short',
      }),
    ),
  };
}

function statusGroup(paymentStatus: string) {
  if (PAID_STATUSES.includes(paymentStatus)) return 'paid';
  return paymentStatus === 'pending' ? 'pending' : 'expired';
}

/**
 * amount(item) is the Rupiah value the amount filters use; searchText(item)
 * lists the strings `search` matches against (case-insensitive, partial).
 */
export function filterHistory<T extends HistoryItem>(
  items: T[],
  filter: HistoryFilter,
  amount: (item: T) => string | number,
  searchText: (item: T) => (string | null | undefined)[],
) {
  const search = filter.search?.trim().toLowerCase();
  const matches = items.filter((item) => {
    if (
      filter.status &&
      statusGroup(item.payment_status ?? '') !== filter.status
    ) {
      return false;
    }
    if (filter.source && item.source !== filter.source) return false;
    if (filter.type && item.type !== filter.type) return false;
    const value = Number(amount(item));
    if (filter.amountMin !== undefined && value < filter.amountMin)
      return false;
    if (filter.amountMax !== undefined && value > filter.amountMax)
      return false;
    if (filter.dateFrom || filter.dateTo || filter.weekday !== undefined) {
      const day = jakartaDay(item.created_at);
      if (filter.dateFrom && day.date < filter.dateFrom) return false;
      if (filter.dateTo && day.date > filter.dateTo) return false;
      if (filter.weekday !== undefined && day.weekday !== filter.weekday) {
        return false;
      }
    }
    if (
      search &&
      !searchText(item).some((text) => text?.toLowerCase().includes(search))
    ) {
      return false;
    }
    return true;
  });
  return {
    items: matches.slice(filter.offset, filter.offset + filter.limit),
    total: matches.length,
    limit: filter.limit,
    offset: filter.offset,
  };
}
