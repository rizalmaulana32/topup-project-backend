import { filterHistory } from './history-filter.util';

describe('filterHistory', () => {
  const items = [
    // 2026-11-16 23:30 WIB, a Monday in Jakarta (still Monday in UTC too).
    {
      id: 'TRX-1',
      username: 'Budi',
      payment_status: 'paid',
      source: 'gateway',
      gross_amount: '100000.00',
      created_at: new Date('2026-11-16T16:30:00Z'),
    },
    // 2026-11-17 00:30 WIB = Tuesday in Jakarta but still Monday in UTC.
    {
      id: 'M-1#5',
      username: null,
      payment_status: 'paid',
      source: 'manual',
      gross_amount: '50000.00',
      created_at: new Date('2026-11-16T17:30:00Z'),
    },
    {
      id: 'TRX-2',
      username: 'Sari',
      payment_status: 'failed',
      source: 'gateway',
      gross_amount: '20000.00',
      created_at: new Date('2026-11-09T03:00:00Z'),
    },
  ];
  const run = (filter: Record<string, unknown>) =>
    filterHistory(
      items,
      { limit: 20, offset: 0, ...filter },
      (t) => t.gross_amount,
      (t) => [t.id, t.username],
    );
  const ids = (filter: Record<string, unknown>) =>
    run(filter).items.map((t) => t.id);

  it('groups status: anything not paid/pending counts as expired', () => {
    expect(ids({ status: 'paid' })).toEqual(['TRX-1', 'M-1#5']);
    expect(ids({ status: 'expired' })).toEqual(['TRX-2']);
  });

  it('uses Jakarta calendar days for dates and weekday', () => {
    expect(ids({ dateFrom: '2026-11-17' })).toEqual(['M-1#5']);
    expect(ids({ dateTo: '2026-11-16' })).toEqual(['TRX-1', 'TRX-2']);
    expect(ids({ weekday: 2 })).toEqual(['M-1#5']);
  });

  it('searches case-insensitively, filters source and amount, pages after filtering', () => {
    expect(ids({ search: 'bUd' })).toEqual(['TRX-1']);
    expect(ids({ source: 'manual' })).toEqual(['M-1#5']);
    expect(ids({ amountMin: 50000, amountMax: 99999 })).toEqual(['M-1#5']);
    const page = run({ status: 'paid', limit: 1, offset: 1 });
    expect(page.items.map((t) => t.id)).toEqual(['M-1#5']);
    expect(page.total).toBe(2);
  });
});
