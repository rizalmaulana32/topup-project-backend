import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Singleton row (id is always 1) holding global, superadmin-configurable
 * platform rules (SRS-ADM-02, SRS-ADM-03). Per-affiliate commission
 * overrides live on AffiliatorProfile.commission_rate instead.
 */
@Entity('platform_settings')
export class PlatformSettings {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  @Column({
    name: 'global_commission_rate',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 10,
  })
  globalCommissionRate: string;

  @Column({
    name: 'minimum_withdrawal_amount',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 100000,
  })
  minimumWithdrawalAmount: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
