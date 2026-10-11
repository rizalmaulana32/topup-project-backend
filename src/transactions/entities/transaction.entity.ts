import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

export enum ProviderStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * user_id and affiliator_id from the source ERD (dev-doc/topup-affiliate-platform/database-diagram.md)
 * are deferred: this slice has no Users/Auth or Affiliate module yet (customer checkout is
 * unauthenticated per SRS-USR). `referralCode` captures the raw affiliate_code input so a later
 * slice can resolve it to an affiliator_id and credit commission without losing data.
 */
@Entity('transactions')
export class Transaction {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'product_id', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { eager: true, nullable: true })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  /**
   * Coin payout for a custom-amount checkout (no product row) - null for
   * fixed-catalog transactions, which derive coin from product instead.
   */
  @Column({
    name: 'coin_amount',
    type: 'decimal',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  coinAmount: string | null;

  /**
   * Rupiah-equivalent cost basis for a custom-amount checkout, valued at
   * the MomoLive benchmark rate on the coin actually delivered - stands in
   * for product.basePrice when computing platform revenue.
   */
  @Column({
    name: 'cost_basis',
    type: 'decimal',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  costBasis: string | null;

  @Column({ name: 'target_user_id' })
  targetUserId: string;

  @Column({ name: 'target_zone_id', type: 'varchar', nullable: true })
  targetZoneId: string | null;

  @Column({ name: 'referral_code', type: 'varchar', nullable: true })
  referralCode: string | null;

  @Column({ name: 'gross_amount', type: 'decimal', precision: 14, scale: 2 })
  grossAmount: string;

  @Column({
    name: 'affiliate_commission',
    type: 'decimal',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  affiliateCommission: string | null;

  @Column({
    name: 'linkqu_reference',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  linkQuReference: string | null;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus: PaymentStatus;

  @Column({
    name: 'provider_status',
    type: 'enum',
    enum: ProviderStatus,
    default: ProviderStatus.PENDING,
  })
  providerStatus: ProviderStatus;

  @Column({ name: 'provider_response', type: 'text', nullable: true })
  providerResponse: string | null;

  /**
   * LinkQu's real admin fee for this payment, persisted at payment time
   * (fetched via LinkQuService.checkTransactionStatus, same call already
   * used for platform revenue crediting) so superadmin totals that need
   * the real amount customers paid - grossAmount + providerFee - don't
   * need a live LinkQu call per transaction to compute.
   */
  @Column({
    name: 'provider_fee',
    type: 'decimal',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  providerFee: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
