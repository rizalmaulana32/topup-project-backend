import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('affiliator_profiles')
export class AffiliatorProfile {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  /**
   * Not eager: an eager relation forces TypeORM to LEFT JOIN User on every
   * AffiliatorProfile query, including pessimistic-locked ones — Postgres
   * rejects FOR UPDATE across a LEFT JOIN ("cannot be applied to the
   * nullable side of an outer join"). Request `relations: { user: true }`
   * explicitly where the join is actually needed and safe (no lock).
   */
  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    name: 'affiliate_code',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  affiliateCode: string | null;

  @Column({
    name: 'commission_rate',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 10,
  })
  commissionRate: string;

  @Column({ name: 'bank_name' })
  bankName: string;

  @Column({ name: 'account_number' })
  accountNumber: string;

  @Column({ name: 'account_holder' })
  accountHolder: string;

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

  /**
   * Opt-in alternative to the flat commissionRate above (Ricky/client
   * request 2026-10-31): below TIERED_COMMISSION_THRESHOLD of referred
   * volume in a calendar month, the affiliate earns TIERED_COMMISSION_LOW_RATE;
   * once the month's cumulative volume crosses the threshold, that
   * transaction and the rest of the month earn TIERED_COMMISSION_HIGH_RATE
   * (not retroactive to earlier transactions that month - see
   * calculateTieredCommissionRate). currentPeriodVolume/Month track the
   * running total and reset automatically when the calendar month rolls
   * over - see AffiliatesService.creditCommissionForTransaction.
   */
  @Column({ name: 'tiered_commission_enabled', default: false })
  tieredCommissionEnabled: boolean;

  @Column({
    name: 'current_period_volume',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  currentPeriodVolume: string;

  /** 'YYYY-MM' of the period currentPeriodVolume belongs to; null until first used. */
  @Column({
    name: 'current_period_month',
    type: 'varchar',
    length: 7,
    nullable: true,
  })
  currentPeriodMonth: string | null;

  @Column({ name: 'approved_by', type: 'bigint', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
