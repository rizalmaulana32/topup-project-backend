import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import {
  generateOrderId,
  generateReferralCode,
} from '../common/utils/id-generator.util';
import { SettingsService } from '../settings/settings.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { RegisterAffiliateDto } from './dto/register-affiliate.dto';
import {
  calculateTieredCommissionRate,
  currentPeriodKey,
} from './tiered-commission.util';
import { AffiliatorProfile } from './entities/affiliator-profile.entity';
import {
  CommissionLog,
  CommissionLogType,
} from './entities/commission-log.entity';
import {
  CommissionWithdrawal,
  WithdrawalStatus,
} from './entities/commission-withdrawal.entity';

const BCRYPT_SALT_ROUNDS = 10;
const REFERRAL_CODE_MAX_ATTEMPTS = 5;

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
  ) {}

  async isEmailRegistered(email: string): Promise<boolean> {
    const user = await this.usersService.findByEmail(email);
    return user !== null;
  }

  async register(dto: RegisterAffiliateDto) {
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

  async getDashboard(userId: string) {
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

    const referredTransactions = profile.affiliateCode
      ? await this.transactionsService.findByReferralCode(profile.affiliateCode)
      : [];

    const commissionHistory = await this.commissionLogRepository.find({
      where: { affiliatorId: profile.id },
      order: { createdAt: 'DESC' },
    });

    return {
      affiliate_code: profile.affiliateCode,
      bank_name: profile.bankName,
      account_number: profile.accountNumber,
      account_holder: profile.accountHolder,
      commission_balance: profile.commissionBalance,
      total_commission_earned: profile.totalCommissionEarned,
      referred_transaction_count: referredTransactions.length,
      referred_transactions: referredTransactions.map((transaction) => ({
        transaction_id: transaction.id,
        payment_status: transaction.paymentStatus,
        gross_amount: transaction.grossAmount,
        created_at: transaction.createdAt,
      })),
      commission_history: commissionHistory.map((log) => ({
        type: log.type,
        amount: log.amount,
        balance_after: log.balanceAfter,
        description: log.description,
        created_at: log.createdAt,
      })),
    };
  }

  /** Admin-facing full detail view for one affiliate (client request via Ricky 2026-11-02: "penambahan detail informasi affiliate"). */
  async getAdminAffiliateDetail(profileId: string) {
    const profile = await this.findProfileByIdOrFail(profileId);

    const referredTransactions = profile.affiliateCode
      ? await this.transactionsService.findByReferralCode(
          profile.affiliateCode,
        )
      : [];

    const commissionHistory = await this.commissionLogRepository.find({
      where: { affiliatorId: profile.id },
      order: { createdAt: 'DESC' },
    });

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
      approved_by: profile.approvedBy,
      approved_at: profile.approvedAt,
      created_at: profile.createdAt,
      referred_transaction_count: referredTransactions.length,
      referred_transactions: referredTransactions.map((transaction) => ({
        transaction_id: transaction.id,
        payment_status: transaction.paymentStatus,
        gross_amount: transaction.grossAmount,
        created_at: transaction.createdAt,
      })),
      commission_history: commissionHistory.map((log) => ({
        type: log.type,
        amount: log.amount,
        balance_after: log.balanceAfter,
        description: log.description,
        created_at: log.createdAt,
      })),
      withdrawals: withdrawals.map((withdrawal) => ({
        withdrawal_id: withdrawal.id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        created_at: withdrawal.createdAt,
      })),
    };
  }

  async findProfileByIdOrFail(profileId: string): Promise<AffiliatorProfile> {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: { user: true },
    });
    if (!profile) {
      throw new NotFoundException(`Affiliate profile ${profileId} not found`);
    }
    return profile;
  }

  async approve(
    profileId: string,
    adminUserId: string,
  ): Promise<AffiliatorProfile> {
    const profile = await this.findProfileByIdOrFail(profileId);

    if (!profile.affiliateCode) {
      profile.affiliateCode = await this.generateUniqueReferralCode();
    }
    profile.approvedBy = adminUserId;
    profile.approvedAt = new Date();
    await this.profileRepository.save(profile);
    await this.usersService.updateStatus(profile.userId, UserStatus.ACTIVE);

    return this.findProfileByIdOrFail(profileId);
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

    return this.profileRepository.save(profile);
  }

  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt += 1) {
      const candidate = generateReferralCode();
      const existing = await this.profileRepository.findOne({
        where: { affiliateCode: candidate },
      });
      if (!existing) {
        return candidate;
      }
    }
    throw new ConflictException(
      'Could not generate a unique referral code, please retry',
    );
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
    grossAmount: string;
    customerDiscountAmount?: string;
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

      // grossAmount is what was actually charged after any customer
      // discount, so the discount is added back to recover the original
      // pre-discount price the commission rate applies to, then the same
      // discount Rupiah amount is subtracted back out of the commission -
      // i.e. the customer's cut comes directly out of the affiliate's,
      // not on top of it. See checkout()'s doc comment for why this
      // originates at checkout time rather than being re-derived from the
      // (possibly since-changed) live settings rate here.
      const discountAmount = Number(params.customerDiscountAmount ?? 0);
      const originalAmount = Number(params.grossAmount) + discountAmount;

      let effectiveRate = Number(profile.commissionRate);
      let periodUpdate: { currentPeriodVolume: string; currentPeriodMonth: string } | null =
        null;
      if (profile.tieredCommissionEnabled) {
        const periodKey = currentPeriodKey();
        const periodVolumeBefore =
          profile.currentPeriodMonth === periodKey
            ? Number(profile.currentPeriodVolume)
            : 0;
        const periodVolumeAfter = periodVolumeBefore + originalAmount;
        effectiveRate = calculateTieredCommissionRate(periodVolumeAfter);
        periodUpdate = {
          currentPeriodVolume: periodVolumeAfter.toFixed(2),
          currentPeriodMonth: periodKey,
        };
      }

      const commissionAmount = Math.max(
        0,
        (originalAmount * effectiveRate) / 100 - discountAmount,
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
        description: `Commission for referred transaction ${params.transactionId}`,
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
  ): Promise<CommissionWithdrawal> {
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
      const minimumWithdrawal = Number(settings.minimumWithdrawalAmount);

      if (balance < minimumWithdrawal) {
        throw new BadRequestException(
          `Commission balance (${balance}) has not reached the minimum withdrawal amount (${minimumWithdrawal}).`,
        );
      }
      if (amount <= 0) {
        throw new BadRequestException('Withdrawal amount must be positive.');
      }
      if (amount > balance) {
        throw new BadRequestException(
          `Requested amount (${amount}) exceeds available commission balance (${balance}).`,
        );
      }

      const newBalance = balance - amount;
      await queryRunner.manager.update(AffiliatorProfile, profile.id, {
        commissionBalance: newBalance.toFixed(2),
      });

      const withdrawal = queryRunner.manager.create(CommissionWithdrawal, {
        id: generateOrderId('WDW'),
        affiliatorId: profile.id,
        amount: amount.toFixed(2),
        bankName: profile.bankName,
        accountNumber: profile.accountNumber,
        accountHolder: profile.accountHolder,
        status: WithdrawalStatus.PENDING,
      });
      await queryRunner.manager.save(withdrawal);

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
   */
  async approveWithdrawal(
    withdrawalId: string,
    adminUserId: string,
  ): Promise<CommissionWithdrawal> {
    const withdrawal = await this.findWithdrawalByIdOrFail(withdrawalId);

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new ConflictException(
        `Withdrawal ${withdrawalId} is not pending (current status: ${withdrawal.status})`,
      );
    }

    withdrawal.status = WithdrawalStatus.APPROVED;
    withdrawal.approvedBy = adminUserId;
    withdrawal.approvedAt = new Date();
    return this.withdrawalRepository.save(withdrawal);
  }

  /**
   * Marks a withdrawal as paid after an admin has manually transferred the
   * funds (outside the system - see approveWithdrawal's doc comment for
   * why). `notes` is meant for a transfer reference/proof so the paid
   * record isn't just a bare timestamp.
   */
  async markWithdrawalProcessed(
    withdrawalId: string,
    adminUserId: string,
    notes?: string,
  ): Promise<CommissionWithdrawal> {
    const withdrawal = await this.findWithdrawalByIdOrFail(withdrawalId);

    if (withdrawal.status !== WithdrawalStatus.APPROVED) {
      throw new ConflictException(
        `Withdrawal ${withdrawalId} is not approved (current status: ${withdrawal.status})`,
      );
    }

    withdrawal.status = WithdrawalStatus.PAID;
    withdrawal.processedBy = adminUserId;
    withdrawal.processedAt = new Date();
    if (notes) {
      withdrawal.adminNotes = notes;
    }
    return this.withdrawalRepository.save(withdrawal);
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

      await queryRunner.manager.update(CommissionWithdrawal, withdrawal.id, {
        status: WithdrawalStatus.REJECTED,
        processedBy: adminUserId,
        processedAt: new Date(),
      });

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
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AffiliatorProfile[]; total: number }> {
    const qb = this.profileRepository
      .createQueryBuilder('profile')
      .leftJoinAndSelect('profile.user', 'user')
      .orderBy('profile.createdAt', 'DESC')
      .take(params.limit)
      .skip(params.offset);

    if (params.status) {
      qb.andWhere('user.status = :status', { status: params.status });
    }

    if (params.search) {
      qb.andWhere(
        '(user.name ILIKE :search OR user.email ILIKE :search OR CAST(profile.id AS TEXT) ILIKE :search)',
        { search: `%${params.search}%` },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async findAllWithdrawals(params: {
    status?: WithdrawalStatus;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: CommissionWithdrawal[]; total: number }> {
    const qb = this.withdrawalRepository
      .createQueryBuilder('withdrawal')
      .leftJoinAndSelect('withdrawal.affiliator', 'affiliator')
      .leftJoinAndSelect('affiliator.user', 'user')
      .orderBy('withdrawal.createdAt', 'DESC')
      .take(params.limit)
      .skip(params.offset);

    if (params.status) {
      qb.andWhere('withdrawal.status = :status', { status: params.status });
    }

    if (params.search) {
      qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', {
        search: `%${params.search}%`,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
