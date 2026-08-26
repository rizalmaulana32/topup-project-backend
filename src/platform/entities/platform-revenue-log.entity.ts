import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PlatformRevenueLogType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

/**
 * Ledger for the platform's own accumulated revenue balance
 * (PlatformSettings.platformBalance), mirroring CommissionLog's shape for
 * affiliate balances. transaction_id/withdrawal_id are plain nullable
 * columns, not relations, matching CommissionLog's pattern.
 */
@Entity('platform_revenue_logs')
export class PlatformRevenueLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'transaction_id', type: 'varchar', nullable: true })
  transactionId: string | null;

  @Column({ name: 'withdrawal_id', type: 'varchar', nullable: true })
  withdrawalId: string | null;

  @Column({ type: 'enum', enum: PlatformRevenueLogType })
  type: PlatformRevenueLogType;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ name: 'balance_after', type: 'decimal', precision: 14, scale: 2 })
  balanceAfter: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
