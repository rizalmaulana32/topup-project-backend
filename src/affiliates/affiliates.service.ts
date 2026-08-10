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
import { XenditService } from '../xendit/xendit.service';
import { RegisterAffiliateDto } from './dto/register-affiliate.dto';
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
    private readonly xenditService: XenditService,
  ) {}

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

  async updateCommissionRate(
    profileId: string,
    commissionRate: number,
  ): Promise<AffiliatorProfile> {
    const profile = await this.findProfileByIdOrFail(profileId);
    profile.commissionRate = commissionRate.toFixed(2);
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
   * cannot corrupt the balance. No-op if the referral code does not match
   * an active affiliate.
   */
  async creditCommissionForTransaction(params: {
    referralCode: string;
    transactionId: string;
    grossAmount: string;
  }): Promise<void> {
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
        return;
      }

      const commissionAmount =
        (Number(params.grossAmount) * Number(profile.commissionRate)) / 100;
      const newBalance = Number(profile.commissionBalance) + commissionAmount;
      const newTotalEarned =
        Number(profile.totalCommissionEarned) + commissionAmount;

      await queryRunner.manager.update(AffiliatorProfile, profile.id, {
        commissionBalance: newBalance.toFixed(2),
        totalCommissionEarned: newTotalEarned.toFixed(2),
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
   * "Kunci Nominal Saldo" step. A later Xendit FAILED/CANCELLED/REVERSED
   * callback refunds the balance with a corrective credit entry; a
   * SUCCEEDED callback needs no further ledger entry since the debit is
   * already accurate.
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

    const payout = await this.xenditService.createPayout({
      referenceId: withdrawal.id,
      amount: Number(withdrawal.amount),
      bankName: withdrawal.bankName,
      accountNumber: withdrawal.accountNumber,
      accountHolder: withdrawal.accountHolder,
      description: `Commission withdrawal ${withdrawal.id}`,
    });

    withdrawal.status = WithdrawalStatus.APPROVED;
    withdrawal.xenditDisbursementId = payout.payoutId;
    withdrawal.processedBy = adminUserId;
    withdrawal.processedAt = new Date();

    return this.withdrawalRepository.save(withdrawal);
  }

  /**
   * Called by the Xendit disbursement callback controller after the
   * x-callback-token has already been verified. Idempotent: a withdrawal
   * not in `approved` status is ignored (already handled or never sent).
   */
  async handleDisbursementCallback(
    referenceId: string,
    xenditStatus: string,
  ): Promise<void> {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id: referenceId },
    });

    if (!withdrawal) {
      this.logger.warn(
        `Xendit disbursement callback for unknown withdrawal ${referenceId}`,
      );
      return;
    }
    if (withdrawal.status !== WithdrawalStatus.APPROVED) {
      this.logger.warn(
        `Duplicate/unexpected disbursement callback for ${referenceId} (status: ${withdrawal.status}), ignoring.`,
      );
      return;
    }

    if (xenditStatus === 'SUCCEEDED') {
      withdrawal.status = WithdrawalStatus.PAID;
      await this.withdrawalRepository.save(withdrawal);
      return;
    }

    // FAILED, CANCELLED, REVERSED, or anything else non-successful: refund.
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
        description: `Refund for failed withdrawal ${withdrawal.id} (Xendit status: ${xenditStatus})`,
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
    limit: number;
    offset: number;
  }): Promise<{ items: AffiliatorProfile[]; total: number }> {
    const [items, total] = await this.profileRepository.findAndCount({
      relations: { user: true },
      where: params.status ? { user: { status: params.status } } : {},
      order: { createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { items, total };
  }

  async findAllWithdrawals(params: {
    status?: WithdrawalStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: CommissionWithdrawal[]; total: number }> {
    const [items, total] = await this.withdrawalRepository.findAndCount({
      where: params.status ? { status: params.status } : {},
      order: { createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { items, total };
  }
}
