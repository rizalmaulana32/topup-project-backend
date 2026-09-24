import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum PlatformWithdrawalStatus {
  PENDING = 'pending',
  /**
   * Sent to the payout provider (LinkQu), which returned PENDING per its
   * own documented async handling rules - not in the original enum since
   * Duitku's Transfer Online always resolved synchronously. Resolved later
   * by the real LinkQu disbursement callback. Mirrors
   * CommissionWithdrawal's WithdrawalStatus.APPROVED.
   */
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
  FAILED = 'failed',
}

/**
 * A superadmin withdrawal from the platform's own revenue balance
 * (PlatformSettings.platformBalance) to the admin's own bank account
 * (PlatformSettings.adminBankName/etc, captured at request time so a
 * later settings change can't retroactively alter a pending withdrawal's
 * destination). Mirrors CommissionWithdrawal's shape and lifecycle, minus
 * the affiliator relation - there's exactly one payout destination here.
 */
@Entity('platform_withdrawals')
export class PlatformWithdrawal {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ name: 'bank_name' })
  bankName: string;

  @Column({ name: 'account_number' })
  accountNumber: string;

  @Column({ name: 'account_holder' })
  accountHolder: string;

  @Column({
    type: 'enum',
    enum: PlatformWithdrawalStatus,
    default: PlatformWithdrawalStatus.PENDING,
  })
  status: PlatformWithdrawalStatus;

  @Column({
    name: 'linkqu_disbursement_id',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  linkQuDisbursementId: string | null;

  @Column({ name: 'processed_by', type: 'bigint', nullable: true })
  processedBy: string | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
