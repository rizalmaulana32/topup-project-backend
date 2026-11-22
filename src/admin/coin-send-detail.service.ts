import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AffiliatesService,
  toLinkedAdmin,
  toLinkedSuperAffiliate,
} from '../affiliates/affiliates.service';
import { AffiliatorProfile } from '../affiliates/entities/affiliator-profile.entity';
import {
  CommissionLog,
  CommissionLogType,
} from '../affiliates/entities/commission-log.entity';
import { ManualTopupSend } from '../manual-topup/entities/manual-topup-send.entity';
import { ManualTopup } from '../manual-topup/entities/manual-topup.entity';
import { CoinSend } from '../provider/entities/coin-send.entity';
import { SuperAffiliateCommissionLog } from '../super-affiliates/entities/super-affiliate-commission-log.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { User } from '../users/entities/user.entity';

/**
 * Everything behind one coin_sends row: the buyer's Momo account, the
 * LinkQu transaction or manual top-up it was for, who triggered it, the
 * referral affiliate with their current upline, and the commission actually
 * credited for it. Rows sent before ref_id existed only have the basics.
 */
@Injectable()
export class CoinSendDetailService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly affiliatesService: AffiliatesService,
  ) {}

  async findOne(id: string) {
    const send = await this.dataSource
      .getRepository(CoinSend)
      .findOneBy({ id });
    if (!send) {
      throw new NotFoundException(`Coin send ${id} not found`);
    }

    const refId = send.refId;
    const isManualTopup = send.source === 'MANUAL_TOPUP';
    const isTransaction = refId !== null && !isManualTopup;
    const [manualTopupId, manualSendId] =
      refId !== null && isManualTopup ? refId.split('#') : [];

    const [transaction, manualTopup, manualSend] = await Promise.all([
      isTransaction
        ? this.dataSource.getRepository(Transaction).findOneBy({ id: refId })
        : null,
      manualTopupId
        ? this.dataSource
            .getRepository(ManualTopup)
            .findOneBy({ id: manualTopupId })
        : null,
      manualSendId
        ? this.dataSource
            .getRepository(ManualTopupSend)
            .findOneBy({ id: manualSendId })
        : null,
    ]);

    // || not ??: many transactions store "no referral" as ''.
    const referralCode =
      transaction?.referralCode || manualTopup?.referralCode || null;
    const triggeredBy = send.adminId ?? manualTopup?.createdBy ?? null;

    const [momoUsers, admin, affiliate, affiliateLog, superAffiliateLog] =
      await Promise.all([
        this.affiliatesService.lookupMomoUsers([send.targetUserId]),
        triggeredBy
          ? this.dataSource.getRepository(User).findOneBy({ id: triggeredBy })
          : null,
        referralCode
          ? this.dataSource.getRepository(AffiliatorProfile).findOne({
              where: { affiliateCode: referralCode },
              relations: {
                user: true,
                adminProfile: { user: true },
                superAffiliateProfile: { user: true },
              },
              withDeleted: true,
            })
          : null,
        refId
          ? this.dataSource.getRepository(CommissionLog).findOneBy({
              transactionId: refId,
              type: CommissionLogType.CREDIT,
            })
          : null,
        refId
          ? this.dataSource
              .getRepository(SuperAffiliateCommissionLog)
              .findOneBy({
                transactionId: refId,
                type: CommissionLogType.CREDIT,
              })
          : null,
      ]);
    const momoUser = momoUsers.get(send.targetUserId);

    return {
      send,
      detail: {
        momo_username: momoUser?.username ?? null,
        momo_avatar_url: momoUser?.avatarUrl ?? null,
        triggered_by: admin
          ? {
              user_id: admin.id,
              name: admin.name,
              email: admin.email,
              role: admin.role,
            }
          : null,
        transaction: transaction && {
          id: transaction.id,
          created_at: transaction.createdAt,
          paid_at: transaction.paidAt,
          completed_at: transaction.completedAt,
          payment_status: transaction.paymentStatus,
          provider_status: transaction.providerStatus,
          linkqu_reference: transaction.linkQuReference,
          target_user_id: transaction.targetUserId,
          target_zone_id: transaction.targetZoneId,
          product: transaction.product && {
            id: transaction.product.id,
            name: transaction.product.name,
            provider_code: transaction.product.providerCode,
            coin_amount: transaction.product.coinAmount,
            bonus_coin: transaction.product.bonusCoin,
            selling_price: transaction.product.sellingPrice,
          },
          coin_amount: transaction.coinAmount,
          bonus_coin: transaction.bonusCoin,
          gross_amount: transaction.grossAmount,
          customer_discount_amount: transaction.customerDiscountAmount,
          provider_fee: transaction.providerFee,
          cost_basis: transaction.costBasis,
        },
        manual_topup: manualTopup && {
          id: manualTopup.id,
          customer_name: manualTopup.customerName,
          momo_user_id: manualTopup.momoUserId,
          total_amount: manualTopup.totalAmount,
          amount_per_send: manualTopup.amountPerSend,
          amount_sent: manualTopup.amountSent,
          interval_seconds: manualTopup.intervalSeconds,
          status: manualTopup.status,
          created_at: manualTopup.createdAt,
          send: manualSend && {
            id: manualSend.id,
            amount: manualSend.amount,
            status: manualSend.status,
            sent_at: manualSend.sentAt,
          },
        },
        referral: !referralCode
          ? null
          : {
              code: referralCode,
              affiliate: affiliate && {
                affiliator_profile_id: affiliate.id,
                user_id: affiliate.userId,
                name: affiliate.user?.name ?? null,
                email: affiliate.user?.email ?? null,
                phone_number: affiliate.phoneNumber,
                deleted: affiliate.deletedAt !== null,
              },
              // Current upline - an affiliate moved since then shows the new one.
              upline_admin: toLinkedAdmin(affiliate?.adminProfile),
              upline_super_affiliate: toLinkedSuperAffiliate(
                affiliate?.superAffiliateProfile,
              ),
              // What was actually credited for this send (null = nothing).
              affiliate_commission: affiliateLog?.amount ?? null,
              super_affiliate_commission: superAffiliateLog?.amount ?? null,
            },
      },
    };
  }
}
