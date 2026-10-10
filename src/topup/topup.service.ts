import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PROVIDER_TOP_UP_PORT } from '../provider/provider-top-up.port';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { PlatformService } from '../platform/platform.service';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import { TransactionsService } from '../transactions/transactions.service';
import { LinkQuService } from '../linkqu/linkqu.service';
import { CheckIdDto } from './dto/check-id.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutCustomAmountDto } from './dto/checkout-custom-amount.dto';
import { EstimateCustomAmountDto } from './dto/estimate-custom-amount.dto';
import { calculateCustomAmountPricing } from './custom-amount-pricing.util';
import { PaymentStatus } from '../transactions/entities/transaction.entity';

@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    @Inject(PROVIDER_TOP_UP_PORT)
    private readonly provider: ProviderTopUpPort,
    private readonly productsService: ProductsService,
    private readonly transactionsService: TransactionsService,
    private readonly linkQuService: LinkQuService,
    private readonly affiliatesService: AffiliatesService,
    private readonly platformService: PlatformService,
    private readonly settingsService: SettingsService,
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

  async listActiveProducts() {
    const products = await this.productsService.findAllActive();
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      selling_price: product.sellingPrice,
      coin_amount: product.coinAmount,
      bonus_coin: product.bonusCoin,
      flag: product.flag,
    }));
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

  async checkout(dto: CheckoutDto) {
    const product = await this.productsService.findActiveByIdOrFail(
      dto.product_id,
    );

    const transaction = await this.transactionsService.createPending({
      product,
      targetUserId: dto.target_user_id,
      targetZoneId: dto.target_zone_id,
      referralCode: dto.affiliate_code,
    });

    const invoice = await this.linkQuService.createInvoice({
      externalId: transaction.id,
      amount: Number(product.sellingPrice),
      description: `Top-up ${product.name} for ${dto.target_user_id}`,
    });

    await this.transactionsService.attachLinkQuReference(
      transaction.id,
      invoice.invoiceId,
    );

    return {
      transaction_id: transaction.id,
      linkqu_reference: invoice.invoiceId,
      invoice_url: invoice.invoiceUrl,
    };
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
    const marginRate = Number(settings.customAmountMarginRate);
    const pricing = calculateCustomAmountPricing(amount, marginRate);

    return {
      amount,
      coin_amount: pricing.coinAmount,
      bonus_coin: pricing.bonusCoin,
    };
  }

  /**
   * Adjustable-amount checkout: customer types a nominal instead of picking
   * a fixed catalog product. See custom-amount-pricing.util.ts for the
   * confirmed coin/margin formula.
   */
  async checkoutCustomAmount(dto: CheckoutCustomAmountDto) {
    const settings = await this.settingsService.get();
    const { coinAmount, bonusCoin, costBasis } = calculateCustomAmountPricing(
      dto.amount,
      Number(settings.customAmountMarginRate),
    );

    if (coinAmount <= 0) {
      throw new BadRequestException(
        `amount ${dto.amount} is too small to convert to any coin`,
      );
    }

    const transaction =
      await this.transactionsService.createPendingCustomAmount({
        grossAmount: String(dto.amount),
        coinAmount: String(coinAmount),
        costBasis: String(costBasis),
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

    let coin: number;
    let costBasis: string;
    let providerProductCode: string;
    if (transaction.product) {
      coin =
        Number(transaction.product.coinAmount) +
        Number(transaction.product.bonusCoin);
      costBasis = transaction.product.basePrice;
      providerProductCode = transaction.product.providerCode;
    } else if (transaction.coinAmount && transaction.costBasis) {
      coin = Number(transaction.coinAmount);
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

    if (injectResult.success) {
      const commissionPaid = transaction.referralCode
        ? await this.affiliatesService.creditCommissionForTransaction({
            referralCode: transaction.referralCode,
            transactionId: transaction.id,
            grossAmount: transaction.grossAmount,
          })
        : '0.00';

      let linkQuFee = '0.00';
      try {
        const status = await this.linkQuService.checkTransactionStatus(
          transaction.id,
        );
        linkQuFee = status.fee ?? '0.00';
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
