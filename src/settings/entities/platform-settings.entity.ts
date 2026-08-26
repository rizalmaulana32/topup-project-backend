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

  /**
   * The platform's own accumulated revenue (sellingPrice - basePrice -
   * commission paid, credited on every successfully-injected paid
   * transaction — see PlatformService.creditRevenueForTransaction),
   * withdrawable by the superadmin to adminBankName/adminAccountNumber
   * via the same Duitku disbursement flow used for affiliate withdrawals.
   */
  @Column({
    name: 'platform_balance',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  platformBalance: string;

  /**
   * The superadmin's own payout destination — set directly via
   * PATCH /admin/settings (no self-registration form, unlike affiliate
   * bank details) since there's exactly one of these per platform.
   */
  @Column({ name: 'admin_bank_name', type: 'varchar', nullable: true })
  adminBankName: string | null;

  @Column({ name: 'admin_account_number', type: 'varchar', nullable: true })
  adminAccountNumber: string | null;

  @Column({ name: 'admin_account_holder', type: 'varchar', nullable: true })
  adminAccountHolder: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
