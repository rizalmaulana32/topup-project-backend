import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AffiliatorProfile } from '../affiliates/entities/affiliator-profile.entity';
import { ManualTopupSendStatus } from '../manual-topup/entities/manual-topup-send.entity';
import { CommissionLogType } from '../affiliates/entities/commission-log.entity';
import {
  WithdrawalMethod,
  WithdrawalStatus,
} from '../affiliates/entities/commission-withdrawal.entity';
import { currentPeriodKey } from '../affiliates/tiered-commission.util';
import {
  assertMomoIdExists,
  priceWithdrawal,
  sendMomoCoinPayout,
} from '../affiliates/withdrawal.util';
import { insertWithOrderId } from '../common/utils/id-generator.util';
import {
  assertReferralCodeAvailable,
  generateUniqueReferralCode,
} from '../common/utils/referral-code.util';
import { PROVIDER_TOP_UP_PORT } from '../provider/provider-top-up.port';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import { SettingsService } from '../settings/settings.service';
import { PaymentStatus } from '../transactions/entities/transaction.entity';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { SuperAffiliateCommissionLog } from './entities/super-affiliate-commission-log.entity';
import {
  SuperAffiliateProfile,
  SuperAffiliateThresholdMode,
} from './entities/super-affiliate-profile.entity';
import { SuperAffiliateWithdrawal } from './entities/super-affiliate-withdrawal.entity';
import {
  periodRange,
  qualifiesForSuperAffiliateCommission,
  superAffiliateCommission,
} from './super-affiliate-commission.util';

const BCRYPT_SALT_ROUNDS = 10;

export interface SuperAffiliateRuleChanges {
  name?: string;
  referralCode?: string;
  commissionRate?: number;
  thresholdMode?: SuperAffiliateThresholdMode;
  thresholdAmount?: number;
  status?: UserStatus;
}

@Injectable()
export class SuperAffiliatesService {
  private readonly logger = new Logger(SuperAffiliatesService.name);

  constructor(
    @InjectRepository(SuperAffiliateProfile)
    private readonly profileRepository: Repository<SuperAffiliateProfile>,
    @InjectRepository(SuperAffiliateCommissionLog)
    private readonly logRepository: Repository<SuperAffiliateCommissionLog>,
    @InjectRepository(SuperAffiliateWithdrawal)
    private readonly withdrawalRepository: Repository<SuperAffiliateWithdrawal>,
    @InjectRepository(AffiliatorProfile)
    private readonly affiliateRepository: Repository<AffiliatorProfile>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    @Inject(PROVIDER_TOP_UP_PORT)
    private readonly provider: ProviderTopUpPort,
  ) {}

  // ---- Commission ----

  /**
   * Credits the super affiliate above the affiliate who owns referralCode,
   * if the transaction meets that SA's threshold. Paid by the platform on
   * top of the affiliate's own commission (which this never touches).
   * Returns the amount credited, '0.00' when nothing is owed: no SA, the
   * affiliate or SA inactive/deleted, threshold not met, or already credited
   * for this transaction (re-delivered webhook).
   */
  async creditCommissionForTransaction(params: {
    referralCode: string;
    transactionId: string;
    grossAmount: string;
  }): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const affiliate = await manager.findOne(AffiliatorProfile, {
        where: { affiliateCode: params.referralCode },
      });
      if (
        !affiliate?.superAffiliateProfileId ||
        !(await isActiveUser(manager, affiliate.userId))
      ) {
        return '0.00';
      }

      // Serializes concurrent webhooks for this SA (balance + monthly volume).
      const superAffiliate = await manager.findOne(SuperAffiliateProfile, {
        where: { id: affiliate.superAffiliateProfileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !superAffiliate ||
        !(await isActiveUser(manager, superAffiliate.userId))
      ) {
        return '0.00';
      }

      const alreadyCredited = await manager.exists(
        SuperAffiliateCommissionLog,
        {
          where: {
            superAffiliateProfileId: superAffiliate.id,
            transactionId: params.transactionId,
            type: CommissionLogType.CREDIT,
          },
        },
      );
      if (alreadyCredited) return '0.00';

      const grossAmount = Number(params.grossAmount);
      let monthVolumeIncludingThis = grossAmount;
      if (
        superAffiliate.thresholdMode !==
        SuperAffiliateThresholdMode.PER_TRANSACTION
      ) {
        const volumes = await this.monthVolumes(
          manager,
          superAffiliate.id,
          params.transactionId,
        );
        monthVolumeIncludingThis +=
          superAffiliate.thresholdMode ===
          SuperAffiliateThresholdMode.MONTHLY_TOTAL_DOWNLINE
            ? sum(volumes.values())
            : (volumes.get(String(affiliate.id)) ?? 0);
      }

      const rate = Number(superAffiliate.commissionRate);
      const qualifies = qualifiesForSuperAffiliateCommission({
        mode: superAffiliate.thresholdMode,
        thresholdAmount: Number(superAffiliate.thresholdAmount),
        grossAmount,
        monthVolumeIncludingThis,
      });
      const amount = superAffiliateCommission(grossAmount, rate);
      if (!qualifies || Number(amount) <= 0) return '0.00';

      const newBalance = Number(superAffiliate.commissionBalance) + +amount;
      await manager.update(SuperAffiliateProfile, superAffiliate.id, {
        commissionBalance: newBalance.toFixed(2),
        totalCommissionEarned: (
          Number(superAffiliate.totalCommissionEarned) + +amount
        ).toFixed(2),
      });
      await manager.save(
        manager.create(SuperAffiliateCommissionLog, {
          superAffiliateProfileId: superAffiliate.id,
          affiliatorId: affiliate.id,
          transactionId: params.transactionId,
          type: CommissionLogType.CREDIT,
          amount,
          balanceAfter: newBalance.toFixed(2),
          description: `Super affiliate commission for ${params.transactionId} via ${params.referralCode} (${rate}% of ${grossAmount.toFixed(2)})`,
        }),
      );
      return amount;
    });
  }

  /**
   * This UTC month's paid volume per downline affiliate (affiliator id ->
   * gross). With beforeTransactionId, only transactions paid before that one
   * (itself excluded), so each transaction is judged on the volume that
   * preceded it no matter which webhook grabs the lock first.
   * ponytail: counts the SA's current downline - an affiliate moved mid-month
   * brings their earlier volume along.
   */
  private async monthVolumes(
    db: DataSource | EntityManager,
    superAffiliateId: string,
    beforeTransactionId?: string,
  ): Promise<Map<string, number>> {
    const { start, end } = periodRange(currentPeriodKey());
    const rows: { affiliator_id: string; volume: string }[] = await db.query(
      // Paid checkouts plus successful manual top-up sends that used a
      // referral code; a send's id matches manualTopupSendKey().
      `WITH v AS (
         SELECT t.id, t.referral_code, t.gross_amount AS amount, t.paid_at AS at
         FROM transactions t
         WHERE t.payment_status = $2 AND t.referral_code IS NOT NULL
         UNION ALL
         SELECT m.id || '#' || s.id, m.referral_code, s.amount, s.sent_at
         FROM manual_topup_sends s
         JOIN manual_topups m ON m.id = s.manual_topup_id
         WHERE s.status = $6 AND m.referral_code IS NOT NULL
       )
       SELECT ap.id::text AS affiliator_id, SUM(v.amount) AS volume
       FROM v
       JOIN affiliator_profiles ap ON ap.affiliate_code = v.referral_code
       WHERE ap.super_affiliate_profile_id = $1
         AND ap.deleted_at IS NULL
         AND v.at >= $3 AND v.at < $4
         AND ($5::varchar IS NULL OR (v.id <> $5 AND v.at <= (SELECT at FROM v WHERE id = $5)))
       GROUP BY ap.id`,
      [
        superAffiliateId,
        PaymentStatus.PAID,
        start,
        end,
        beforeTransactionId ?? null,
        ManualTopupSendStatus.SUCCESS,
      ],
    );
    return new Map(rows.map((r) => [r.affiliator_id, Number(r.volume)]));
  }

  // ---- Superadmin management ----

  async create(
    params: {
      name: string;
      email: string;
      password: string;
      phoneNumber: string;
      bankName: string;
      accountNumber: string;
      accountHolder: string;
      referralCode?: string;
      commissionRate?: number;
      thresholdMode?: SuperAffiliateThresholdMode;
      thresholdAmount?: number;
    },
    createdBy: string,
  ): Promise<SuperAffiliateProfile> {
    const referralCode = params.referralCode
      ? await assertReferralCodeAvailable(this.dataSource, params.referralCode)
      : await generateUniqueReferralCode(this.dataSource, 'SA');
    const user = await this.usersService.createUser({
      name: params.name,
      email: params.email,
      passwordHash: await bcrypt.hash(params.password, BCRYPT_SALT_ROUNDS),
      role: UserRole.SUPER_AFFILIATE,
      status: UserStatus.ACTIVE,
    });
    const profile = await this.profileRepository.save(
      this.profileRepository.create({
        userId: user.id,
        referralCode,
        commissionRate: (params.commissionRate ?? 1).toFixed(2),
        thresholdMode:
          params.thresholdMode ?? SuperAffiliateThresholdMode.PER_TRANSACTION,
        thresholdAmount: (params.thresholdAmount ?? 1000000).toFixed(2),
        bankName: params.bankName,
        accountNumber: params.accountNumber,
        accountHolder: params.accountHolder,
        phoneNumber: params.phoneNumber,
        createdBy,
      }),
    );
    return this.findOrFail(profile.id);
  }

  async findOrFail(id: string): Promise<SuperAffiliateProfile> {
    const profile = await this.profileRepository.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!profile) {
      throw new NotFoundException(`Super affiliate ${id} not found`);
    }
    return profile;
  }

  async findAll() {
    const profiles = await this.profileRepository.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
    const counts = await this.downlineCounts();
    return profiles.map((p) => ({
      ...toSuperAffiliateItem(p),
      downline_count: counts.get(String(p.id)) ?? 0,
    }));
  }

  async getDetail(id: string) {
    const profile = await this.findOrFail(id);
    const [downline, logs, withdrawals] = await Promise.all([
      this.getDownlineItems(profile.id),
      this.logRepository.find({
        where: { superAffiliateProfileId: profile.id },
        order: { createdAt: 'DESC' },
      }),
      this.withdrawalRepository.find({
        where: { superAffiliateProfileId: profile.id },
        order: { createdAt: 'DESC' },
      }),
    ]);
    return {
      ...toSuperAffiliateItem(profile),
      downline_count: downline.length,
      month: currentPeriodKey(),
      month_volume: sum(downline.map((a) => a.month_volume)).toFixed(2),
      affiliates: downline,
      commission_logs: logs.map(toLogItem),
      withdrawals: withdrawals.map(toWithdrawalItem),
    };
  }

  /** Rate/threshold changes only affect transactions credited from now on. */
  async update(id: string, changes: SuperAffiliateRuleChanges) {
    const profile = await this.findOrFail(id);
    if (changes.referralCode && changes.referralCode !== profile.referralCode) {
      await assertReferralCodeAvailable(this.dataSource, changes.referralCode, {
        table: 'super_affiliate_profiles',
        id: profile.id,
      });
    }
    const patch: Partial<SuperAffiliateProfile> = {
      ...(changes.referralCode !== undefined && {
        referralCode: changes.referralCode,
      }),
      ...(changes.commissionRate !== undefined && {
        commissionRate: changes.commissionRate.toFixed(2),
      }),
      ...(changes.thresholdMode !== undefined && {
        thresholdMode: changes.thresholdMode,
      }),
      ...(changes.thresholdAmount !== undefined && {
        thresholdAmount: changes.thresholdAmount.toFixed(2),
      }),
    };
    if (Object.keys(patch).length) {
      await this.profileRepository.update(profile.id, patch);
    }
    if (changes.name !== undefined) {
      await this.usersService.updateAccount(profile.userId, {
        name: changes.name,
      });
    }
    if (changes.status !== undefined) {
      await this.usersService.updateStatus(profile.userId, changes.status);
    }
    return this.findOrFail(id);
  }

  /** Superadmin manual add (+) / deduct (-) on commission_balance, logged like a normal credit/debit. */
  async adjustCommissionBalance(
    id: string,
    amount: number,
    reason?: string,
  ): Promise<SuperAffiliateProfile> {
    await this.dataSource.transaction(async (manager) => {
      const profile = await manager.findOne(SuperAffiliateProfile, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) {
        throw new NotFoundException(`Super affiliate ${id} not found`);
      }
      const newBalance = Number(profile.commissionBalance) + amount;
      if (newBalance < 0) {
        throw new BadRequestException(
          `Resulting commission balance would be negative (current: ${profile.commissionBalance}, delta: ${amount})`,
        );
      }
      await manager.update(SuperAffiliateProfile, profile.id, {
        commissionBalance: newBalance.toFixed(2),
        ...(amount > 0 && {
          totalCommissionEarned: (
            Number(profile.totalCommissionEarned) + amount
          ).toFixed(2),
        }),
      });
      await manager.save(
        manager.create(SuperAffiliateCommissionLog, {
          superAffiliateProfileId: profile.id,
          type:
            amount >= 0 ? CommissionLogType.CREDIT : CommissionLogType.DEBIT,
          amount: Math.abs(amount).toFixed(2),
          balanceAfter: newBalance.toFixed(2),
          description: reason
            ? `Manual adjustment by admin: ${reason}`
            : 'Manual adjustment by admin',
        }),
      );
    });
    return this.findOrFail(id);
  }

  /**
   * Downline affiliates keep their link (and their own commission); the
   * SA just earns nothing new. The code stays reserved so history stays
   * traceable; the email is freed for a new account.
   */
  async softDelete(id: string): Promise<void> {
    const profile = await this.findOrFail(id);
    await this.usersService.updateStatus(profile.userId, UserStatus.INACTIVE);
    await this.usersService.archiveEmailForReuse(profile.userId);
    await this.profileRepository.softDelete(profile.id);
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const profile = await this.findOrFail(id);
    await this.usersService.updatePasswordHash(
      profile.userId,
      await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS),
    );
  }

  private async downlineCounts(): Promise<Map<string, number>> {
    const rows: { id: string; count: string }[] = await this.affiliateRepository
      .createQueryBuilder('a')
      .select('a.super_affiliate_profile_id', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('a.super_affiliate_profile_id IS NOT NULL')
      .groupBy('a.super_affiliate_profile_id')
      .getRawMany();
    return new Map(rows.map((r) => [String(r.id), Number(r.count)]));
  }

  private async getDownlineItems(superAffiliateId: string) {
    const [affiliates, volumes] = await Promise.all([
      this.affiliateRepository.find({
        where: { superAffiliateProfileId: superAffiliateId },
        relations: { user: true },
        order: { createdAt: 'DESC' },
      }),
      this.monthVolumes(this.dataSource, superAffiliateId),
    ]);
    return affiliates.map((a) => ({
      affiliator_id: a.id,
      name: a.user?.name ?? null,
      email: a.user?.email ?? null,
      status: a.user?.status ?? null,
      affiliate_code: a.affiliateCode,
      month_volume: volumes.get(String(a.id)) ?? 0,
      joined_at: a.createdAt,
    }));
  }

  // ---- Super affiliate self-service ----

  private async findOwnOrFail(userId: string): Promise<SuperAffiliateProfile> {
    const profile = await this.profileRepository.findOne({
      where: { userId },
      relations: { user: true },
    });
    if (!profile) {
      throw new NotFoundException('Super affiliate profile not found');
    }
    if (profile.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Your super affiliate account is inactive.');
    }
    return profile;
  }

  async getDashboard(userId: string) {
    const profile = await this.findOwnOrFail(userId);
    const downline = await this.getDownlineItems(profile.id);
    return {
      ...toSuperAffiliateItem(profile),
      downline_count: downline.length,
      month: currentPeriodKey(),
      month_volume: sum(downline.map((a) => a.month_volume)).toFixed(2),
    };
  }

  async getOwnDownline(userId: string) {
    const profile = await this.findOwnOrFail(userId);
    return this.getDownlineItems(profile.id);
  }

  async getOwnCommissions(userId: string, limit: number, offset: number) {
    const profile = await this.findOwnOrFail(userId);
    const [logs, total] = await this.logRepository.findAndCount({
      where: { superAffiliateProfileId: profile.id },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items: logs.map(toLogItem), total, limit, offset };
  }

  async updateOwnBankDetails(
    userId: string,
    params: {
      bankName?: string;
      accountNumber?: string;
      accountHolder?: string;
      phoneNumber?: string;
    },
  ) {
    const profile = await this.findOwnOrFail(userId);
    const patch = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(patch).length) {
      await this.profileRepository.update(profile.id, patch);
    }
    const updated = await this.findOrFail(profile.id);
    return {
      bank_name: updated.bankName,
      account_number: updated.accountNumber,
      account_holder: updated.accountHolder,
      phone_number: updated.phoneNumber,
    };
  }

  async getOwnWithdrawals(userId: string) {
    const profile = await this.findOwnOrFail(userId);
    const withdrawals = await this.withdrawalRepository.find({
      where: { superAffiliateProfileId: profile.id },
      order: { createdAt: 'DESC' },
    });
    return withdrawals.map(toWithdrawalItem);
  }

  // ---- Withdrawals (same rules as AffiliatesService) ----

  /** Locks the amount immediately (balance -= amount) with a DEBIT log, like affiliate withdrawals. */
  async requestWithdrawal(
    userId: string,
    amount: number,
    payout: { method: WithdrawalMethod; momoUserId?: string },
  ): Promise<SuperAffiliateWithdrawal> {
    const isCoin = payout.method === WithdrawalMethod.MOMO_COIN;
    if (isCoin) {
      await assertMomoIdExists(this.provider, payout.momoUserId);
    }
    const settings = await this.settingsService.get();

    return this.dataSource.transaction(async (manager) => {
      const profile = await manager.findOne(SuperAffiliateProfile, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) {
        throw new NotFoundException('Super affiliate profile not found');
      }
      if (!(await isActiveUser(manager, userId))) {
        throw new ForbiddenException(
          'Your super affiliate account is inactive.',
        );
      }

      const balance = Number(profile.commissionBalance);
      const adminFee = Number(settings.withdrawalAdminFee);
      const netAmount = priceWithdrawal({
        balance,
        amount,
        minimumWithdrawal: Number(settings.minimumWithdrawalAmount),
        adminFee,
        isCoin,
      });

      const newBalance = balance - amount;
      await manager.update(SuperAffiliateProfile, profile.id, {
        commissionBalance: newBalance.toFixed(2),
      });
      const withdrawal = await insertWithOrderId(
        manager,
        SuperAffiliateWithdrawal,
        'SWD',
        {
          superAffiliateProfileId: profile.id,
          amount: amount.toFixed(2),
          adminFee: adminFee.toFixed(2),
          netAmount: netAmount.toFixed(2),
          method: payout.method,
          momoUserId: isCoin ? payout.momoUserId : null,
          bankName: isCoin ? null : profile.bankName,
          accountNumber: isCoin ? null : profile.accountNumber,
          accountHolder: isCoin ? null : profile.accountHolder,
          status: WithdrawalStatus.PENDING,
        },
      );
      await manager.save(
        manager.create(SuperAffiliateCommissionLog, {
          superAffiliateProfileId: profile.id,
          withdrawalId: withdrawal.id,
          type: CommissionLogType.DEBIT,
          amount: amount.toFixed(2),
          balanceAfter: newBalance.toFixed(2),
          description: `Withdrawal request ${withdrawal.id} locked`,
        }),
      );
      return withdrawal;
    });
  }

  async findAllWithdrawals(params: {
    status?: WithdrawalStatus;
    method?: WithdrawalMethod;
    superAffiliateId?: string;
    search?: string;
    limit: number;
    offset: number;
  }) {
    const qb = this.withdrawalRepository
      .createQueryBuilder('withdrawal')
      .leftJoinAndSelect('withdrawal.superAffiliate', 'superAffiliate')
      .leftJoinAndSelect('superAffiliate.user', 'user')
      .withDeleted()
      .orderBy('withdrawal.createdAt', 'DESC')
      .take(params.limit)
      .skip(params.offset);
    if (params.status) {
      qb.andWhere('withdrawal.status = :status', { status: params.status });
    }
    if (params.method) {
      qb.andWhere('withdrawal.method = :method', { method: params.method });
    }
    if (params.superAffiliateId) {
      qb.andWhere('withdrawal.superAffiliateProfileId = :saId', {
        saId: params.superAffiliateId,
      });
    }
    if (params.search) {
      qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', {
        search: `%${params.search}%`,
      });
    }
    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((w) => ({
        ...toWithdrawalItem(w),
        super_affiliate_name: w.superAffiliate?.user?.name ?? null,
        super_affiliate_email: w.superAffiliate?.user?.email ?? null,
      })),
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  private async findWithdrawalOrFail(
    id: string,
  ): Promise<SuperAffiliateWithdrawal> {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id },
    });
    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${id} not found`);
    }
    return withdrawal;
  }

  /** pending -> approved; nothing is sent yet (see markWithdrawalProcessed). */
  async approveWithdrawal(id: string, adminUserId: string) {
    const withdrawal = await this.findWithdrawalOrFail(id);
    const claimed = await this.withdrawalRepository.update(
      { id, status: WithdrawalStatus.PENDING },
      {
        status: WithdrawalStatus.APPROVED,
        approvedBy: adminUserId,
        approvedAt: new Date(),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException(
        `Withdrawal ${id} is not pending (current status: ${withdrawal.status})`,
      );
    }
    return toWithdrawalItem(await this.findWithdrawalOrFail(id));
  }

  /** approved -> paid. bank: after the manual transfer. momo_coin: sends the coins now. */
  async markWithdrawalProcessed(
    id: string,
    adminUserId: string,
    notes?: string,
  ) {
    const withdrawal = await this.findWithdrawalOrFail(id);
    if (withdrawal.method === WithdrawalMethod.MOMO_COIN) {
      await sendMomoCoinPayout(
        this.withdrawalRepository,
        this.provider,
        this.logger,
        withdrawal,
        adminUserId,
        notes,
        'SUPER_AFFILIATE_WITHDRAWAL',
      );
      return toWithdrawalItem(await this.findWithdrawalOrFail(id));
    }

    const claimed = await this.withdrawalRepository.update(
      { id, status: WithdrawalStatus.APPROVED },
      {
        status: WithdrawalStatus.PAID,
        processedBy: adminUserId,
        processedAt: new Date(),
        ...(notes && { adminNotes: notes }),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException(
        `Withdrawal ${id} is not approved (current status: ${withdrawal.status})`,
      );
    }
    return toWithdrawalItem(await this.findWithdrawalOrFail(id));
  }

  /** pending -> rejected, refunding the locked amount with a corrective CREDIT log. */
  async rejectWithdrawal(id: string, adminUserId: string) {
    const withdrawal = await this.findWithdrawalOrFail(id);
    await this.dataSource.transaction(async (manager) => {
      const claimed = await manager.update(
        SuperAffiliateWithdrawal,
        { id, status: WithdrawalStatus.PENDING },
        {
          status: WithdrawalStatus.REJECTED,
          processedBy: adminUserId,
          processedAt: new Date(),
        },
      );
      if (!claimed.affected) {
        throw new ConflictException(
          `Withdrawal ${id} is not pending (current status: ${withdrawal.status})`,
        );
      }
      const profile = await manager.findOne(SuperAffiliateProfile, {
        where: { id: withdrawal.superAffiliateProfileId },
        lock: { mode: 'pessimistic_write' },
        withDeleted: true,
      });
      if (!profile) {
        throw new NotFoundException(
          `Super affiliate ${withdrawal.superAffiliateProfileId} not found while refunding withdrawal ${id}`,
        );
      }
      const refunded =
        Number(profile.commissionBalance) + Number(withdrawal.amount);
      await manager.update(SuperAffiliateProfile, profile.id, {
        commissionBalance: refunded.toFixed(2),
      });
      await manager.save(
        manager.create(SuperAffiliateCommissionLog, {
          superAffiliateProfileId: profile.id,
          withdrawalId: id,
          type: CommissionLogType.CREDIT,
          amount: withdrawal.amount,
          balanceAfter: refunded.toFixed(2),
          description: `Refund for rejected withdrawal ${id}`,
        }),
      );
    });
    return toWithdrawalItem(await this.findWithdrawalOrFail(id));
  }
}

async function isActiveUser(
  manager: EntityManager,
  userId: string,
): Promise<boolean> {
  const user = await manager.findOne(User, { where: { id: userId } });
  return user?.status === UserStatus.ACTIVE;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function toSuperAffiliateItem(p: SuperAffiliateProfile) {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.user?.name ?? null,
    email: p.user?.email ?? null,
    status: p.user?.status ?? null,
    phone_number: p.phoneNumber,
    referral_code: p.referralCode,
    commission_rate: p.commissionRate,
    threshold_mode: p.thresholdMode,
    threshold_amount: p.thresholdAmount,
    commission_balance: p.commissionBalance,
    total_commission_earned: p.totalCommissionEarned,
    bank_name: p.bankName,
    account_number: p.accountNumber,
    account_holder: p.accountHolder,
    created_at: p.createdAt,
  };
}

function toLogItem(log: SuperAffiliateCommissionLog) {
  return {
    id: log.id,
    type: log.type,
    amount: log.amount,
    balance_after: log.balanceAfter,
    description: log.description,
    transaction_id: log.transactionId,
    affiliator_id: log.affiliatorId,
    withdrawal_id: log.withdrawalId,
    created_at: log.createdAt,
  };
}

function toWithdrawalItem(w: SuperAffiliateWithdrawal) {
  return {
    withdrawal_id: w.id,
    super_affiliate_id: w.superAffiliateProfileId,
    amount: w.amount,
    admin_fee: w.adminFee,
    net_amount: w.netAmount,
    method: w.method,
    momo_user_id: w.momoUserId,
    coin_amount: w.method === WithdrawalMethod.MOMO_COIN ? w.netAmount : null,
    bank_name: w.bankName,
    account_number: w.accountNumber,
    account_holder: w.accountHolder,
    status: w.status,
    admin_notes: w.adminNotes,
    approved_by: w.approvedBy,
    approved_at: w.approvedAt,
    processed_by: w.processedBy,
    processed_at: w.processedAt,
    created_at: w.createdAt,
  };
}
