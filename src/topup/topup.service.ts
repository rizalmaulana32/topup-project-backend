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
import { TransactionsService } from '../transactions/transactions.service';
import { DuitkuService } from '../duitku/duitku.service';
import { CheckIdDto } from './dto/check-id.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { PaymentStatus } from '../transactions/entities/transaction.entity';

@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    @Inject(PROVIDER_TOP_UP_PORT)
    private readonly provider: ProviderTopUpPort,
    private readonly productsService: ProductsService,
    private readonly transactionsService: TransactionsService,
    private readonly duitkuService: DuitkuService,
    private readonly affiliatesService: AffiliatesService,
    private readonly platformService: PlatformService,
  ) {}

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
    if (transaction.duitkuReference) {
      try {
        const status = await this.duitkuService.checkTransactionStatus(
          transaction.id,
        );
        adminFee = status.fee;
      } catch (error) {
        // Fee is supplementary display info, not core to status-checking -
        // degrade gracefully rather than fail the whole lookup if Duitku's
        // transactionStatus call has trouble.
        this.logger.warn(
          `Could not fetch Duitku fee for ${transactionId}: ${error instanceof Error ? error.message : 'unknown error'}`,
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

    const invoice = await this.duitkuService.createInvoice({
      externalId: transaction.id,
      amount: Number(product.sellingPrice),
      description: `Top-up ${product.name} for ${dto.target_user_id}`,
    });

    await this.transactionsService.attachDuitkuReference(
      transaction.id,
      invoice.invoiceId,
    );

    return {
      transaction_id: transaction.id,
      duitku_reference: invoice.invoiceId,
      invoice_url: invoice.invoiceUrl,
    };
  }

  /**
   * Called by the Duitku invoice callback controller after the callback
   * signature has already been verified.
   */
  async handleInvoicePaid(externalId: string): Promise<void> {
    const transaction =
      await this.transactionsService.findByExternalId(externalId);

    if (!transaction) {
      throw new NotFoundException(
        `Transaction ${externalId} not found for Duitku callback`,
      );
    }

    if (transaction.paymentStatus === PaymentStatus.PAID) {
      this.logger.warn(
        `Duplicate paid callback for ${externalId}, ignoring (idempotent).`,
      );
      return;
    }

    await this.transactionsService.markPaid(transaction.id);

    if (!transaction.product) {
      throw new BadRequestException(
        `Transaction ${externalId} has no linked product; cannot inject coin`,
      );
    }

    const injectResult = await this.provider.injectCoin({
      productProviderCode: transaction.product.providerCode,
      targetUserId: transaction.targetUserId,
      targetZoneId: transaction.targetZoneId,
      coin:
        Number(transaction.product.coinAmount) +
        Number(transaction.product.bonusCoin),
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

      await this.platformService.creditRevenueForTransaction({
        transactionId: transaction.id,
        grossAmount: transaction.grossAmount,
        baseCost: transaction.product.basePrice,
        commissionPaid,
      });
    }
  }

  /**
   * Marks a transaction expired. Not currently reachable from the Duitku
   * webhook - unlike Xendit, Duitku's invoice callback only ever fires for
   * a definitive success/failure result (resultCode 00/01/02), with no
   * separate "expired" push notification. A transaction that never gets
   * paid within its window simply stays pending unless something else
   * (e.g. a future reconciliation job polling Duitku's transactionStatus
   * endpoint for old pending transactions) calls this. Kept as a real,
   * tested method so that reconciliation path has somewhere to call into.
   * A transaction that already paid must never be downgraded back to
   * expired.
   */
  async handleInvoiceExpired(externalId: string): Promise<void> {
    const transaction =
      await this.transactionsService.findByExternalId(externalId);

    if (!transaction) {
      throw new NotFoundException(
        `Transaction ${externalId} not found for Duitku callback`,
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
   * Called by the Duitku invoice callback controller when resultCode
   * indicates the payment failed or was canceled (not the success case).
   */
  async handleInvoiceFailed(externalId: string): Promise<void> {
    const transaction =
      await this.transactionsService.findByExternalId(externalId);

    if (!transaction) {
      throw new NotFoundException(
        `Transaction ${externalId} not found for Duitku callback`,
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
