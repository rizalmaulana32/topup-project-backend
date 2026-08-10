export const PROVIDER_TOP_UP_PORT = Symbol('PROVIDER_TOP_UP_PORT');

export interface CheckIdResult {
  username: string;
}

export interface InjectCoinParams {
  productProviderCode: string;
  targetUserId: string;
  targetZoneId?: string | null;
}

export interface InjectCoinResult {
  success: boolean;
  response: string;
}

/**
 * Swappable boundary for the Provider Top-Up vendor. The real vendor is not
 * yet chosen (dev-doc/topup-affiliate-platform/project-charter.md), so
 * MockProviderTopUpService is bound to this token for now. A future slice
 * can bind a real implementation without touching any calling code.
 */
export interface ProviderTopUpPort {
  checkId(
    gameCode: string,
    targetUserId: string,
    targetZoneId?: string | null,
  ): Promise<CheckIdResult>;

  injectCoin(params: InjectCoinParams): Promise<InjectCoinResult>;
}
