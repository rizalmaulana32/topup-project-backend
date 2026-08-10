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
import { ProductsService } from '../products/products.service';
import { TransactionsService } from '../transactions/transactions.service';
import { XenditService } from '../xendit/xendit.service';
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
    private readonly xenditService: XenditService,
    private readonly affiliatesService: AffiliatesService,
  ) {}

  async listActiveProducts() {
    const products = await this.productsService.findAllActive();
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      selling_price: product.sellingPrice,
    }));
  }

  async getTransactionStatus(transactionId: string) {
    const transaction =
      await this.transactionsService.findByExternalId(transactionId);

    if (!transaction) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    return {
      transaction_id: transaction.id,
      payment_status: transaction.paymentStatus,
      provider_status: transaction.providerStatus,
      product_name: transaction.product?.name ?? null,
      gross_amount: transaction.grossAmount,
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

    const invoice = await this.xenditService.createInvoice({
      externalId: transaction.id,
      amount: Number(product.sellingPrice),
      description: `Top-up ${product.name} for ${dto.target_user_id}`,
    });

    await this.transactionsService.attachXenditInvoice(
      transaction.id,
      invoice.invoiceId,
    );

    return {
      transaction_id: transaction.id,
      xendit_invoice_id: invoice.invoiceId,
      invoice_url: invoice.invoiceUrl,
    };
  }

  /**
   * Called by the Xendit invoice callback controller after the
   * x-callback-token has already been verified.
   */
  async handleInvoicePaid(externalId: string): Promise<void> {
    const transaction =
      await this.transactionsService.findByExternalId(externalId);

    if (!transaction) {
      throw new NotFoundException(
        `Transaction ${externalId} not found for Xendit callback`,
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
    });

    await this.transactionsService.markProviderResult(transaction.id, {
      success: injectResult.success,
      response: injectResult.response,
    });

    if (injectResult.success && transaction.referralCode) {
      await this.affiliatesService.creditCommissionForTransaction({
        referralCode: transaction.referralCode,
        transactionId: transaction.id,
        grossAmount: transaction.grossAmount,
      });
    }
  }
}
