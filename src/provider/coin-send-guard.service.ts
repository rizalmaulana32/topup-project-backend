import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, MoreThan, Not, Repository } from 'typeorm';
import { CoinSend } from './entities/coin-send.entity';
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
      await this.coinSendRepository.update(logId, { status: 'unknown' });
      throw error;
    }
    await this.coinSendRepository.update(logId, {
      status: result.success
        ? 'success'
        : result.rejected
          ? 'rejected'
          : 'unknown',
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
