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
   * Optional additional platform cut on adjustable-amount top-ups
   * (topup/checkout-custom), layered on top of the published 1:1 +
   * bonus-tier rate (see custom-amount-pricing.util.ts). Defaults to 0 so
   * the system exactly matches the client's real published pricing poster
   * ("YAY AGENCY - TOPUP RESMI KOIN MOMO LIVE", confirmed 2026-10-05) out
   * of the box; adjustable without a redeploy if the business wants a cut
   * later.
   */
  @Column({
    name: 'custom_amount_margin_rate',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  customAmountMarginRate: string;

  /**
   * Percentage of a referred order's original price passed back to the
   * CUSTOMER as an upfront checkout discount, funded by reducing the
   * affiliate's commission by the same amount (client request 2026-10-31:
   * referred purchase should split the commission rate between affiliate
   * and customer, not pay the affiliate the full rate - see
   * AffiliatesService.creditCommissionForTransaction). Defaults to 0 so
   * existing commission behavior is unchanged until a superadmin sets it.
   */
  @Column({
    name: 'customer_discount_rate',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  customerDiscountRate: string;

  /**
   * Minimum transaction amount (sellingPrice) for customerDiscountRate to
   * apply at all - below this, a referred purchase pays the affiliate the
   * full commission rate with no customer discount (client request via
   * Ricky 2026-10-31: "soale 350 munggah onok bonus e" - the bonus only
   * exists from Rp350.000 up). Defaults to 350000 to match that.
   */
  @Column({
    name: 'customer_discount_min_amount',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 350000,
  })
  customerDiscountMinAmount: string;

  /**
   * The platform's own accumulated revenue (sellingPrice - basePrice -
   * commission paid, credited on every successfully-injected paid
   * transaction — see PlatformService.creditRevenueForTransaction),
   * withdrawable by the superadmin to adminBankName/adminAccountNumber
   * via the same LinkQu disbursement flow used for affiliate withdrawals.
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
