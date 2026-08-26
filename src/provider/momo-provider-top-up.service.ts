import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  CheckIdResult,
  InjectCoinParams,
  InjectCoinResult,
  ProviderTopUpPort,
} from './provider-top-up.port';

interface MomoResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

/**
 * Real implementation of ProviderTopUpPort for MomoLive's coin merchant API
 * (dev-doc/API Terbuka Pedagang Koin MomoLive(1).md). Real-verified against
 * the sandbox on 2026-08-26 with the test credentials from that doc:
 * query-user, balance, and transfer-coin all returned real HTTP 200s with
 * code 0 and the exact documented field names on the first try.
 *
 * MomoLive is a single platform with no game_code/zone concept, so
 * checkId's gameCode/targetZoneId parameters (kept for ProviderTopUpPort's
 * generic multi-provider shape) are accepted but unused here.
 */
@Injectable()
export class MomoProviderTopUpService implements ProviderTopUpPort {
  private readonly merchantId: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.merchantId = this.configService.getOrThrow<string>('MOMO_MERCHANT_ID');
    this.apiSecret = this.configService.getOrThrow<string>('MOMO_API_SECRET');
    this.baseUrl = this.configService.get<string>(
      'MOMO_BASE_URL',
      'https://proxytest.momoindo.com',
    );
  }

  // gameCode/targetZoneId are part of ProviderTopUpPort's generic shape but
  // unused here - MomoLive has no game_code/zone concept (see class doc).
  // TypeScript allows implementing an interface method with fewer
  // parameters than it declares, so they're simply omitted rather than
  // kept as unused named args.
  async checkId(
    _gameCode: string,
    targetUserId: string,
  ): Promise<CheckIdResult> {
    const result = await this.call<{
      user_id: number;
      nick_name: string;
      avatar: string;
    }>('/openapi/v1/query-user', {
      merchant_id: this.merchantId,
      timestamp: currentTimestamp(),
      user_id: toMomoUserId(targetUserId),
    });

    return { username: result.nick_name };
  }

  async injectCoin(params: InjectCoinParams): Promise<InjectCoinResult> {
    try {
      const result = await this.call<{ surplus_coin: number }>(
        '/openapi/v1/transfer-coin',
        {
          merchant_id: this.merchantId,
          timestamp: currentTimestamp(),
          user_id: toMomoUserId(params.targetUserId),
          coin: params.coin,
        },
      );

      return {
        success: true,
        response: JSON.stringify(result),
      };
    } catch (error) {
      return {
        success: false,
        response:
          error instanceof Error ? error.message : 'Unknown provider error',
      };
    }
  }

  /**
   * Queries the merchant's own remaining coin balance. Not part of
   * ProviderTopUpPort (no calling code needs it yet), but useful for a
   * future admin monitoring endpoint - injectCoin will start failing
   * silently from Momo's side once this runs out.
   */
  async getBalance(): Promise<number> {
    const result = await this.call<{ balance: number }>('/openapi/v1/balance', {
      merchant_id: this.merchantId,
      timestamp: currentTimestamp(),
    });
    return result.balance;
  }

  private async call<T>(
    path: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const signedParams = {
      ...params,
      sign: signMomoParams(params, this.apiSecret),
    };

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedParams),
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `MomoLive ${path} request failed: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as MomoResponse<T>;

    if (body.code !== 0 || body.data === null) {
      throw new BadGatewayException(
        `MomoLive ${path} failed: ${body.message} (code ${body.code})`,
      );
    }

    return body.data;
  }
}

function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * SHA-256 of the request params (excluding "sign") sorted alphabetically by
 * key as "key1=value1&key2=value2", with apiSecret appended directly with
 * no separator - per dev-doc/API Terbuka Pedagang Koin MomoLive(1).md.
 * Real-verified against the sandbox API on 2026-08-26.
 */
export function signMomoParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const signString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha256')
    .update(signString + apiSecret)
    .digest('hex');
}

/**
 * MomoLive's user_id is documented as int64, not a string - convert
 * explicitly and fail clearly rather than silently sending `null` (which
 * is what JSON.stringify(NaN) produces) for a non-numeric target ID.
 */
function toMomoUserId(targetUserId: string): number {
  const numeric = Number(targetUserId);
  if (!Number.isInteger(numeric)) {
    throw new BadGatewayException(
      `Invalid target user ID for MomoLive (must be numeric): "${targetUserId}"`,
    );
  }
  return numeric;
}
