import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ManualTopupSendStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

/** One actual provider send attempt for a ManualTopup (one row per installment, including the immediate first one). */
@Entity('manual_topup_sends')
export class ManualTopupSend {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'manual_topup_id' })
  manualTopupId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'enum', enum: ManualTopupSendStatus })
  status: ManualTopupSendStatus;

  @Column({ name: 'provider_response', type: 'text', nullable: true })
  providerResponse: string | null;

  @CreateDateColumn({ name: 'sent_at' })
  sentAt: Date;
}
