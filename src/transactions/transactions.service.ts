import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async markPaid(transactionId: string): Promise<void> {
    await this.transactionRepository.update(transactionId, {
      paymentStatus: PaymentStatus.PAID,
      paidAt: new Date(),
    });
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
