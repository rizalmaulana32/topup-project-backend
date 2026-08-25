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

  @Column({ name: 'product_id' })
  productId: string;

  @ManyToOne(() => Product, { eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

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
    name: 'duitku_reference',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  duitkuReference: string | null;

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

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
