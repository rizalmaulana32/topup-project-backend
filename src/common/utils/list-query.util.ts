import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * date_from/date_to (YYYY-MM-DD, inclusive) as Asia/Jakarta calendar days.
 * The columns are TIMESTAMP without zone written by now() in the session's
 * TimeZone, so Jakarta midnight is converted back into that zone - correct
 * whatever TimeZone the DB server runs in.
 */
export function whereJakartaDate(
  qb: SelectQueryBuilder<ObjectLiteral>,
  column: string,
  dateFrom?: string,
  dateTo?: string,
): void {
  const jakartaMidnight = (param: string, plusDays: number) =>
    `((CAST(:${param} AS date) + ${plusDays})::timestamp AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE current_setting('TimeZone')`;
  if (dateFrom) {
    qb.andWhere(`${column} >= ${jakartaMidnight('jakartaDateFrom', 0)}`, {
      jakartaDateFrom: dateFrom,
    });
  }
  if (dateTo) {
    qb.andWhere(`${column} < ${jakartaMidnight('jakartaDateTo', 1)}`, {
      jakartaDateTo: dateTo,
    });
  }
}

/**
 * Row counts per tab for the list's badges: `all` plus one per group, each
 * group summing the stored values it covers. Pass the query with every
 * filter except status applied, before ordering/limit.
 */
export async function countByGroups<G extends string>(
  qb: SelectQueryBuilder<ObjectLiteral>,
  column: string,
  groups: Record<G, readonly string[]>,
): Promise<Record<G | 'all', number>> {
  const rows = await qb
    .clone()
    .select(column, 'value')
    .addSelect('COUNT(*)', 'count')
    .groupBy(column)
    .getRawMany<{ value: string; count: string }>();
  const byValue = new Map(rows.map((r) => [r.value, Number(r.count)]));
  const counts = {
    all: [...byValue.values()].reduce((a, b) => a + b, 0),
  } as Record<G | 'all', number>;
  for (const group of Object.keys(groups) as G[]) {
    counts[group] = groups[group].reduce(
      (n, value) => n + (byValue.get(value) ?? 0),
      0,
    );
  }
  return counts;
}
