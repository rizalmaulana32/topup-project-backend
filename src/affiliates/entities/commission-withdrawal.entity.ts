import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { AffiliatorProfile } from './affiliator-profile.entity';

export enum WithdrawalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
  /**
   * Not in the source document's ERD (pending, approved, rejected, paid)
   * but needed to distinguish an admin-rejected request (never sent to the
   * payout provider) from a disbursement that was sent and came back
   * failed.
   */
  FAILED = 'failed',
}

@Entity('commission_withdrawals')
export class CommissionWithdrawal {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'affiliator_id' })
  affiliatorId: string;

  @ManyToOne(() => AffiliatorProfile)
  @JoinColumn({ name: 'affiliator_id' })
  affiliator: AffiliatorProfile;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  /** Flat withdrawal admin fee snapshotted at request time (platform_settings.withdrawal_admin_fee at that moment). */
  @Column({ name: 'admin_fee', type: 'decimal', precision: 14, scale: 2, default: 0 })
  adminFee: string;

  /** What the affiliate actually gets transferred - amount minus admin_fee. */
  @Column({ name: 'net_amount', type: 'decimal', precision: 14, scale: 2 })
  netAmount: string;

  @Column({ name: 'bank_name' })
  bankName: string;

  @Column({ name: 'account_number' })
  accountNumber: string;

  @Column({ name: 'account_holder' })
  accountHolder: string;

  @Column({
    type: 'enum',
    enum: WithdrawalStatus,
    default: WithdrawalStatus.PENDING,
  })
  status: WithdrawalStatus;

  @Column({
    name: 'linkqu_disbursement_id',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  linkQuDisbursementId: string | null;

  @Column({ name: 'admin_notes', type: 'varchar', nullable: true })
  adminNotes: string | null;

  /** Who/when an admin approved the request on our web (no money moved yet). */
  @Column({ name: 'approved_by', type: 'bigint', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  /** Who/when an admin marked the manual bank transfer as done. */
  @Column({ name: 'processed_by', type: 'bigint', nullable: true })
  processedBy: string | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
