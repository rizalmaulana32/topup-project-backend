import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CommissionLogType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

/**
 * Schema-ready per dev-doc/topup-affiliate-platform/database-diagram.md.
 * Nothing writes to this table yet: commission crediting (on a referred
 * checkout) and debiting (on a withdrawal payout) are separate future
 * slices. withdrawal_id is a plain nullable column, not a relation, because
 * COMMISSION_WITHDRAWALS does not exist yet.
 */
@Entity('commission_logs')
export class CommissionLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'affiliator_id' })
  affiliatorId: string;

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
