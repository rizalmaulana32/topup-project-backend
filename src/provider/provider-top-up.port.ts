export const PROVIDER_TOP_UP_PORT = Symbol('PROVIDER_TOP_UP_PORT');

export interface CheckIdResult {
  username: string;
}

export interface InjectCoinParams {
  productProviderCode: string;
  targetUserId: string;
  targetZoneId?: string | null;
  coin: number;
}

export interface InjectCoinResult {
  success: boolean;
  response: string;
}

/**
 * Swappable boundary for the Provider Top-Up vendor. The real vendor is
 * MomoLive (dev-doc/API Terbuka Pedagang Koin MomoLive(1).md) - bound via
 * MomoProviderTopUpService in production, with MockProviderTopUpService
 * available for local dev/testing without real credentials. MomoLive's
 * real API has no game_code/zone concept (it's a single platform, not a
 * multi-game abstraction) - a real implementation just ignores those two
 * params rather than the interface needing to drop them.
 */
export interface ProviderTopUpPort {
  checkId(
    gameCode: string,
    targetUserId: string,
    targetZoneId?: string | null,
  ): Promise<CheckIdResult>;

  injectCoin(params: InjectCoinParams): Promise<InjectCoinResult>;
}
