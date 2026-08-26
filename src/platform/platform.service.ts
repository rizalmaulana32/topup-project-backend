import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { generateOrderId } from '../common/utils/id-generator.util';
import { DuitkuService } from '../duitku/duitku.service';
import { PlatformSettings } from '../settings/entities/platform-settings.entity';
import {
  PlatformRevenueLog,
  PlatformRevenueLogType,
} from './entities/platform-revenue-log.entity';
import {
  PlatformWithdrawal,
  PlatformWithdrawalStatus,
} from './entities/platform-withdrawal.entity';

const SETTINGS_ROW_ID = 1;

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    @InjectRepository(PlatformSettings)
    private readonly settingsRepository: Repository<PlatformSettings>,
    @InjectRepository(PlatformRevenueLog)
    private readonly revenueLogRepository: Repository<PlatformRevenueLog>,
    @InjectRepository(PlatformWithdrawal)
    private readonly withdrawalRepository: Repository<PlatformWithdrawal>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly duitkuService: DuitkuService,
  ) {}

  /**
   * Credits the platform's own revenue for a successfully fulfilled
   * transaction: sellingPrice (grossAmount) minus the product's cost
   * (baseCost) minus whatever commission was paid out on it. Called from
   * TopupService.handleInvoicePaid for every successful injection,
   * regardless of whether the transaction had a referral code (commissionPaid
   * is "0.00" when there wasn't one). Uses the same pessimistic-lock
   * pattern as AffiliatesService.creditCommissionForTransaction.
   */
  async creditRevenueForTransaction(params: {
    transactionId: string;
    grossAmount: string;
    baseCost: string;
    commissionPaid: string;
  }): Promise<void> {
    const revenue =
      Number(params.grossAmount) -
      Number(params.baseCost) -
      Number(params.commissionPaid);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existing = await queryRunner.manager.findOne(PlatformSettings, {
        where: { id: SETTINGS_ROW_ID },
        lock: { mode: 'pessimistic_write' },
      });
      const settings =
        existing ??
        queryRunner.manager.create(PlatformSettings, {
          id: SETTINGS_ROW_ID,
          platformBalance: '0',
        });

      const newBalance = Number(settings.platformBalance) + revenue;
      settings.platformBalance = newBalance.toFixed(2);
      await queryRunner.manager.save(settings);

      const log = queryRunner.manager.create(PlatformRevenueLog, {
        transactionId: params.transactionId,
        type: PlatformRevenueLogType.CREDIT,
        amount: revenue.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        description: `Platform revenue for transaction ${params.transactionId} (gross ${params.grossAmount} - cost ${params.baseCost} - commission ${params.commissionPaid})`,
      });
      await queryRunner.manager.save(log);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getBalance(): Promise<string> {
    const settings = await this.settingsRepository.findOne({
      where: { id: SETTINGS_ROW_ID },
    });
    return settings?.platformBalance ?? '0.00';
  }

  /**
   * Locks the requested amount immediately, same timing as
   * AffiliatesService.requestWithdrawal. Requires the admin payout bank
   * details to already be set via PATCH /admin/settings — captured onto
   * the withdrawal row itself so a later settings change can't alter a
   * pending withdrawal's destination.
   */
  async requestWithdrawal(
    amount: number,
    requestedBy: string,
  ): Promise<PlatformWithdrawal> {
    if (amount <= 0) {
      throw new BadRequestException('Withdrawal amount must be positive.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const settings = await queryRunner.manager.findOne(PlatformSettings, {
        where: { id: SETTINGS_ROW_ID },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        !settings?.adminBankName ||
        !settings.adminAccountNumber ||
        !settings.adminAccountHolder
      ) {
        throw new BadRequestException(
          'Admin payout bank details are not set. Configure admin_bank_name/admin_account_number/admin_account_holder via PATCH /admin/settings first.',
        );
      }

      const balance = Number(settings.platformBalance);
      if (amount > balance) {
        throw new BadRequestException(
          `Requested amount (${amount}) exceeds available platform balance (${balance}).`,
        );
      }

      const newBalance = balance - amount;
      await queryRunner.manager.update(PlatformSettings, SETTINGS_ROW_ID, {
        platformBalance: newBalance.toFixed(2),
      });

      const withdrawal = queryRunner.manager.create(PlatformWithdrawal, {
        id: generateOrderId('PWD'),
        amount: amount.toFixed(2),
        bankName: settings.adminBankName,
        accountNumber: settings.adminAccountNumber,
        accountHolder: settings.adminAccountHolder,
        status: PlatformWithdrawalStatus.PENDING,
      });
      await queryRunner.manager.save(withdrawal);

      const log = queryRunner.manager.create(PlatformRevenueLog, {
        withdrawalId: withdrawal.id,
        type: PlatformRevenueLogType.DEBIT,
        amount: amount.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        description: `Platform withdrawal request ${withdrawal.id} locked by admin ${requestedBy}`,
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
  ): Promise<PlatformWithdrawal> {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id: withdrawalId },
    });
    if (!withdrawal) {
      throw new NotFoundException(
        `Platform withdrawal ${withdrawalId} not found`,
      );
    }
    return withdrawal;
  }

  /**
   * Same synchronous-resolution pattern as
   * AffiliatesService.approveWithdrawal - Duitku's Transfer Online has no
   * callback, so the outcome is known immediately.
   */
  async approveWithdrawal(
    withdrawalId: string,
    adminUserId: string,
  ): Promise<PlatformWithdrawal> {
    const withdrawal = await this.findWithdrawalByIdOrFail(withdrawalId);

    if (withdrawal.status !== PlatformWithdrawalStatus.PENDING) {
      throw new ConflictException(
        `Platform withdrawal ${withdrawalId} is not pending (current status: ${withdrawal.status})`,
      );
    }

    const payout = await this.duitkuService.createPayout({
      referenceId: withdrawal.id,
      amount: Number(withdrawal.amount),
      bankName: withdrawal.bankName,
      accountNumber: withdrawal.accountNumber,
      accountHolder: withdrawal.accountHolder,
      description: `Platform withdrawal ${withdrawal.id}`,
    });

    withdrawal.duitkuDisbursementId = payout.payoutId;
    withdrawal.processedBy = adminUserId;
    withdrawal.processedAt = new Date();

    if (payout.success) {
      withdrawal.status = PlatformWithdrawalStatus.PAID;
      return this.withdrawalRepository.save(withdrawal);
    }

    await this.withdrawalRepository.save(withdrawal);
    await this.refundFailedWithdrawal(
      withdrawal,
      `Duitku disbursement failed: ${payout.responseDesc} (${payout.responseCode})`,
    );
    return this.findWithdrawalByIdOrFail(withdrawalId);
  }

  async rejectWithdrawal(
    withdrawalId: string,
    adminUserId: string,
  ): Promise<PlatformWithdrawal> {
    const withdrawal = await this.findWithdrawalByIdOrFail(withdrawalId);

    if (withdrawal.status !== PlatformWithdrawalStatus.PENDING) {
      throw new ConflictException(
        `Platform withdrawal ${withdrawalId} is not pending (current status: ${withdrawal.status})`,
      );
    }

    await this.refundWithdrawal(
      withdrawal,
      PlatformWithdrawalStatus.REJECTED,
      `Refund for rejected platform withdrawal ${withdrawal.id}`,
      adminUserId,
    );

    return this.findWithdrawalByIdOrFail(withdrawalId);
  }

  private async refundFailedWithdrawal(
    withdrawal: PlatformWithdrawal,
    description: string,
  ): Promise<void> {
    await this.refundWithdrawal(
      withdrawal,
      PlatformWithdrawalStatus.FAILED,
      description,
      null,
    );
  }

  private async refundWithdrawal(
    withdrawal: PlatformWithdrawal,
    finalStatus: PlatformWithdrawalStatus,
    description: string,
    processedBy: string | null,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const settings = await queryRunner.manager.findOne(PlatformSettings, {
        where: { id: SETTINGS_ROW_ID },
        lock: { mode: 'pessimistic_write' },
      });
      if (!settings) {
        throw new NotFoundException(
          `Platform settings not found while refunding withdrawal ${withdrawal.id}`,
        );
      }

      const refundedBalance =
        Number(settings.platformBalance) + Number(withdrawal.amount);
      await queryRunner.manager.update(PlatformSettings, SETTINGS_ROW_ID, {
        platformBalance: refundedBalance.toFixed(2),
      });

      const log = queryRunner.manager.create(PlatformRevenueLog, {
        withdrawalId: withdrawal.id,
        type: PlatformRevenueLogType.CREDIT,
        amount: withdrawal.amount,
        balanceAfter: refundedBalance.toFixed(2),
        description,
      });
      await queryRunner.manager.save(log);

      const update: Partial<PlatformWithdrawal> = { status: finalStatus };
      if (processedBy !== null) {
        update.processedBy = processedBy;
        update.processedAt = new Date();
      }
      await queryRunner.manager.update(
        PlatformWithdrawal,
        withdrawal.id,
        update,
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAllWithdrawals(params: {
    status?: PlatformWithdrawalStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: PlatformWithdrawal[]; total: number }> {
    const [items, total] = await this.withdrawalRepository.findAndCount({
      where: params.status ? { status: params.status } : {},
      order: { createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { items, total };
  }
}
