import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum SuperAffiliateThresholdMode {
  /** The transaction's own gross amount must reach threshold_amount. */
  PER_TRANSACTION = 'per_transaction',
  /** The month's paid volume across all downline affiliates must reach it. */
  MONTHLY_TOTAL_DOWNLINE = 'monthly_total_downline',
  /** The month's paid volume of the source affiliate alone must reach it. */
  MONTHLY_PER_AFFILIATE = 'monthly_per_affiliate',
}

/**
 * A super affiliate (SA) sits above affiliates who registered with its
 * referral code and earns commission_rate% of their referred transactions
 * once the threshold is met - paid by the platform, on top of (never taken
 * from) the affiliate's own commission.
 */
@Entity('super_affiliate_profiles')
@Check(
  'CHK_super_affiliate_profiles_rate',
  '"commission_rate" >= 0 AND "commission_rate" <= 100',
)
export class SuperAffiliateProfile {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint', unique: true })
  userId: string;

  /** Not eager - see AffiliatorProfile.user for why (FOR UPDATE + LEFT JOIN). */
  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'referral_code', type: 'varchar', unique: true })
  referralCode: string;

  @Column({
    name: 'commission_rate',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 1,
  })
  commissionRate: string;

  @Column({
    name: 'threshold_mode',
    type: 'enum',
    enum: SuperAffiliateThresholdMode,
    default: SuperAffiliateThresholdMode.PER_TRANSACTION,
  })
  thresholdMode: SuperAffiliateThresholdMode;

  @Column({
    name: 'threshold_amount',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 1000000,
  })
  thresholdAmount: string;

  @Column({
    name: 'commission_balance',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  commissionBalance: string;

  @Column({
    name: 'total_commission_earned',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  totalCommissionEarned: string;

  @Column({ name: 'bank_name' })
  bankName: string;

  @Column({ name: 'account_number' })
  accountNumber: string;

  @Column({ name: 'account_holder' })
  accountHolder: string;

  @Column({ name: 'phone_number' })
  phoneNumber: string;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
