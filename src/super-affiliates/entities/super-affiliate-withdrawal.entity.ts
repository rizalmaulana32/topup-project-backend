import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { WithdrawalBase } from '../../affiliates/entities/commission-withdrawal.entity';
import { SuperAffiliateProfile } from './super-affiliate-profile.entity';

/** Same columns and flow as commission_withdrawals, kept in its own table so the affiliate flow is untouched. */
@Entity('super_affiliate_withdrawals')
export class SuperAffiliateWithdrawal extends WithdrawalBase {
  @Column({ name: 'super_affiliate_profile_id', type: 'bigint' })
  superAffiliateProfileId: string;

  @ManyToOne(() => SuperAffiliateProfile)
  @JoinColumn({ name: 'super_affiliate_profile_id' })
  superAffiliate: SuperAffiliateProfile;
}
