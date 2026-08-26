import { Injectable } from '@nestjs/common';
import {
  CheckIdResult,
  InjectCoinParams,
  InjectCoinResult,
  ProviderTopUpPort,
} from './provider-top-up.port';

/**
 * Deterministic stand-in for the real Provider Top-Up vendor (MomoLive —
 * see MomoProviderTopUpService). Any non-empty target ID resolves
 * successfully; injectCoin always succeeds; getBalance returns a fixed
 * fake number. Used whenever PROVIDER_TOP_UP_VENDOR isn't set to "momo".
 */
@Injectable()
export class MockProviderTopUpService implements ProviderTopUpPort {
  checkId(
    gameCode: string,
    targetUserId: string,
    targetZoneId?: string | null,
  ): Promise<CheckIdResult> {
    if (!targetUserId || targetUserId.trim().length === 0) {
      return Promise.reject(new Error('targetUserId is required'));
    }

    const zoneSuffix = targetZoneId ? `#${targetZoneId}` : '';
    return Promise.resolve({
      username: `Player_${targetUserId}${zoneSuffix}`,
    });
  }

  injectCoin(params: InjectCoinParams): Promise<InjectCoinResult> {
    return Promise.resolve({
      success: true,
      response: JSON.stringify({
        mock: true,
        providerCode: params.productProviderCode,
        targetUserId: params.targetUserId,
        targetZoneId: params.targetZoneId ?? null,
        coin: params.coin,
        injectedAt: new Date().toISOString(),
      }),
    });
  }

  getBalance(): Promise<number> {
    return Promise.resolve(999999999);
  }
}
