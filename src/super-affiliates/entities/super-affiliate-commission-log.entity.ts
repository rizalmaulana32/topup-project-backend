import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CommissionLogType } from '../../affiliates/entities/commission-log.entity';

@Entity('super_affiliate_commission_logs')
/** A re-delivered payment webhook can never credit the same transaction twice. */
@Index(
  'UQ_super_affiliate_commission_logs_credit',
  ['superAffiliateProfileId', 'transactionId'],
  { unique: true, where: `"type" = 'credit' AND "transaction_id" IS NOT NULL` },
)
export class SuperAffiliateCommissionLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'super_affiliate_profile_id', type: 'bigint' })
  superAffiliateProfileId: string;

  /** The downline affiliate whose referral code the transaction used; null for withdrawal entries. */
  @Column({ name: 'affiliator_id', type: 'bigint', nullable: true })
  affiliatorId: string | null;

  @Column({ name: 'transaction_id', type: 'varchar', nullable: true })
  transactionId: string | null;

  @Column({ name: 'withdrawal_id', type: 'varchar', nullable: true })
  withdrawalId: string | null;

  @Column({ type: 'enum', enum: CommissionLogType })
  type: CommissionLogType;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ name: 'balance_after', type: 'decimal', precision: 14, scale: 2 })
  balanceAfter: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
