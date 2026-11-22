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
  /** Skip the duplicate-send guard - only for later installments of one manual schedule. */
  allowRepeat?: boolean;
  /** Stored as coin_sends.ref_id - see CoinSend.refId. */
  refId?: string;
  /** Audit trail in coin_sends for admin-initiated transfers. */
  adminId?: string;
  reason?: string;
}

export interface InjectCoinResult {
  success: boolean;
  /** true only when the provider definitely refused, i.e. no coins were sent. A failure without it has an unknown outcome. */
  rejected?: boolean;
  /** Blocked by CoinSendGuard (same ID + amount sent recently); implies rejected. */
  duplicate?: boolean;
  response: string;
  /** Merchant's remaining coin balance after a successful send, when the vendor reports it. */
  balanceAfter?: number;
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
