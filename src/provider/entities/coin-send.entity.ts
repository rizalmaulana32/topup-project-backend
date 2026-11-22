import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** pending = in flight; rejected = provider definitely sent nothing; unknown = may have arrived. */
export type CoinSendStatus = 'pending' | 'success' | 'rejected' | 'unknown';

/** Sources not paid through LinkQu; every other source is a LinkQu checkout. */
export const MANUAL_COIN_SEND_SOURCES = [
  'MANUAL_TOPUP',
  'ADMIN_MANUAL_TRANSFER',
];

/** Every injectCoin attempt, from any flow - what CoinSendGuard checks for duplicates. */
@Entity('coin_sends')
@Index(['targetUserId', 'coin', 'createdAt'])
@Index('IDX_coin_sends_created_at', ['createdAt'])
export class CoinSend {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'target_user_id' })
  targetUserId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  coin: string;

  @Column({ type: 'varchar' })
  status: CoinSendStatus;

  /** productProviderCode of the caller, e.g. custom-amount, MANUAL_TOPUP, ADMIN_MANUAL_TRANSFER. */
  @Column()
  source: string;

  /**
   * What the send was for, as commission logs' transaction_id knows it:
   * the transaction id for a LinkQu checkout, manualTopupSendKey() for a
   * manual top-up installment, null for an admin transfer.
   */
  @Column({ name: 'ref_id', type: 'varchar', nullable: true })
  refId: string | null;

  /** Who triggered it - set only for ADMIN_MANUAL_TRANSFER. */
  @Column({ name: 'admin_id', type: 'bigint', nullable: true })
  adminId: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /** Provider reply, or the thrown error when the call never returned. */
  @Column({ name: 'provider_response', type: 'text', nullable: true })
  providerResponse: string | null;

  /** Merchant's MomoLive coin balance right after a successful send. */
  @Column({
    name: 'balance_after',
    type: 'decimal',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  balanceAfter: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
