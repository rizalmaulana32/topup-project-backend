import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PROVIDER_TOP_UP_PORT } from '../provider/provider-top-up.port';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import {
  CoinSendGuard,
  DUPLICATE_SEND_WINDOW_MINUTES,
} from '../provider/coin-send-guard.service';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { BonusTiersService } from '../bonus-tiers/bonus-tiers.service';
import { PlatformService } from '../platform/platform.service';
import { SettingsService } from '../settings/settings.service';
import type { PlatformSettings } from '../settings/entities/platform-settings.entity';
import { SuperAffiliatesService } from '../super-affiliates/super-affiliates.service';
import { TransactionsService } from '../transactions/transactions.service';
import { LinkQuService } from '../linkqu/linkqu.service';
import { CheckIdDto } from './dto/check-id.dto';
import { CheckoutCustomAmountDto } from './dto/checkout-custom-amount.dto';
import { EstimateCustomAmountDto } from './dto/estimate-custom-amount.dto';
import {
  calculateCustomAmountPricing,
  CUSTOM_AMOUNT_EXTRA_COIN_PER_MILLE,
  MIN_CUSTOM_AMOUNT_RUPIAH,
} from './custom-amount-pricing.util';
import { PaymentStatus } from '../transactions/entities/transaction.entity';

@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    @Inject(PROVIDER_TOP_UP_PORT)
    private readonly provider: ProviderTopUpPort,
    private readonly transactionsService: TransactionsService,
    private readonly linkQuService: LinkQuService,
    private readonly affiliatesService: AffiliatesService,
    private readonly platformService: PlatformService,
    private readonly settingsService: SettingsService,
    private readonly bonusTiersService: BonusTiersService,
    private readonly superAffiliatesService: SuperAffiliatesService,
    private readonly coinSendGuard: CoinSendGuard,
  ) {}

  /**
   * Public check for whether an affiliate/referral code would actually
   * earn commission if used at checkout right now - same criteria
   * creditCommissionForTransaction uses internally (code exists AND the
   * owning affiliate is active). Lets a checkout UI validate/show
   * feedback on a referral code before the customer completes payment.
   */
  async validateAffiliateCode(code: string) {
    const result = await this.affiliatesService.checkCodeValidity(code);
    return { valid: result.valid, affiliate_name: result.affiliateName };
  }

  async getTransactionStatus(transactionId: string) {
    const transaction =
      await this.transactionsService.findByExternalId(transactionId);

    if (!transaction) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    let adminFee: string | null = null;
    if (transaction.linkQuReference) {
      try {
        const status = await this.linkQuService.checkTransactionStatus(
          transaction.id,
        );
        adminFee = status.fee;
      } catch (error) {
        // Fee is supplementary display info, not core to status-checking -
        // degrade gracefully rather than fail the whole lookup if LinkQu's
        // checkstatus call has trouble.
        this.logger.warn(
          `Could not fetch LinkQu fee for ${transactionId}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return {
      transaction_id: transaction.id,
      payment_status: transaction.paymentStatus,
      provider_status: transaction.providerStatus,
      product_name: transaction.product?.name ?? null,
      gross_amount: transaction.grossAmount,
      admin_fee: adminFee,
      created_at: transaction.createdAt,
      paid_at: transaction.paidAt,
      completed_at: transaction.completedAt,
    };
  }

  async checkId(dto: CheckIdDto) {
    const result = await this.provider.checkId(
      dto.game_code,
      dto.user_id,
      dto.zone_id,
    );

    return {
      username: result.username,
      avatar_url: result.avatarUrl,
      user_id: dto.user_id,
      zone_id: dto.zone_id,
    };
  }

  async getPublicConfig() {
    const settings = await this.settingsService.get();
    return {
      extra_coin_enabled: settings.customAmountExtraCoinEnabled,
      extra_coin_percent: CUSTOM_AMOUNT_EXTRA_COIN_PER_MILLE / 10,
      min_custom_amount: MIN_CUSTOM_AMOUNT_RUPIAH,
      manual_qris_enabled: this.isManualQrisShown(settings),
      // ?v= busts browser caches when the image is replaced.
      manual_qris_url: this.isManualQrisShown(settings)
        ? `/api/v1/topup/manual-qris?v=${settings.updatedAt.getTime()}`
        : null,
    };
  }

  private isManualQrisShown(settings: PlatformSettings): boolean {
    return settings.manualQrisEnabled && settings.manualQrisMimeType !== null;
  }

  /** The manual QRIS image, or null when hidden or not uploaded. */
  async getPublicManualQris() {
    const settings = await this.settingsService.get();
    if (!this.isManualQrisShown(settings)) {
      return null;
    }
    return this.settingsService.getManualQris();
  }

  /**
   * Read-only calculator for the checkout form: whichever field the
   * customer typed into - a "Rupiah" field or a "Koin" field - the typed
   * number IS the nominal amount paid (confirmed with the client
   * 2026-10-05: coin and rupiah are the same input, never a target final
   * payout to solve backward for). `coin` is accepted purely as an alias
   * for `amount` so the FE doesn't have to relabel the field it sends;
   * both go through the exact same forward pricing function checkout-custom
   * uses, so the preview can never drift from what actually gets charged.
   */
  async estimateCustomAmount(dto: EstimateCustomAmountDto) {
    if ((dto.amount === undefined) === (dto.coin === undefined)) {
      throw new BadRequestException(
        'Provide exactly one of amount or coin, not both or neither',
      );
    }

    const amount = (dto.amount ?? dto.coin) as number;
    const settings = await this.settingsService.get();
    const pricing = calculateCustomAmountPricing(
      amount,
      await this.bonusTiersService.findAll(),
      Number(settings.customAmountMarginRate),
      settings.customAmountExtraCoinEnabled,
    );

    return {
      amount,
      coin_amount: pricing.coinAmount,
      bonus_coin: pricing.bonusCoin,
      extra_coin: pricing.extraCoin,
    };
  }

  /**
   * Adjustable-amount checkout: customer types a nominal instead of picking
   * a fixed catalog product. See custom-amount-pricing.util.ts for the
   * confirmed coin/margin formula.
   */
  async checkoutCustomAmount(dto: CheckoutCustomAmountDto) {
    const settings = await this.settingsService.get();
    const { coinAmount, bonusCoin, extraCoin, costBasis } =
      calculateCustomAmountPricing(
        dto.amount,
        await this.bonusTiersService.findAll(),
        Number(settings.customAmountMarginRate),
        settings.customAmountExtraCoinEnabled,
      );

    if (coinAmount <= 0) {
      throw new BadRequestException(
        `amount ${dto.amount} is too small to convert to any coin`,
      );
    }

    // Stop the customer before paying - once paid, a duplicate is only held.
    if (
      await this.coinSendGuard.hasRecentSend(dto.target_user_id, coinAmount)
    ) {
      throw new ConflictException(
        `${coinAmount} coin was just sent to ${dto.target_user_id}; try again in ${DUPLICATE_SEND_WINDOW_MINUTES} minutes`,
      );
    }

    const transaction =
      await this.transactionsService.createPendingCustomAmount({
        grossAmount: dto.amount.toFixed(2),
        coinAmount: String(coinAmount),
        costBasis: String(costBasis),
        bonusCoin: String(bonusCoin),
        targetUserId: dto.target_user_id,
        targetZoneId: dto.target_zone_id,
        referralCode: dto.affiliate_code,
      });

    const invoice = await this.linkQuService.createInvoice({
      externalId: transaction.id,
      amount: dto.amount,
      description: `Top-up ${coinAmount} coin for ${dto.target_user_id}`,
    });

    await this.transactionsService.attachLinkQuReference(
      transaction.id,
      invoice.invoiceId,
    );

    return {
      transaction_id: transaction.id,
      coin_amount: coinAmount,
      bonus_coin: bonusCoin,
      extra_coin: extraCoin,
      linkqu_reference: invoice.invoiceId,
      invoice_url: invoice.invoiceUrl,
    };
  }

  /**
   * Called by the LinkQu payment callback controller after the callback
   * signature has already been verified.
   */
  async handleInvoicePaid(externalId: string): Promise<void> {
    const transaction =
      await this.transactionsService.findByExternalId(externalId);

    if (!transaction) {
      throw new NotFoundException(
        `Transaction ${externalId} not found for LinkQu callback`,
      );
    }

    const transitioned = await this.transactionsService.markPaid(
      transaction.id,
    );
    if (!transitioned) {
      this.logger.warn(
        `Duplicate paid callback for ${externalId}, ignoring (idempotent).`,
      );
      return;
    }

    // Fixed-catalog products were removed 2026-11-09 (custom amount +
    // bonus_tiers only); the product branch stays so a product transaction
    // still pending at deploy time completes correctly.
    let coin: number;
    // The bonus coin the customer gets on top of the nominal - charged to
    // the referring affiliate's commission (client via Ricky 2026-11-05).
    let bonusCoin: number;
    let costBasis: string;
    let providerProductCode: string;
    if (transaction.product) {
      coin =
        Number(transaction.product.coinAmount) +
        Number(transaction.product.bonusCoin);
      bonusCoin = Number(transaction.product.bonusCoin);
      costBasis = transaction.product.basePrice;
      providerProductCode = transaction.product.providerCode;
    } else if (transaction.coinAmount && transaction.costBasis) {
      coin = Number(transaction.coinAmount);
      // Snapshotted at checkout, not recomputed: tiers may have changed since.
      bonusCoin = Number(transaction.bonusCoin ?? 0);
      costBasis = transaction.costBasis;
      providerProductCode = 'custom-amount';
    } else {
      throw new BadRequestException(
        `Transaction ${externalId} has neither a linked product nor custom-amount pricing; cannot inject coin`,
      );
    }

    const injectResult = await this.provider.injectCoin({
      productProviderCode: providerProductCode,
      targetUserId: transaction.targetUserId,
      targetZoneId: transaction.targetZoneId,
      coin,
    });

    await this.transactionsService.markProviderResult(transaction.id, {
      success: injectResult.success,
      response: injectResult.response,
    });

    if (injectResult.duplicate) {
      this.logger.error(
        `Transaction ${transaction.id} is paid but its coin send was held as a duplicate - check MomoLive before sending manually: ${injectResult.response}`,
      );
    }

    if (injectResult.success) {
      const affiliateCommission = transaction.referralCode
        ? await this.affiliatesService.creditCommissionForTransaction({
            referralCode: transaction.referralCode,
            transactionId: transaction.id,
            originalAmount: transaction.grossAmount,
            bonusDeduction: bonusCoin.toFixed(2),
          })
        : '0.00';
      // The affiliate's super affiliate (if any) is paid by the platform on
      // top of - never out of - the affiliate's commission.
      const superAffiliateCommission = transaction.referralCode
        ? await this.superAffiliatesService.creditCommissionForTransaction({
            referralCode: transaction.referralCode,
            transactionId: transaction.id,
            grossAmount: transaction.grossAmount,
          })
        : '0.00';
      const commissionPaid = (
        Number(affiliateCommission) + Number(superAffiliateCommission)
      ).toFixed(2);

      let linkQuFee = '0.00';
      try {
        const status = await this.linkQuService.checkTransactionStatus(
          transaction.id,
        );
        linkQuFee = status.fee ?? '0.00';
        await this.transactionsService.setProviderFee(
          transaction.id,
          linkQuFee,
        );
      } catch (error) {
        // The platform revenue credit is best-effort on the fee - a failed
        // lookup must not block a coin injection that already succeeded.
        // Falling back to 0 understates the real LinkQu cost for this one
        // transaction (better than blocking the webhook), and is logged
        // loudly so it's not silently wrong.
        this.logger.warn(
          `Could not fetch LinkQu fee for platform revenue credit on ${transaction.id}, crediting with fee=0: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }

      await this.platformService.creditRevenueForTransaction({
        transactionId: transaction.id,
        grossAmount: transaction.grossAmount,
        baseCost: costBasis,
        commissionPaid,
        providerFee: linkQuFee,
      });
    }
  }

  /**
   * Marks a transaction expired. Reachability from a real LinkQu callback
   * is unconfirmed this session (no real Payment Link transaction was run
   * end-to-end) - kept as a real, tested method so a future reconciliation
   * job (polling checkTransactionStatus for old pending transactions) has
   * somewhere to call into either way. A transaction that already paid
   * must never be downgraded back to expired.
   */
  async handleInvoiceExpired(externalId: string): Promise<void> {
    const transaction =
      await this.transactionsService.findByExternalId(externalId);

    if (!transaction) {
      throw new NotFoundException(
        `Transaction ${externalId} not found for LinkQu callback`,
      );
    }

    if (transaction.paymentStatus !== PaymentStatus.PENDING) {
      this.logger.warn(
        `Expired callback for ${externalId} ignored: transaction is already ${transaction.paymentStatus}.`,
      );
      return;
    }

    await this.transactionsService.markExpired(transaction.id);
  }

  /**
   * Called by the LinkQu payment callback controller when status
   * indicates the payment failed (not the success case).
   */
  async handleInvoiceFailed(externalId: string): Promise<void> {
    const transaction =
      await this.transactionsService.findByExternalId(externalId);

    if (!transaction) {
      throw new NotFoundException(
        `Transaction ${externalId} not found for LinkQu callback`,
      );
    }

    if (transaction.paymentStatus !== PaymentStatus.PENDING) {
      this.logger.warn(
        `Failed callback for ${externalId} ignored: transaction is already ${transaction.paymentStatus}.`,
      );
      return;
    }

    await this.transactionsService.markFailed(transaction.id);
  }
}
