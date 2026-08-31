export const PROVIDER_TOP_UP_PORT = Symbol('PROVIDER_TOP_UP_PORT');

export interface CheckIdResult {
  username: string;
  avatarUrl: string | null;
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

  /**
   * The merchant's own remaining coin balance with the provider - not
   * customer-facing, exposed only via the superadmin monitoring endpoint
   * (GET /admin/provider/balance) so injectCoin failures caused by running
   * out of balance on the provider's side can be caught before they pile up.
   */
  getBalance(): Promise<number>;
}
