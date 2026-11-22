import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  EntityManager,
  In,
  LessThan,
  MoreThan,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import {
  CoinSend,
  CoinSendStatus,
  MANUAL_COIN_SEND_SOURCES,
} from './entities/coin-send.entity';
import type {
  InjectCoinParams,
  InjectCoinResult,
  ProviderTopUpPort,
} from './provider-top-up.port';

/**
 * Same target ID + same coin amount within this window is treated as a
 * duplicate send (client request 2026-11-15: "setiap transaksi id dan
 * nominal yang sama beri jeda 2 menit"). Real repeat buyers on prod were
 * seen 4+ minutes apart; double-click checkouts 3-69s apart.
 */
export const DUPLICATE_SEND_WINDOW_MINUTES = 2;

/**
 * Wraps the real provider so every injectCoin, from every flow (checkout,
 * manual top-up, admin transfer, withdrawal), refuses to send the same coin
 * amount to the same ID twice within DUPLICATE_SEND_WINDOW_MINUTES.
 * Rejected sends don't count (nothing went out); pending/unknown do.
 */
@Injectable()
export class CoinSendGuard {
  constructor(
    @InjectRepository(CoinSend)
    private readonly coinSendRepository: Repository<CoinSend>,
    private readonly dataSource: DataSource,
  ) {}

  /** Non-locking pre-check, e.g. before a customer pays. */
  hasRecentSend(targetUserId: string, coin: number): Promise<boolean> {
    return this.recentSendExists(
      this.coinSendRepository.manager,
      targetUserId,
      coin,
    );
  }

  /** Newest first; channel splits LinkQu checkouts from manual sends. */
  list(filter: {
    channel?: 'linkqu' | 'manual';
    status?: CoinSendStatus;
    /** Inclusive YYYY-MM-DD, Asia/Jakarta. */
    range?: { dateFrom: string; dateTo: string };
    limit: number;
    offset: number;
  }): Promise<[CoinSend[], number]> {
    // WIB is a fixed UTC+7 (no DST), so midnight is a plain offset.
    const midnight = (date: string, plusDays = 0) =>
      new Date(Date.parse(`${date}T00:00:00+07:00`) + plusDays * 86_400_000);
    return this.coinSendRepository.findAndCount({
      where: {
        ...(filter.range && {
          createdAt: And(
            MoreThanOrEqual(midnight(filter.range.dateFrom)),
            LessThan(midnight(filter.range.dateTo, 1)),
          ),
        }),
        ...(filter.channel && {
          source:
            filter.channel === 'manual'
              ? In(MANUAL_COIN_SEND_SOURCES)
              : Not(In(MANUAL_COIN_SEND_SOURCES)),
        }),
        ...(filter.status && { status: filter.status }),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: filter.limit,
      skip: filter.offset,
    });
  }

  /**
   * Successful sends per Jakarta hour (one-day range) or day, every bucket
   * present even when empty. Dates are inclusive YYYY-MM-DD.
   */
  async successChart(dateFrom: string, dateTo: string) {
    const bucket = dateFrom === dateTo ? 'hour' : 'day';
    const rows: {
      bucket: string;
      linkqu_coin: string;
      linkqu_count: string;
      manual_coin: string;
      manual_count: string;
    }[] = await this.dataSource.query(
      `SELECT to_char(g.b, $4) AS bucket,
         COALESCE(SUM(s.coin) FILTER (WHERE s.source <> ALL($5)), 0) AS linkqu_coin,
         COUNT(s.id) FILTER (WHERE s.source <> ALL($5)) AS linkqu_count,
         COALESCE(SUM(s.coin) FILTER (WHERE s.source = ANY($5)), 0) AS manual_coin,
         COUNT(s.id) FILTER (WHERE s.source = ANY($5)) AS manual_count
       FROM generate_series($1::date::timestamp,
              $2::date::timestamp + interval '1 day' - $3::interval,
              $3::interval) AS g(b)
       LEFT JOIN coin_sends s
         ON s.status = 'success'
        AND s.created_at >= g.b AT TIME ZONE 'Asia/Jakarta'
        AND s.created_at < (g.b + $3::interval) AT TIME ZONE 'Asia/Jakarta'
       GROUP BY g.b
       ORDER BY g.b`,
      [
        dateFrom,
        dateTo,
        `1 ${bucket}`,
        bucket === 'hour' ? 'YYYY-MM-DD"T"HH24:00' : 'YYYY-MM-DD',
        MANUAL_COIN_SEND_SOURCES,
      ],
    );
    const points = rows.map((row) => ({
      bucket: row.bucket,
      linkqu_coin: Number(row.linkqu_coin),
      linkqu_count: Number(row.linkqu_count),
      manual_coin: Number(row.manual_coin),
      manual_count: Number(row.manual_count),
    }));
    const sum = (key: Exclude<keyof (typeof points)[number], 'bucket'>) =>
      points.reduce((total, point) => total + point[key], 0);
    const totals = {
      linkqu_coin: sum('linkqu_coin'),
      linkqu_count: sum('linkqu_count'),
      manual_coin: sum('manual_coin'),
      manual_count: sum('manual_count'),
    };
    return {
      date_from: dateFrom,
      date_to: dateTo,
      bucket,
      totals: {
        ...totals,
        coin: totals.linkqu_coin + totals.manual_coin,
        count: totals.linkqu_count + totals.manual_count,
      },
      points,
    };
  }

  wrap(inner: ProviderTopUpPort): ProviderTopUpPort {
    return {
      checkId: (gameCode, targetUserId, targetZoneId) =>
        inner.checkId(gameCode, targetUserId, targetZoneId),
      getBalance: () => inner.getBalance(),
      injectCoin: (params) => this.injectCoin(inner, params),
    };
  }

  private async injectCoin(
    inner: ProviderTopUpPort,
    params: InjectCoinParams,
  ): Promise<InjectCoinResult> {
    // Check + record under a per-ID lock, so two concurrent requests
    // (double click, webhook + reconciliation) can't both pass the check.
    const logId = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        params.targetUserId,
      ]);
      if (
        !params.allowRepeat &&
        (await this.recentSendExists(manager, params.targetUserId, params.coin))
      ) {
        return null;
      }
      const row = await manager.save(
        manager.create(CoinSend, {
          targetUserId: params.targetUserId,
          coin: params.coin.toFixed(2),
          status: 'pending',
          source: params.productProviderCode,
          refId: params.refId ?? null,
          adminId: params.adminId ?? null,
          reason: params.reason ?? null,
        }),
      );
      return row.id;
    });

    if (logId === null) {
      return {
        success: false,
        rejected: true,
        duplicate: true,
        response: `Blocked duplicate send: ${params.coin} coin was already sent to ${params.targetUserId} in the last ${DUPLICATE_SEND_WINDOW_MINUTES} minutes`,
      };
    }

    let result: InjectCoinResult;
    try {
      result = await inner.injectCoin(params);
    } catch (error) {
      await this.coinSendRepository.update(logId, {
        status: 'unknown',
        providerResponse:
          error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await this.coinSendRepository.update(logId, {
      status: result.success
        ? 'success'
        : result.rejected
          ? 'rejected'
          : 'unknown',
      providerResponse: result.response,
      balanceAfter:
        result.success && result.balanceAfter != null
          ? result.balanceAfter.toFixed(2)
          : null,
    });
    return result;
  }

  private recentSendExists(
    manager: EntityManager,
    targetUserId: string,
    coin: number,
  ): Promise<boolean> {
    return manager.exists(CoinSend, {
      where: {
        targetUserId,
        coin: coin.toFixed(2),
        status: Not('rejected'),
        createdAt: MoreThan(
          new Date(Date.now() - DUPLICATE_SEND_WINDOW_MINUTES * 60_000),
        ),
      },
    });
  }
}
