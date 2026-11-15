import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** pending = in flight; rejected = provider definitely sent nothing; unknown = may have arrived. */
export type CoinSendStatus = 'pending' | 'success' | 'rejected' | 'unknown';

/** Every injectCoin attempt, from any flow - what CoinSendGuard checks for duplicates. */
@Entity('coin_sends')
@Index(['targetUserId', 'coin', 'createdAt'])
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
