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

    // A referral code splits part of the affiliate's commission rate back
    // to the customer as an upfront price cut (client request 2026-10-31:
    // the affiliate was keeping the full commission with nothing passed
    // on to the referred customer). Only a code that would actually earn
    // commission (checkCodeValidity) triggers the discount - same
    // criteria creditCommissionForTransaction uses, so a fake/inactive
    // code never discounts the price for nothing.
    let chargedAmount = product.sellingPrice;
    let customerDiscountAmount = '0.00';
    if (dto.affiliate_code) {
      const codeCheck = await this.affiliatesService.checkCodeValidity(
        dto.affiliate_code,
      );
      if (codeCheck.valid) {
        const settings = await this.settingsService.get();
        const minAmount = Number(settings.customerDiscountMinAmount);
        // Below this, no bonus/discount at all (client request via Ricky
        // 2026-10-31: "soale 350 munggah onok bonus e" - the bonus only
        // exists from Rp350.000 up).
        if (Number(product.sellingPrice) >= minAmount) {
          const discountRate = Number(settings.customerDiscountRate);
          const discount =
            Math.round(Number(product.sellingPrice) * discountRate) / 100;
          customerDiscountAmount = discount.toFixed(2);
          chargedAmount = (Number(product.sellingPrice) - discount).toFixed(2);
        }
      }
    }

    const transaction = await this.transactionsService.createPending({
      product,
      targetUserId: dto.target_user_id,
      targetZoneId: dto.target_zone_id,
      referralCode: dto.affiliate_code,
      grossAmount: chargedAmount,
      customerDiscountAmount,
    });

    const invoice = await this.linkQuService.createInvoice({
      externalId: transaction.id,
      amount: Number(chargedAmount),
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
        Number(settings.customAmountMarginRate),
      );

    if (coinAmount <= 0) {
      throw new BadRequestException(
        `amount ${dto.amount} is too small to convert to any coin`,
      );
    }

    // Referral-funded bonus (client correction 2026-11-05 via Ricky: unlike
    // the fixed-catalog checkout(), a custom-amount top-up must invoice
    // LinkQu for the full typed amount - the customer is depositing that
    // exact nominal, not buying a discounted product. The referral "discount"
    // here is instead paid out as extra bonus coin (same 1:1 Rupiah->coin
    // rate as the rest of custom-amount pricing), funded by cutting the
    // affiliate's commission by that same Rupiah amount - never by
    // shorting what's actually invoiced/charged.
    let customerDiscountAmount = '0.00';
    let referralBonusCoin = 0;
    if (dto.affiliate_code) {
      const codeCheck = await this.affiliatesService.checkCodeValidity(
        dto.affiliate_code,
      );
      if (codeCheck.valid) {
        const minAmount = Number(settings.customerDiscountMinAmount);
        if (dto.amount >= minAmount) {
          const discountRate = Number(settings.customerDiscountRate);
          const discount = Math.round(dto.amount * discountRate) / 100;
          customerDiscountAmount = discount.toFixed(2);
          referralBonusCoin = Math.floor(discount);
        }
      }
    }

    const finalCoinAmount = coinAmount + referralBonusCoin;
    // The bonus coin costs the platform real money same as the published
    // tier bonus does, so it's folded into costBasis the same way -
    // creditRevenueForTransaction (gross - cost - commission - fee) then
    // correctly reflects it as an affiliate-funded cost, not platform loss.
    const finalCostBasis = costBasis + referralBonusCoin;

    const transaction =
      await this.transactionsService.createPendingCustomAmount({
        grossAmount: dto.amount.toFixed(2),
        customerDiscountAmount,
        coinAmount: String(finalCoinAmount),
        costBasis: String(finalCostBasis),
        targetUserId: dto.target_user_id,
        targetZoneId: dto.target_zone_id,
        referralCode: dto.affiliate_code,
      });

    const invoice = await this.linkQuService.createInvoice({
      externalId: transaction.id,
      amount: dto.amount,
      description: `Top-up ${finalCoinAmount} coin for ${dto.target_user_id}`,
    });

    await this.transactionsService.attachLinkQuReference(
      transaction.id,
      invoice.invoiceId,
    );

    return {
      transaction_id: transaction.id,
      coin_amount: finalCoinAmount,
      bonus_coin: bonusCoin,
      extra_coin: extraCoin,
      referral_bonus_coin: referralBonusCoin,
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
      // originalAmount is the pre-discount/pre-bonus value the commission
      // rate applies to. The fixed-catalog checkout() invoices a
      // discounted grossAmount, so the original price is recovered by
      // adding the discount back; the custom-amount checkoutCustomAmount()
      // invoices the full typed amount already (2026-11-05 correction -
      // see its doc comment), so grossAmount already IS the original and
      // needs no reconstruction.
      const commissionPaid = transaction.referralCode
        ? await this.affiliatesService.creditCommissionForTransaction({
            referralCode: transaction.referralCode,
            transactionId: transaction.id,
            originalAmount: transaction.product
              ? (
                  Number(transaction.grossAmount) +
                  Number(transaction.customerDiscountAmount ?? 0)
                ).toFixed(2)
              : transaction.grossAmount,
            customerDiscountAmount: transaction.customerDiscountAmount,
          })
        : '0.00';

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
