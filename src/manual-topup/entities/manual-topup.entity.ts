import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

export enum ManualTopupStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  /** An ADMIN-role creator's coin budget ran out mid-schedule; resumes once topped up (see ManualTopupService.resume). */
  PAUSED = 'paused',
}

/**
 * Manual, no-payment-gateway coin send (client request via Ricky
 * 2026-11-02: "pengisian manual tanpa payment gateway"). Two modes, unified
 * by the same send loop:
 * - One-off ("kirim sekarang"): intervalMinutes is null, amountPerSend ==
 *   totalAmount, sent once immediately, completes right away.
 * - Scheduled/partial ("partial berjangka", corrected 2026-11-02: "misal
 *   di set topup 10000, per berapa menit iku ngirim 100, sampek entek" -
 *   totalAmount is the overall target, amountPerSend is sent every
 *   intervalMinutes until amountSent reaches totalAmount; the final send
 *   takes whatever remainder is left rather than overshooting).
 */
@Entity('manual_topups')
export class ManualTopup {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'momo_user_id' })
  momoUserId: string;

  @Column({ name: 'customer_name', type: 'varchar', nullable: true })
  customerName: string | null;

  @Column({ name: 'total_amount', type: 'decimal', precision: 14, scale: 2 })
  totalAmount: string;

  @Column({
    name: 'amount_per_send',
    type: 'decimal',
    precision: 14,
    scale: 2,
  })
  amountPerSend: string;

  @Column({
    name: 'amount_sent',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  amountSent: string;

  /** Null = one-off "send now"; otherwise minutes between each send. */
  @Column({ name: 'interval_minutes', type: 'int', nullable: true })
  intervalMinutes: number | null;

  @Column({
    type: 'enum',
    enum: ManualTopupStatus,
    default: ManualTopupStatus.ACTIVE,
  })
  status: ManualTopupStatus;

  /** When the next send is due; null once completed/cancelled. */
  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
  nextRunAt: Date | null;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
