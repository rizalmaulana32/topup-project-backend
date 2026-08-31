import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
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
 * code 0 and the exact documented field names on the first try - but only
 * once merchantId was sent as a JSON number, not a string. Deploying this
 * for real surfaced a gap the throwaway test scripts missed: env vars are
 * always strings, and MomoLive's server 500s on a JSON body with
 * "merchant_id":"1000007" (quoted) even though the signature (built from
 * the same string representation either way) still matches - it never gets
 * that far, since their backend fails to deserialize the field before
 * checking the signature. Fixed by storing merchantId as a number.
 *
 * Second real bug found in production use (2026-08-31, reported by the FE
 * dev as "api ne eror ... teko third party"): a normal MomoLive business
 * rejection (e.g. "user not found" for a customer-typed game ID, or an
 * invalid non-numeric ID) was thrown as BadGatewayException (502) - the
 * same class used for genuine MomoLive outages. This mischaracterized
 * routine bad input as an infrastructure failure, and Cloudflare hides
 * the real message behind its own generic error page for any 5xx from
 * the origin, so it looked like the whole backend was down. Fixed by
 * using BadRequestException (400) for MomoLive's own "code": 400
 * business rejections and for client-side ID validation, reserving
 * BadGatewayException for actual `!response.ok` transport failures.
 *
 * MomoLive is a single platform with no game_code/zone concept, so
 * checkId's gameCode/targetZoneId parameters (kept for ProviderTopUpPort's
 * generic multi-provider shape) are accepted but unused here.
 */
@Injectable()
export class MomoProviderTopUpService implements ProviderTopUpPort {
  private readonly merchantId: number;
  private readonly apiSecret: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.merchantId = Number(
      this.configService.getOrThrow<string>('MOMO_MERCHANT_ID'),
    );
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
   * Queries the merchant's own remaining coin balance, exposed via
   * GET /admin/provider/balance - injectCoin will start failing from
   * Momo's side once this runs out.
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
      // Per the doc, MomoLive labels every business-level rejection
      // (wrong user_id, insufficient balance, etc.) as "code": 400 - this
      // is a normal client-input problem (e.g. a customer typed a wrong
      // game ID), not an infrastructure failure, so it must not be a 502.
      // A 502 here previously (a) misrepresented a routine "user not
      // found" as if MomoLive itself were down, and (b) got hidden behind
      // Cloudflare's own generic error page instead of this real message,
      // since Cloudflare intercepts 5xx responses from the origin.
      throw new BadRequestException(
        `MomoLive rejected the request: ${body.message} (code ${body.code})`,
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
 * is what JSON.stringify(NaN) produces) for a non-numeric target ID. A
 * non-numeric ID is client input, not a MomoLive-side problem, so this is
 * a BadRequestException, not BadGatewayException.
 */
function toMomoUserId(targetUserId: string): number {
  const numeric = Number(targetUserId);
  if (!Number.isInteger(numeric)) {
    throw new BadRequestException(
      `Invalid target user ID for MomoLive (must be numeric): "${targetUserId}"`,
    );
  }
  return numeric;
}
