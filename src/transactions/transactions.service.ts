import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { generateOrderId } from '../common/utils/id-generator.util';
import { Product } from '../products/entities/product.entity';
import {
  PaymentStatus,
  ProviderStatus,
  Transaction,
} from './entities/transaction.entity';

interface CreatePendingTransactionParams {
  product: Product;
  targetUserId: string;
  targetZoneId?: string | null;
  referralCode?: string | null;
}

interface CreatePendingCustomAmountTransactionParams {
  grossAmount: string;
  coinAmount: string;
  costBasis: string;
  targetUserId: string;
  targetZoneId?: string | null;
  referralCode?: string | null;
}

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
  ) {}

  async createPending(
    params: CreatePendingTransactionParams,
  ): Promise<Transaction> {
    const transaction = this.transactionRepository.create({
      id: generateOrderId('TRX'),
      productId: params.product.id,
      targetUserId: params.targetUserId,
      targetZoneId: params.targetZoneId ?? null,
      referralCode: params.referralCode ?? null,
      grossAmount: params.product.sellingPrice,
      paymentStatus: PaymentStatus.PENDING,
      providerStatus: ProviderStatus.PENDING,
    });

    return this.transactionRepository.save(transaction);
  }

  async createPendingCustomAmount(
    params: CreatePendingCustomAmountTransactionParams,
  ): Promise<Transaction> {
    const transaction = this.transactionRepository.create({
      id: generateOrderId('TRX'),
      productId: null,
      targetUserId: params.targetUserId,
      targetZoneId: params.targetZoneId ?? null,
      referralCode: params.referralCode ?? null,
      grossAmount: params.grossAmount,
      coinAmount: params.coinAmount,
      costBasis: params.costBasis,
      paymentStatus: PaymentStatus.PENDING,
      providerStatus: ProviderStatus.PENDING,
    });

    return this.transactionRepository.save(transaction);
  }

  async attachLinkQuReference(
    transactionId: string,
    linkQuReference: string,
  ): Promise<void> {
    await this.transactionRepository.update(transactionId, {
      linkQuReference,
    });
  }

  async findByLinkQuReference(
    linkQuReference: string,
  ): Promise<Transaction | null> {
    return this.transactionRepository.findOne({
      where: { linkQuReference },
    });
  }

  async findByExternalId(externalId: string): Promise<Transaction | null> {
    return this.transactionRepository.findOne({
      where: { id: externalId },
    });
  }

  async findByReferralCode(referralCode: string): Promise<Transaction[]> {
    return this.transactionRepository.find({
      where: { referralCode },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(params: { limit: number; offset: number }): Promise<{
    items: Transaction[];
    total: number;
  }> {
    const [items, total] = await this.transactionRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { items, total };
  }

  /**
   * Transactions that have a LinkQu invoice but never got a paid/failed
   * callback - the reconciliation sweep's input set (see
   * TransactionReconciliationService). Excludes rows with no
   * linkQuReference since those never reached LinkQu at all and have
   * nothing to check status for.
   */
  async findPendingWithLinkQuReference(): Promise<Transaction[]> {
    return this.transactionRepository.find({
      where: {
        paymentStatus: PaymentStatus.PENDING,
        linkQuReference: Not(IsNull()),
      },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Atomic conditional transition (PENDING -> PAID): the WHERE clause on
   * paymentStatus makes this a single row-locked UPDATE, so two
   * near-simultaneous paid callbacks for the same transaction (LinkQu
   * retries, or a real callback racing an admin simulate-paid call) can
   * never both win - only one UPDATE actually matches a row and returns
   * true, which is what guards coin injection from running twice.
   */
  async markPaid(transactionId: string): Promise<boolean> {
    const result = await this.transactionRepository.update(
      { id: transactionId, paymentStatus: PaymentStatus.PENDING },
      { paymentStatus: PaymentStatus.PAID, paidAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  async markExpired(transactionId: string): Promise<void> {
    await this.transactionRepository.update(transactionId, {
      paymentStatus: PaymentStatus.EXPIRED,
    });
  }

  async markFailed(transactionId: string): Promise<void> {
    await this.transactionRepository.update(transactionId, {
      paymentStatus: PaymentStatus.FAILED,
    });
  }

  async markProviderResult(
    transactionId: string,
    result: { success: boolean; response: string },
  ): Promise<void> {
    await this.transactionRepository.update(transactionId, {
      providerStatus: result.success
        ? ProviderStatus.SUCCESS
        : ProviderStatus.FAILED,
      providerResponse: result.response,
      completedAt: new Date(),
    });
  }
}
