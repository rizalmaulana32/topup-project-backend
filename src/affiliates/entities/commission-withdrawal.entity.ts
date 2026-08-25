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
   * but needed to distinguish an admin-rejected request (never sent to
   * Duitku) from a Duitku disbursement that was sent and came back failed.
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
    name: 'duitku_disbursement_id',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  duitkuDisbursementId: string | null;

  @Column({ name: 'admin_notes', type: 'varchar', nullable: true })
  adminNotes: string | null;

  @Column({ name: 'processed_by', type: 'bigint', nullable: true })
  processedBy: string | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
