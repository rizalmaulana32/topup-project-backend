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
import { DataSource, In, Repository } from 'typeorm';
import { insertWithOrderId } from '../common/utils/id-generator.util';
import {
  countByGroups,
  whereJakartaDate,
} from '../common/utils/list-query.util';
import {
  assertReferralCodeAvailable,
  generateUniqueReferralCode,
} from '../common/utils/referral-code.util';
import { AdminProfile } from '../manual-topup/entities/admin-profile.entity';
import { SuperAffiliateProfile } from '../super-affiliates/entities/super-affiliate-profile.entity';
import { PROVIDER_TOP_UP_PORT } from '../provider/provider-top-up.port';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import { SettingsService } from '../settings/settings.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { RegisterAffiliateDto } from './dto/register-affiliate.dto';
import { filterHistory, type HistoryFilter } from './history-filter.util';
import {
  calculateTieredCommissionRate,
  currentPeriodKey,
  monthPayoutPeriods,
} from './tiered-commission.util';
import { AffiliatorProfile } from './entities/affiliator-profile.entity';
import {
  CommissionLog,
  CommissionLogType,
} from './entities/commission-log.entity';
import {
  CommissionWithdrawal,
  WithdrawalMethod,
  WithdrawalStatus,
} from './entities/commission-withdrawal.entity';
import {
  assertMomoIdExists,
  priceWithdrawal,
  WITHDRAWAL_STATUS_GROUPS,
} from './withdrawal.util';

const BCRYPT_SALT_ROUNDS = 10;

/** The account a registration referral code points at - an affiliate has at most one. */
export type Upline =
  | { kind: 'admin'; profile: AdminProfile }
  | { kind: 'super_affiliate'; profile: SuperAffiliateProfile };

@Injectable()
export class AffiliatesService {
  private readonly logger = new Logger(AffiliatesService.name);

  constructor(
    @InjectRepository(AffiliatorProfile)
    private readonly profileRepository: Repository<AffiliatorProfile>,
    @InjectRepository(CommissionLog)
    private readonly commissionLogRepository: Repository<CommissionLog>,
    @InjectRepository(CommissionWithdrawal)
    private readonly withdrawalRepository: Repository<CommissionWithdrawal>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly transactionsService: TransactionsService,
    private readonly settingsService: SettingsService,
    @Inject(PROVIDER_TOP_UP_PORT)
    private readonly provider: ProviderTopUpPort,
  ) {}

  async isEmailRegistered(email: string): Promise<boolean> {
    const user = await this.usersService.findByEmail(email);
    return user !== null;
  }

  /**
   * Finds the active, non-deleted admin or super affiliate owning a
   * registration referral code, or null. Codes are unique across both
   * tables (see referral-code.util.ts), so at most one can match.
   */
  async findUpline(code: string): Promise<Upline | null> {
    const admin = await this.dataSource.getRepository(AdminProfile).findOne({
      where: { referralCode: code },
      relations: { user: true },
    });
    if (admin) {
      return admin.user.status === UserStatus.ACTIVE
        ? { kind: 'admin', profile: admin }
        : null;
    }
    const superAffiliate = await this.dataSource
      .getRepository(SuperAffiliateProfile)
      .findOne({ where: { referralCode: code }, relations: { user: true } });
    return superAffiliate?.user.status === UserStatus.ACTIVE
      ? { kind: 'super_affiliate', profile: superAffiliate }
      : null;
  }

  private async findUplineOrFail(code: string): Promise<Upline> {
    const upline = await this.findUpline(code);
    if (!upline) {
      throw new BadRequestException(`Referral code ${code} is not valid`);
    }
    return upline;
  }

  /** Public pre-check for the optional registration referral code. */
  async checkRegistrationReferralCode(code: string) {
    const upline = await this.findUpline(code);
    return {
      valid: upline !== null,
      type: upline?.kind ?? null,
      name: upline?.profile.user.name ?? null,
    };
  }

  /**
   * Superadmin moves an affiliate under another admin/super affiliate (by
   * its referral code), or detaches them with null. Only future
   * transactions are affected.
   */
  async moveUpline(
    profileId: string,
    referralCode: string | null,
  ): Promise<AffiliatorProfile> {
    const profile = await this.findProfileByIdOrFail(profileId);
    const upline = referralCode
      ? await this.findUplineOrFail(referralCode)
      : null;
    await this.profileRepository.update(profile.id, uplineColumns(upline));
    return this.findProfileByIdOrFail(profileId);
  }

  async register(dto: RegisterAffiliateDto) {
    // Resolved before the user row is created, so a bad code leaves nothing behind.
    const upline = dto.referral_code
      ? await this.findUplineOrFail(dto.referral_code)
      : null;

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const settings = await this.settingsService.get();

    const user = await this.usersService.createUser({
      name: dto.name,
      email: dto.email,
      passwordHash,
      role: UserRole.AFFILIATOR,
      status: UserStatus.PENDING_APPROVAL,
    });

    const profile = this.profileRepository.create({
      userId: user.id,
      bankName: dto.bank_name,
      accountNumber: dto.account_number,
      accountHolder: dto.account_holder,
      phoneNumber: dto.phone_number,
      commissionRate: settings.globalCommissionRate,
      ...uplineColumns(upline),
    });
    await this.profileRepository.save(profile);

    return {
      user_id: user.id,
      email: user.email,
      status: user.status,
      message:
        'Registration received. Your account is pending superadmin approval.',
    };
  }

  /** The logged-in affiliate's own profile; only once approved. */
  async findActiveProfileForUser(userId: string): Promise<AffiliatorProfile> {
    const profile = await this.profileRepository.findOne({
      where: { userId },
      relations: { user: true },
    });

    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    if (profile.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(
        'Your affiliate application is pending superadmin approval.',
      );
    }
    return profile;
  }

  /** referred_transactions + commission_history items, newest first. */
  private async getHistory(profile: AffiliatorProfile) {
    const referredTransactions = profile.affiliateCode
      ? await this.transactionsService.findByReferralCode(profile.affiliateCode)
      : [];
    const commissionHistory = await this.commissionLogRepository.find({
      where: { affiliatorId: profile.id },
      order: { createdAt: 'DESC' },
    });
    const { historyItem, referred } = await this.buildHistoryInfo(
      profile.affiliateCode,
      referredTransactions,
      commissionHistory,
    );
    return { referred, commissions: commissionHistory.map(historyItem) };
  }

  /** One filtered page of referred_transactions (gateway + manual). */
  async listReferredTransactions(
    profile: AffiliatorProfile,
    filter: HistoryFilter,
  ) {
    const { referred } = await this.getHistory(profile);
    return filterHistory(
      referred,
      filter,
      (t) => t.gross_amount,
      (t) => [t.transaction_id, t.target_user_id, t.username],
    );
  }

  /** One filtered page of commission_history (credits, withdrawal debits). */
  async listCommissionHistory(
    profile: AffiliatorProfile,
    filter: HistoryFilter,
  ) {
    const { commissions } = await this.getHistory(profile);
    return filterHistory(
      commissions,
      filter,
      (c) => c.amount,
      (c) => [
        c.description,
        c.transaction_id,
        c.target_user_id,
        c.username,
        c.withdrawal?.withdrawal_id,
      ],
    );
  }

  async getDashboard(userId: string) {
    const profile = await this.findActiveProfileForUser(userId);
    const { referred, commissions } = await this.getHistory(profile);

    return {
      affiliate_code: profile.affiliateCode,
      bank_name: profile.bankName,
      account_number: profile.accountNumber,
      account_holder: profile.accountHolder,
      phone_number: profile.phoneNumber,
      commission_balance: profile.commissionBalance,
      total_commission_earned: profile.totalCommissionEarned,
      referred_transaction_count: referred.length,
      referred_transactions: referred,
      commission_history: commissions,
    };
  }

  /** Admin-facing full detail view for one affiliate (client request via Ricky 2026-11-02: "penambahan detail informasi affiliate"). */
  async getAdminAffiliateDetail(profileId: string) {
    const profile = await this.findProfileByIdOrFail(profileId);
    const { referred, commissions } = await this.getHistory(profile);

    const withdrawals = await this.withdrawalRepository.find({
      where: { affiliatorId: profile.id },
      order: { createdAt: 'DESC' },
    });

    return {
      profile_id: profile.id,
      user_id: profile.userId,
      name: profile.user.name,
      email: profile.user.email,
      status: profile.user.status,
      phone_number: profile.phoneNumber,
      affiliate_code: profile.affiliateCode,
      bank_name: profile.bankName,
      account_number: profile.accountNumber,
      account_holder: profile.accountHolder,
      commission_rate: profile.commissionRate,
      commission_balance: profile.commissionBalance,
      total_commission_earned: profile.totalCommissionEarned,
      tiered_commission_enabled: profile.tieredCommissionEnabled,
      current_period_volume: profile.currentPeriodVolume,
      current_period_month: profile.currentPeriodMonth,
      admin: toLinkedAdmin(profile.adminProfile),
      super_affiliate: toLinkedSuperAffiliate(profile.superAffiliateProfile),
      approved_by: profile.approvedBy,
      approved_at: profile.approvedAt,
      created_at: profile.createdAt,
      referred_transaction_count: referred.length,
      referred_transactions: referred,
      commission_history: commissions,
      withdrawals: withdrawals.map((withdrawal) => ({
        withdrawal_id: withdrawal.id,
        method: withdrawal.method,
        momo_user_id: withdrawal.momoUserId,
        amount: withdrawal.amount,
        admin_fee: withdrawal.adminFee,
        net_amount: withdrawal.netAmount,
        status: withdrawal.status,
        created_at: withdrawal.createdAt,
      })),
    };
  }

  /**
   * Shared enrichment for referred_transactions and commission_history:
   * - momoInfo(transactionId): the Momo customer a transaction topped up
   *   (ID, username, avatar - same data as POST /topup/check-id)
   * - historyItem(log): a commission_history entry, with that Momo info for
   *   commission credits and a `withdrawal` object (bank or Momo coin payout)
   *   for withdrawal debits/refunds.
   */
  /** POST /topup/check-id per distinct Momo ID; a failed lookup maps to null. */
  async lookupMomoUsers(ids: Iterable<string>) {
    return new Map(
      await Promise.all(
        [...new Set(ids)].map(async (id) => {
          try {
            return [id, await this.provider.checkId('', id)] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      ),
    );
  }

  /**
   * Successful manual top-up sends (ManualTopupService) made under `code`,
   * plus any whose key is in `keys` (commission logs under an older code).
   * id matches manualTopupSendKey() / the commission log transaction_id.
   */
  private async findManualSends(
    code: string | null,
    keys: string[],
  ): Promise<
    {
      id: string;
      referral_code: string | null;
      momo_user_id: string;
      amount: string;
      sent_at: Date;
    }[]
  > {
    if (!code && !keys.length) return [];
    return this.dataSource.query(
      `SELECT m.id || '#' || s.id AS id, m.referral_code, m.momo_user_id,
              s.amount, s.sent_at
       FROM manual_topup_sends s
       JOIN manual_topups m ON m.id = s.manual_topup_id
       WHERE s.status = 'success'
         AND (m.referral_code = $1 OR m.id || '#' || s.id = ANY($2))
       ORDER BY s.sent_at DESC`,
      [code, keys],
    );
  }

  private async buildHistoryInfo(
    affiliateCode: string | null,
    referredTransactions: Transaction[],
    commissionHistory: CommissionLog[],
  ) {
    const idsOf = (key: 'transactionId' | 'withdrawalId') =>
      commissionHistory
        .map((log) => log[key])
        .filter((id): id is string => id !== null);

    // Commission logs can point at transactions made under an older referral
    // code (the code is editable), so they're loaded by ID, not via referredTransactions.
    const [commissionTransactions, withdrawals, manualSends] =
      await Promise.all([
        this.transactionsService.findByIds(idsOf('transactionId')),
        idsOf('withdrawalId').length
          ? this.withdrawalRepository.find({
              where: { id: In(idsOf('withdrawalId')) },
            })
          : Promise.resolve([]),
        this.findManualSends(
          affiliateCode,
          idsOf('transactionId').filter((id) => id.includes('#')),
        ),
      ]);
    const targetUserIdByTransaction = new Map([
      ...[...referredTransactions, ...commissionTransactions].map(
        (t) => [t.id, t.targetUserId] as const,
      ),
      ...manualSends.map((m) => [m.id, m.momo_user_id] as const),
    ]);
    const withdrawalById = new Map(withdrawals.map((w) => [w.id, w]));

    // Same lookup as POST /topup/check-id, once per distinct Momo ID; a failed
    // lookup yields null instead of failing the whole response.
    // ponytail: one live provider call per distinct customer per page view;
    // store the username at checkout if affiliates get large or MomoLive rate-limits.
    const momoIds = new Set([
      ...targetUserIdByTransaction.values(),
      ...withdrawals
        .map((w) => w.momoUserId)
        .filter((id): id is string => id !== null),
    ]);
    const momoUsers = await this.lookupMomoUsers(momoIds);

    const momoInfo = (transactionId: string | null) => {
      const targetUserId = transactionId
        ? (targetUserIdByTransaction.get(transactionId) ?? null)
        : null;
      const user = targetUserId ? momoUsers.get(targetUserId) : null;
      return {
        target_user_id: targetUserId,
        username: user?.username ?? null,
        avatar_url: user?.avatarUrl ?? null,
      };
    };

    const withdrawalInfo = (withdrawalId: string | null) => {
      const w = withdrawalId ? withdrawalById.get(withdrawalId) : undefined;
      if (!w) return null;
      const isCoin = w.method === WithdrawalMethod.MOMO_COIN;
      const momoUser = w.momoUserId ? momoUsers.get(w.momoUserId) : null;
      return {
        withdrawal_id: w.id,
        method: w.method,
        status: w.status,
        amount: w.amount,
        admin_fee: w.adminFee,
        net_amount: w.netAmount,
        coin_amount: isCoin ? w.netAmount : null,
        momo_user_id: w.momoUserId,
        momo_username: momoUser?.username ?? null,
        momo_avatar_url: momoUser?.avatarUrl ?? null,
        bank_name: w.bankName,
        account_number: w.accountNumber,
        account_holder: w.accountHolder,
      };
    };

    const historyItem = (log: CommissionLog) => ({
      type: log.type,
      amount: log.amount,
      balance_after: log.balanceAfter,
      description: log.description,
      transaction_id: log.transactionId,
      ...momoInfo(log.transactionId),
      withdrawal: withdrawalInfo(log.withdrawalId),
      created_at: log.createdAt,
    });

    // Gateway checkouts and successful manual sends under the current code, newest first.
    const referred = [
      ...referredTransactions.map((transaction) => ({
        transaction_id: transaction.id,
        source: 'gateway' as const,
        ...momoInfo(transaction.id),
        payment_status: transaction.paymentStatus,
        gross_amount: transaction.grossAmount,
        created_at: transaction.createdAt,
      })),
      ...manualSends
        .filter((m) => affiliateCode && m.referral_code === affiliateCode)
        .map((m) => ({
          transaction_id: m.id,
          source: 'manual' as const,
          ...momoInfo(m.id),
          payment_status: 'paid',
          gross_amount: m.amount,
          created_at: new Date(m.sent_at),
        })),
    ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    return { historyItem, referred };
  }

  async findProfileByIdOrFail(profileId: string): Promise<AffiliatorProfile> {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: { user: true },
    });
    if (profile?.adminProfileId) {
      // Loaded separately so a soft-deleted admin still shows up.
      profile.adminProfile = await this.dataSource
        .getRepository(AdminProfile)
        .findOne({
          where: { id: profile.adminProfileId },
          relations: { user: true },
          withDeleted: true,
        });
    }
    if (profile?.superAffiliateProfileId) {
      profile.superAffiliateProfile = await this.dataSource
        .getRepository(SuperAffiliateProfile)
        .findOne({
          where: { id: profile.superAffiliateProfileId },
          relations: { user: true },
          withDeleted: true,
        });
    }
    if (!profile) {
      throw new NotFoundException(`Affiliate profile ${profileId} not found`);
    }
    return profile;
  }

  async approve(
    profileId: string,
    adminUserId: string,
    customReferralCode?: string,
  ): Promise<AffiliatorProfile> {
    const profile = await this.findProfileByIdOrFail(profileId);

    if (customReferralCode) {
      profile.affiliateCode = await assertReferralCodeAvailable(
        this.dataSource,
        customReferralCode,
        { table: 'affiliator_profiles', id: profile.id },
      );
    } else if (!profile.affiliateCode) {
      profile.affiliateCode = await generateUniqueReferralCode(
        this.dataSource,
        'AFF',
      );
    }
    profile.approvedBy = adminUserId;
    profile.approvedAt = new Date();
    await this.profileRepository.save(profile);
    await this.usersService.updateStatus(profile.userId, UserStatus.ACTIVE);

    return this.findProfileByIdOrFail(profileId);
  }

  /**
   * Changes an affiliate's referral code without touching approval state
   * (approved_by/approved_at) or account status - unlike reusing approve()
   * for this, which would silently overwrite the original approval
   * timestamp/admin every time someone just wants to edit the code.
   */
  async updateReferralCode(
    profileId: string,
    newCode: string,
  ): Promise<AffiliatorProfile> {
    const profile = await this.findProfileByIdOrFail(profileId);

    profile.affiliateCode = await assertReferralCodeAvailable(
      this.dataSource,
      newCode,
      { table: 'affiliator_profiles', id: profile.id },
    );
    await this.profileRepository.save(profile);
    return profile;
  }

  async reject(profileId: string): Promise<void> {
    const profile = await this.findProfileByIdOrFail(profileId);
    await this.usersService.updateStatus(profile.userId, UserStatus.INACTIVE);
  }

  /**
   * Soft-deletes an affiliate profile and deactivates the underlying user,
   * mirroring the existing soft-delete pattern used for products/contact
   * messages (deleted_at, excluded from normal find/findOne automatically).
   * Kept as soft delete rather than hard delete since commission_logs and
   * commission_withdrawals reference affiliator_id - hard-deleting would
   * either violate no real FK constraint (they're plain columns, not
   * enforced relations) but would still orphan real financial history for
   * no reason. The referral code is intentionally left in place (not
   * cleared) so historical transactions/commission_logs referencing it
   * remain traceable.
   *
   * The user's email is archived (not cleared) so it's immediately free
   * for a brand new registration - without this, the deleted affiliate's
   * own old account permanently blocks that email from ever registering
   * again via the unique constraint (confirmed as a real "Email already
   * registered" 409 2026-10-10).
   */
  async softDelete(profileId: string): Promise<void> {
    const profile = await this.findProfileByIdOrFail(profileId);
    await this.usersService.updateStatus(profile.userId, UserStatus.INACTIVE);
    await this.usersService.archiveEmailForReuse(profile.userId);
    await this.profileRepository.softDelete(profileId);
  }

  /**
   * Checks whether a given affiliate/referral code is currently valid -
   * i.e. it exists AND the owning affiliate's account is active. Mirrors
   * the exact same check creditCommissionForTransaction uses internally
   * (referralCode match + user.status === ACTIVE), so "valid" here means
   * precisely "would actually earn commission if used at checkout right
   * now", not just "this code was issued at some point".
   */
  async checkCodeValidity(
    code: string,
  ): Promise<{ valid: boolean; affiliateName: string | null }> {
    const profile = await this.profileRepository.findOne({
      where: { affiliateCode: code },
      relations: { user: true },
    });

    if (!profile || profile.user.status !== UserStatus.ACTIVE) {
      return { valid: false, affiliateName: null };
    }

    return { valid: true, affiliateName: profile.user.name };
  }

  async updateCommissionRate(
    profileId: string,
    commissionRate: number,
  ): Promise<AffiliatorProfile> {
    const profile = await this.findProfileByIdOrFail(profileId);
    profile.commissionRate = commissionRate.toFixed(2);
    return this.profileRepository.save(profile);
  }

  /**
   * Manual commission-balance adjustment (client request via Ricky
   * 2026-11-02: "tambahkan manual komisi ke afiliate nominal, bisa
   * mengurangi atau menambah") - amount is added to commission_balance,
   * pass a negative number to deduct. Logged as a normal CommissionLog
   * entry (CREDIT/DEBIT depending on sign) so it shows up in the
   * affiliate's own commission history exactly like a real transaction
   * credit, not silently.
   */
  async adjustCommissionBalance(
    profileId: string,
    amount: number,
    reason?: string,
  ): Promise<AffiliatorProfile> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const profile = await queryRunner.manager.findOne(AffiliatorProfile, {
        where: { id: profileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) {
        throw new NotFoundException(`Affiliate profile ${profileId} not found`);
      }

      const newBalance = Number(profile.commissionBalance) + amount;
      if (newBalance < 0) {
        throw new BadRequestException(
          `Resulting commission balance would be negative (current: ${profile.commissionBalance}, delta: ${amount})`,
        );
      }
      const newTotalEarned =
        amount > 0
          ? Number(profile.totalCommissionEarned) + amount
          : Number(profile.totalCommissionEarned);

      await queryRunner.manager.update(AffiliatorProfile, profile.id, {
        commissionBalance: newBalance.toFixed(2),
        totalCommissionEarned: newTotalEarned.toFixed(2),
      });

      const log = queryRunner.manager.create(CommissionLog, {
        affiliatorId: profile.id,
        type: amount >= 0 ? CommissionLogType.CREDIT : CommissionLogType.DEBIT,
        amount: Math.abs(amount).toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        description: reason
          ? `Manual adjustment by admin: ${reason}`
          : 'Manual adjustment by admin',
      });
      await queryRunner.manager.save(log);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return this.findProfileByIdOrFail(profileId);
  }

  /**
   * Toggles the opt-in tiered-commission mode (see tiered-commission.util.ts)
   * for one affiliate. While enabled, commissionRate above is ignored by
   * creditCommissionForTransaction in favor of the 1%/5% volume tiers.
   * Disabling does not clear currentPeriodVolume/Month - re-enabling later
   * in the same calendar month picks the running total back up rather than
   * silently resetting it.
   */
  async setTieredCommissionEnabled(
    profileId: string,
    enabled: boolean,
  ): Promise<AffiliatorProfile> {
    const profile = await this.findProfileByIdOrFail(profileId);
    profile.tieredCommissionEnabled = enabled;
    return this.profileRepository.save(profile);
  }

  /**
   * Admin-side password reset for an affiliate who's locked out - there is
   * no self-service "forgot password" flow (Ricky, 2026-10-31), so this is
   * the only way back in until one exists.
   */
  async resetPassword(profileId: string, newPassword: string): Promise<void> {
    const profile = await this.findProfileByIdOrFail(profileId);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await this.usersService.updatePasswordHash(profile.userId, passwordHash);
  }

  /**
   * Lets an affiliate add/update their own bank payout details after
   * registration - previously there was no way to do this at all once
   * registered (client-reported gap). Only affects the profile itself;
   * a withdrawal already requested keeps the bank details it captured at
   * request time (see requestWithdrawal), so this can't retroactively
   * change where a pending payout is headed.
   */
  async updateBankDetails(
    userId: string,
    params: {
      bankName?: string;
      accountNumber?: string;
      accountHolder?: string;
      phoneNumber?: string;
    },
  ): Promise<AffiliatorProfile> {
    const profile = await this.profileRepository.findOne({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Affiliate profile not found');
    }

    if (params.bankName !== undefined) {
      profile.bankName = params.bankName;
    }
    if (params.accountNumber !== undefined) {
      profile.accountNumber = params.accountNumber;
    }
    if (params.accountHolder !== undefined) {
      profile.accountHolder = params.accountHolder;
    }
    if (params.phoneNumber !== undefined) {
      profile.phoneNumber = params.phoneNumber;
    }

    return this.profileRepository.save(profile);
  }

  /** Rate this transaction earns: the flat commissionRate, or the month's tier when tiered mode is on. */
  private effectiveRate(profile: AffiliatorProfile, originalAmount: number) {
    if (!profile.tieredCommissionEnabled) {
      return {
        effectiveRate: Number(profile.commissionRate),
        periodUpdate: null,
      };
    }
    const periodKey = currentPeriodKey();
    const periodVolumeBefore =
      profile.currentPeriodMonth === periodKey
        ? Number(profile.currentPeriodVolume)
        : 0;
    const periodVolumeAfter = periodVolumeBefore + originalAmount;
    return {
      effectiveRate: calculateTieredCommissionRate(periodVolumeAfter),
      periodUpdate: {
        currentPeriodVolume: periodVolumeAfter.toFixed(2),
        currentPeriodMonth: periodKey,
      },
    };
  }

  /**
   * The affiliate's commission on this transaction BEFORE the bonus coin is
   * deducted, without crediting anything. Compared against the super
   * affiliate's commission to decide who absorbs the bonus.
   * ponytail: unlocked read - a concurrent credit can move the tier between
   * this and creditCommissionForTransaction; lock both in one transaction if
   * that edge ever matters.
   */
  async grossCommission(
    referralCode: string,
    originalAmount: string,
  ): Promise<number> {
    const profile = await this.profileRepository.findOne({
      where: { affiliateCode: referralCode },
    });
    if (!profile) return 0;
    const amount = Number(originalAmount);
    return (amount * this.effectiveRate(profile, amount).effectiveRate) / 100;
  }

  /**
   * Credits commission for a referred, successfully fulfilled transaction.
   * Uses a pessimistic row lock on the affiliate profile (per the source
   * document's race-condition requirement) so concurrent credits/debits
   * cannot corrupt the balance. No-op (returns "0.00") if the referral code
   * does not match an active affiliate. Returns the actual amount credited
   * so callers (TopupService, for PlatformService.creditRevenueForTransaction)
   * know exactly how much commission was paid out on this transaction.
   */
  async creditCommissionForTransaction(params: {
    referralCode: string;
    transactionId: string;
    originalAmount: string;
    /** Bonus coin (Rupiah, 1:1) the customer received - charged to this commission. */
    bonusDeduction?: string;
  }): Promise<string> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Locked without a joined relation: Postgres FOR UPDATE cannot safely
      // apply across a LEFT JOIN, so the affiliate's user status is checked
      // with a separate, unlocked read using the already-known userId.
      const profile = await queryRunner.manager.findOne(AffiliatorProfile, {
        where: { affiliateCode: params.referralCode },
        lock: { mode: 'pessimistic_write' },
      });
      const user = profile
        ? await queryRunner.manager.findOne(User, {
            where: { id: profile.userId },
          })
        : null;

      if (!profile || user?.status !== UserStatus.ACTIVE) {
        await queryRunner.rollbackTransaction();
        this.logger.warn(
          `No active affiliate for referral code ${params.referralCode}; skipping commission credit for ${params.transactionId}.`,
        );
        return '0.00';
      }

      // The customer's bonus coin on a referred top-up is charged to the
      // affiliate (client via Ricky 2026-11-05): e.g. Rp1.000.000 at 5% =
      // 50.000 commission, minus the 20.000 bonus = 30.000. Floored at 0 -
      // if the bonus exceeds the commission, the platform absorbs the rest
      // (confirmed with Ricky 2026-11-05) rather than the balance going
      // negative.
      // When the super affiliate's commission is bigger, the caller charges
      // the bonus to them instead and passes 0 here (2026-11-17).
      const bonusDeduction = Number(params.bonusDeduction ?? 0);
      const originalAmount = Number(params.originalAmount);
      const { effectiveRate, periodUpdate } = this.effectiveRate(
        profile,
        originalAmount,
      );

      const commissionAmount = Math.max(
        0,
        (originalAmount * effectiveRate) / 100 - bonusDeduction,
      );
      const newBalance = Number(profile.commissionBalance) + commissionAmount;
      const newTotalEarned =
        Number(profile.totalCommissionEarned) + commissionAmount;

      await queryRunner.manager.update(AffiliatorProfile, profile.id, {
        commissionBalance: newBalance.toFixed(2),
        totalCommissionEarned: newTotalEarned.toFixed(2),
        ...periodUpdate,
      });

      const log = queryRunner.manager.create(CommissionLog, {
        affiliatorId: profile.id,
        transactionId: params.transactionId,
        type: CommissionLogType.CREDIT,
        amount: commissionAmount.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        description: `Commission for referred transaction ${params.transactionId} (${effectiveRate}% of ${originalAmount.toFixed(2)} - bonus ${bonusDeduction.toFixed(2)})`,
      });
      await queryRunner.manager.save(log);

      await queryRunner.manager.update(Transaction, params.transactionId, {
        affiliateCommission: commissionAmount.toFixed(2),
      });

      await queryRunner.commitTransaction();
      return commissionAmount.toFixed(2);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Locks the requested amount immediately (balance -= amount) and records
   * the debit ledger entry at this point, matching the source document's
   * "Kunci Nominal Saldo" step. A later LinkQu failure/callback refunds
   * the balance with a corrective credit entry; a success outcome needs
   * no further ledger entry since the debit is already accurate.
   */
  async requestWithdrawal(
    userId: string,
    amount: number,
    payout: { method: WithdrawalMethod; momoUserId?: string } = {
      method: WithdrawalMethod.BANK,
    },
  ): Promise<CommissionWithdrawal> {
    const isCoin = payout.method === WithdrawalMethod.MOMO_COIN;
    if (isCoin) {
      await assertMomoIdExists(this.provider, payout.momoUserId);
    }

    const settings = await this.settingsService.get();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const profile = await queryRunner.manager.findOne(AffiliatorProfile, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!profile) {
        throw new NotFoundException('Affiliate profile not found');
      }

      const user = await queryRunner.manager.findOne(User, {
        where: { id: userId },
      });
      if (user?.status !== UserStatus.ACTIVE) {
        throw new ForbiddenException(
          'Your affiliate application is pending superadmin approval.',
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
      await queryRunner.manager.update(AffiliatorProfile, profile.id, {
        commissionBalance: newBalance.toFixed(2),
      });

      const withdrawal = await insertWithOrderId(
        queryRunner.manager,
        CommissionWithdrawal,
        'WDW',
        {
          affiliatorId: profile.id,
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

      const log = queryRunner.manager.create(CommissionLog, {
        affiliatorId: profile.id,
        withdrawalId: withdrawal.id,
        type: CommissionLogType.DEBIT,
        amount: amount.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        description: `Withdrawal request ${withdrawal.id} locked`,
      });
      await queryRunner.manager.save(log);

      await queryRunner.commitTransaction();
      return withdrawal;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findWithdrawalByIdOrFail(
    withdrawalId: string,
  ): Promise<CommissionWithdrawal> {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id: withdrawalId },
    });
    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} not found`);
    }
    return withdrawal;
  }

  /**
   * Approves a withdrawal request (SRS/per Ricky, 2026-10-23: approval no
   * longer triggers a real LinkQu disbursement - the client found LinkQu's
   * synchronous disbursement failing in production (SALDO TIDAK CUKUP on
   * WDW-20261011-8196) too disruptive, and wants the actual bank transfer
   * done manually outside the system instead). This step only records that
   * an admin has signed off; see markWithdrawalProcessed for the second
   * step once the manual transfer is actually done.
   *
   * momo_coin works the same way (per Ricky, 2026-11-07): approval only lands
   * on APPROVED; the coins are sent by markWithdrawalProcessed.
   */
  async approveWithdrawal(
    withdrawalId: string,
    adminUserId: string,
  ): Promise<CommissionWithdrawal> {
    const withdrawal = await this.findWithdrawalByIdOrFail(withdrawalId);

    // Conditional update so two concurrent approvals can't both pass the status check.
    const claimed = await this.withdrawalRepository.update(
      { id: withdrawalId, status: WithdrawalStatus.PENDING },
      {
        status: WithdrawalStatus.APPROVED,
        approvedBy: adminUserId,
        approvedAt: new Date(),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException(
        `Withdrawal ${withdrawalId} is not pending (current status: ${withdrawal.status})`,
      );
    }

    return this.findWithdrawalByIdOrFail(withdrawalId);
  }

  /**
   * Marks an approved withdrawal as paid. `notes` is meant for a transfer
   * reference/proof so the paid record isn't just a bare timestamp.
   *
   * bank: the admin has already transferred the funds manually (see
   * approveWithdrawal's doc comment for why).
   *
   * momo_coin: same - the admin sends the coins manually in MomoLive (client
   * 2026-11-15: "nanti akan dikirim manual"); nothing is sent from here.
   *
   * Conditional APPROVED -> PAID update, so it succeeds exactly once: a double
   * click, retry or concurrent call gets 409 (client 2026-11-15: "validasi
   * hanya 1 kali").
   */
  async markWithdrawalProcessed(
    withdrawalId: string,
    adminUserId: string,
    notes?: string,
  ): Promise<CommissionWithdrawal> {
    const withdrawal = await this.findWithdrawalByIdOrFail(withdrawalId);
    const claimed = await this.withdrawalRepository.update(
      { id: withdrawalId, status: WithdrawalStatus.APPROVED },
      {
        status: WithdrawalStatus.PAID,
        processedBy: adminUserId,
        processedAt: new Date(),
        ...(notes && { adminNotes: notes }),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException(
        `Withdrawal ${withdrawalId} is not approved (current status: ${withdrawal.status})`,
      );
    }
    return this.findWithdrawalByIdOrFail(withdrawalId);
  }

  /**
   * Declines a withdrawal before it's ever sent to LinkQu (e.g. bad bank
   * details, suspected fraud) and refunds the locked balance. Distinct from
   * a LinkQu-side failure, which happens after approval.
   */
  async rejectWithdrawal(
    withdrawalId: string,
    adminUserId: string,
  ): Promise<CommissionWithdrawal> {
    const withdrawal = await this.findWithdrawalByIdOrFail(withdrawalId);

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new ConflictException(
        `Withdrawal ${withdrawalId} is not pending (current status: ${withdrawal.status})`,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Conditional, so a concurrent approval (which may be sending Momo
      // coins) and this refund can't both go through.
      const claimed = await queryRunner.manager.update(
        CommissionWithdrawal,
        { id: withdrawal.id, status: WithdrawalStatus.PENDING },
        {
          status: WithdrawalStatus.REJECTED,
          processedBy: adminUserId,
          processedAt: new Date(),
        },
      );
      if (!claimed.affected) {
        throw new ConflictException(
          `Withdrawal ${withdrawalId} is no longer pending`,
        );
      }

      const profile = await queryRunner.manager.findOne(AffiliatorProfile, {
        where: { id: withdrawal.affiliatorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) {
        throw new NotFoundException(
          `Affiliate profile ${withdrawal.affiliatorId} not found while refunding withdrawal ${withdrawal.id}`,
        );
      }

      const refundedBalance =
        Number(profile.commissionBalance) + Number(withdrawal.amount);
      await queryRunner.manager.update(AffiliatorProfile, profile.id, {
        commissionBalance: refundedBalance.toFixed(2),
      });

      const log = queryRunner.manager.create(CommissionLog, {
        affiliatorId: profile.id,
        withdrawalId: withdrawal.id,
        type: CommissionLogType.CREDIT,
        amount: withdrawal.amount,
        balanceAfter: refundedBalance.toFixed(2),
        description: `Refund for rejected withdrawal ${withdrawal.id}`,
      });
      await queryRunner.manager.save(log);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return this.findWithdrawalByIdOrFail(withdrawalId);
  }

  /**
   * Called by the LinkQu disbursement callback controller once the
   * callback signature has already been verified. Now genuinely reachable
   * (unlike under Duitku, which had no callback at all for the product
   * this app used) - a withdrawal that approveWithdrawal parked in
   * `approved` because LinkQu returned PENDING gets resolved here.
   * Idempotent: a withdrawal not in `approved` status is ignored (already
   * resolved synchronously, or never sent).
   */
  async handleDisbursementCallback(
    referenceId: string,
    linkQuStatus: string,
  ): Promise<void> {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id: referenceId },
    });

    if (!withdrawal) {
      this.logger.warn(
        `LinkQu disbursement callback for unknown withdrawal ${referenceId}`,
      );
      return;
    }
    if (withdrawal.status !== WithdrawalStatus.APPROVED) {
      this.logger.warn(
        `Duplicate/unexpected disbursement callback for ${referenceId} (status: ${withdrawal.status}), ignoring.`,
      );
      return;
    }

    if (linkQuStatus === 'SUCCESS') {
      withdrawal.status = WithdrawalStatus.PAID;
      await this.withdrawalRepository.save(withdrawal);
      return;
    }

    if (linkQuStatus !== 'FAILED') {
      this.logger.log(
        `LinkQu disbursement callback for ${referenceId} with non-final status ${linkQuStatus} - no action taken.`,
      );
      return;
    }

    await this.refundFailedWithdrawal(
      withdrawal,
      `LinkQu disbursement failed (LinkQu status: ${linkQuStatus})`,
    );
  }

  /**
   * Refunds a withdrawal's locked balance and marks it FAILED. Shared by
   * approveWithdrawal (the synchronous Transfer Online failure path) and
   * handleDisbursementCallback (the Clearing-callback path).
   */
  private async refundFailedWithdrawal(
    withdrawal: CommissionWithdrawal,
    description: string,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const profile = await queryRunner.manager.findOne(AffiliatorProfile, {
        where: { id: withdrawal.affiliatorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) {
        throw new NotFoundException(
          `Affiliate profile ${withdrawal.affiliatorId} not found while refunding withdrawal ${withdrawal.id}`,
        );
      }

      const refundedBalance =
        Number(profile.commissionBalance) + Number(withdrawal.amount);
      await queryRunner.manager.update(AffiliatorProfile, profile.id, {
        commissionBalance: refundedBalance.toFixed(2),
      });

      const log = queryRunner.manager.create(CommissionLog, {
        affiliatorId: profile.id,
        withdrawalId: withdrawal.id,
        type: CommissionLogType.CREDIT,
        amount: withdrawal.amount,
        balanceAfter: refundedBalance.toFixed(2),
        description,
      });
      await queryRunner.manager.save(log);

      await queryRunner.manager.update(CommissionWithdrawal, withdrawal.id, {
        status: WithdrawalStatus.FAILED,
      });

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Superadmin listing (SRS-ADM-01: "melihat daftar pendaftaran affiliator").
   * Not locked, so the eager-free `user` relation can be joined directly.
   */
  async findAllProfiles(params: {
    status?: UserStatus;
    adminProfileId?: string;
    superAffiliateProfileId?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AffiliatorProfile[]; total: number }> {
    const qb = this.profileRepository
      .createQueryBuilder('profile')
      .leftJoinAndSelect('profile.user', 'user')
      .leftJoinAndSelect('profile.adminProfile', 'adminProfile')
      .leftJoinAndSelect('adminProfile.user', 'adminUser')
      .leftJoinAndSelect('profile.superAffiliateProfile', 'superAffiliate')
      .leftJoinAndSelect('superAffiliate.user', 'superAffiliateUser')
      .withDeleted()
      .andWhere('profile.deletedAt IS NULL')
      .orderBy('profile.createdAt', 'DESC')
      .take(params.limit)
      .skip(params.offset);

    if (params.status) {
      qb.andWhere('user.status = :status', { status: params.status });
    }

    if (params.adminProfileId) {
      qb.andWhere('profile.adminProfileId = :adminProfileId', {
        adminProfileId: params.adminProfileId,
      });
    }

    if (params.superAffiliateProfileId) {
      qb.andWhere('profile.superAffiliateProfileId = :superAffiliateId', {
        superAffiliateId: params.superAffiliateProfileId,
      });
    }

    const search = params.search?.trim();
    if (search && /^\d+$/.test(search)) {
      // All digits = a user_id or profile_id, matched exactly: a partial "5"
      // would also hit 15, 25, emails like x5@... and push the wanted row
      // out of a small limit (Reset Password lookup).
      qb.andWhere(
        '(CAST(profile.id AS TEXT) = :search OR CAST(user.id AS TEXT) = :search)',
        { search },
      );
    } else if (search) {
      qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Superadmin commission overview for one affiliate (affiliatorId = profile
   * id): current balance, all-time earned, the month's two payout periods
   * (1-15, 16-end) and an optional custom range. Period figures come from
   * getPeriodStats, i.e. referral commission credits only - manual
   * adjustments and withdrawal refunds don't count as earned in the period.
   */
  async getCommissionSummary(
    affiliatorId: string,
    query: { month?: string; dateFrom?: string; dateTo?: string },
  ) {
    const profile = await this.findProfileByIdOrFail(affiliatorId);
    const month = query.month ?? currentPeriodKey();
    const { period_1, period_2 } = monthPayoutPeriods(month);

    const statsFor = async (dateFrom?: string, dateTo?: string) => {
      const stats = (
        await this.getPeriodStats([profile.id], { dateFrom, dateTo })
      ).get(String(profile.id));
      return {
        date_from: dateFrom ?? null,
        date_to: dateTo ?? null,
        transaction_count: stats?.transactionCount ?? 0,
        gross_amount: stats?.grossAmount ?? '0.00',
        commission: stats?.commission ?? '0.00',
      };
    };

    const [first, second, range] = await Promise.all([
      statsFor(period_1.date_from, period_1.date_to),
      statsFor(period_2.date_from, period_2.date_to),
      query.dateFrom || query.dateTo
        ? statsFor(query.dateFrom, query.dateTo)
        : null,
    ]);

    return {
      affiliator: {
        affiliator_id: profile.id,
        name: profile.user?.name ?? null,
        email: profile.user?.email ?? null,
        affiliate_code: profile.affiliateCode,
      },
      commission_balance: profile.commissionBalance,
      total_commission_earned: profile.totalCommissionEarned,
      month,
      period_1: first,
      period_2: second,
      range,
    };
  }

  /**
   * Per-affiliate referral sales in a date range (both ends inclusive,
   * YYYY-MM-DD, either optional): paid referred transactions, their gross
   * amount and the commission credited. Read from commission credit logs
   * rather than transactions.referral_code so sales made under an
   * affiliate's older referral code still count. Dated by when the
   * commission was credited, i.e. when the paid transaction was fulfilled.
   */
  async getPeriodStats(
    profileIds: string[],
    period: { dateFrom?: string; dateTo?: string },
  ): Promise<
    Map<
      string,
      { transactionCount: number; grossAmount: string; commission: string }
    >
  > {
    if (profileIds.length === 0) return new Map();
    const qb = this.commissionLogRepository
      .createQueryBuilder('log')
      .innerJoin(Transaction, 't', 't.id = log.transaction_id')
      .select('log.affiliator_id', 'affiliator_id')
      .addSelect('COUNT(*)', 'transaction_count')
      .addSelect('COALESCE(SUM(t.gross_amount), 0)', 'gross_amount')
      .addSelect('COALESCE(SUM(log.amount), 0)', 'commission')
      .where('log.type = :type', { type: CommissionLogType.CREDIT })
      .andWhere('log.affiliator_id IN (:...ids)', { ids: profileIds })
      .groupBy('log.affiliator_id');
    whereJakartaDate(qb, 'log.created_at', period.dateFrom, period.dateTo);
    const rows: {
      affiliator_id: string;
      transaction_count: string;
      gross_amount: string;
      commission: string;
    }[] = await qb.getRawMany();
    return new Map(
      rows.map((row) => [
        String(row.affiliator_id),
        {
          transactionCount: Number(row.transaction_count),
          grossAmount: Number(row.gross_amount).toFixed(2),
          commission: Number(row.commission).toFixed(2),
        },
      ]),
    );
  }

  async findAllWithdrawals(params: {
    statuses?: WithdrawalStatus[];
    method?: WithdrawalMethod;
    search?: string;
    affiliatorId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
    offset: number;
  }) {
    const qb = this.withdrawalRepository
      .createQueryBuilder('withdrawal')
      .leftJoinAndSelect('withdrawal.affiliator', 'affiliator')
      .leftJoinAndSelect('affiliator.user', 'user');

    if (params.method) {
      qb.andWhere('withdrawal.method = :method', { method: params.method });
    }
    if (params.affiliatorId) {
      qb.andWhere('withdrawal.affiliatorId = :affiliatorId', {
        affiliatorId: params.affiliatorId,
      });
    }
    whereJakartaDate(
      qb,
      'withdrawal.created_at',
      params.dateFrom,
      params.dateTo,
    );
    if (params.search) {
      // ponytail: momo_username is a live MomoLive lookup, not a column, so
      // it isn't searchable; store it on the withdrawal if that's needed.
      qb.andWhere(
        `(user.name ILIKE :search OR user.email ILIKE :search
          OR withdrawal.account_number ILIKE :search OR withdrawal.bank_name ILIKE :search
          OR withdrawal.momo_user_id ILIKE :search)`,
        { search: `%${params.search}%` },
      );
    }

    const counts = await countByGroups(
      qb,
      'withdrawal.status',
      WITHDRAWAL_STATUS_GROUPS,
    );
    if (params.statuses) {
      qb.andWhere('withdrawal.status IN (:...statuses)', {
        statuses: params.statuses,
      });
    }

    const [items, total] = await qb
      .orderBy('withdrawal.createdAt', 'DESC')
      .take(params.limit)
      .skip(params.offset)
      .getManyAndCount();
    const momoUsers = await this.lookupMomoUsers(
      items.map((w) => w.momoUserId).filter((id): id is string => id !== null),
    );
    return { items, total, momoUsers, counts };
  }
}

/** The admin an affiliate registered under (via their referral code), or null. */
export function toLinkedAdmin(admin: AdminProfile | null | undefined) {
  if (!admin) return null;
  return {
    admin_profile_id: admin.id,
    name: admin.user?.name ?? null,
    referral_code: admin.referralCode,
    deleted: admin.deletedAt !== null,
  };
}

/** The super affiliate an affiliate sits under, or null. */
export function toLinkedSuperAffiliate(
  superAffiliate: SuperAffiliateProfile | null | undefined,
) {
  if (!superAffiliate) return null;
  return {
    super_affiliate_id: superAffiliate.id,
    name: superAffiliate.user?.name ?? null,
    referral_code: superAffiliate.referralCode,
    deleted: superAffiliate.deletedAt !== null,
  };
}

/** Exactly one upline column set (see CHK_affiliator_profiles_single_upline). */
function uplineColumns(upline: Upline | null) {
  return {
    adminProfileId: upline?.kind === 'admin' ? upline.profile.id : null,
    superAffiliateProfileId:
      upline?.kind === 'super_affiliate' ? upline.profile.id : null,
  };
}
