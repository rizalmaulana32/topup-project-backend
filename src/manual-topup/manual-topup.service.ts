import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { generateOrderId } from '../common/utils/id-generator.util';
import { PROVIDER_TOP_UP_PORT } from '../provider/provider-top-up.port';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AdminProfile } from './entities/admin-profile.entity';
import {
  ManualTopup,
  ManualTopupStatus,
} from './entities/manual-topup.entity';
import {
  ManualTopupSend,
  ManualTopupSendStatus,
} from './entities/manual-topup-send.entity';

const BCRYPT_SALT_ROUNDS = 10;
const MANUAL_TOPUP_GAME_CODE = 'MANUAL_TOPUP';

@Injectable()
export class ManualTopupService {
  private readonly logger = new Logger(ManualTopupService.name);

  constructor(
    @InjectRepository(AdminProfile)
    private readonly profileRepository: Repository<AdminProfile>,
    @InjectRepository(ManualTopup)
    private readonly manualTopupRepository: Repository<ManualTopup>,
    @InjectRepository(ManualTopupSend)
    private readonly sendRepository: Repository<ManualTopupSend>,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    @Inject(PROVIDER_TOP_UP_PORT)
    private readonly providerTopUp: ProviderTopUpPort,
  ) {}

  // ---- Admin account management (superadmin-only) ----

  async createAdmin(params: {
    name: string;
    email: string;
    password: string;
    coinLimit: number;
    createdBy: string;
  }): Promise<AdminProfile> {
    const passwordHash = await bcrypt.hash(params.password, BCRYPT_SALT_ROUNDS);
    const user = await this.usersService.createUser({
      name: params.name,
      email: params.email,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });

    const profile = this.profileRepository.create({
      userId: user.id,
      coinLimit: params.coinLimit.toFixed(2),
      totalCoinSent: '0.00',
      createdBy: params.createdBy,
    });
    return this.profileRepository.save(profile);
  }

  async findAllAdmins(): Promise<AdminProfile[]> {
    return this.profileRepository.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** amount is added to the current coin_limit - pass a negative number to deduct. */
  async adjustCoinLimit(
    adminProfileId: string,
    amount: number,
  ): Promise<AdminProfile> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const profile = await queryRunner.manager.findOne(AdminProfile, {
        where: { id: adminProfileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile) {
        throw new NotFoundException(
          `Admin profile ${adminProfileId} not found`,
        );
      }

      const newLimit = Number(profile.coinLimit) + amount;
      if (newLimit < 0) {
        throw new BadRequestException(
          `Resulting coin limit would be negative (current: ${profile.coinLimit}, delta: ${amount})`,
        );
      }

      await queryRunner.manager.update(AdminProfile, profile.id, {
        coinLimit: newLimit.toFixed(2),
      });
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return this.profileRepository.findOneByOrFail({ id: adminProfileId });
  }

  // ---- Manual top-ups ----

  async createManualTopup(params: {
    momoUserId: string;
    customerName?: string;
    totalAmount: number;
    amountPerSend?: number;
    intervalMinutes?: number;
    createdBy: string;
  }): Promise<ManualTopup> {
    const isScheduled =
      params.amountPerSend !== undefined || params.intervalMinutes !== undefined;
    if (isScheduled && (!params.amountPerSend || !params.intervalMinutes)) {
      throw new BadRequestException(
        'amount_per_send and interval_minutes must be given together for a scheduled send',
      );
    }
    if (isScheduled && params.amountPerSend! > params.totalAmount) {
      throw new BadRequestException(
        'amount_per_send cannot exceed total_amount',
      );
    }

    // Fail fast on a bad momo id, same reasoning as the real checkout flow -
    // auto-fills customer_name from MomoLive's own username when not given.
    const check = await this.providerTopUp.checkId(
      MANUAL_TOPUP_GAME_CODE,
      params.momoUserId,
    );

    const manualTopup = await this.manualTopupRepository.save(
      this.manualTopupRepository.create({
        id: generateOrderId('MTU'),
        momoUserId: params.momoUserId,
        customerName: params.customerName ?? check.username,
        totalAmount: params.totalAmount.toFixed(2),
        // One-off send: amountPerSend == totalAmount, so the single send
        // below exhausts it and completes immediately.
        amountPerSend: (params.amountPerSend ?? params.totalAmount).toFixed(2),
        amountSent: '0.00',
        intervalMinutes: isScheduled ? (params.intervalMinutes ?? null) : null,
        status: ManualTopupStatus.ACTIVE,
        nextRunAt: null,
        createdBy: params.createdBy,
      }),
    );

    await this.sendInstallment(manualTopup);

    return this.manualTopupRepository.findOneByOrFail({
      id: manualTopup.id,
    });
  }

  async findAll(params: {
    status?: ManualTopupStatus;
    createdBy?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ManualTopup[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (params.status) {
      where.status = params.status;
    }
    if (params.createdBy) {
      where.createdBy = params.createdBy;
    }

    const [items, total] = await this.manualTopupRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { items, total };
  }

  async findSendsForManualTopup(
    manualTopupId: string,
  ): Promise<ManualTopupSend[]> {
    await this.findByIdOrFail(manualTopupId);
    return this.sendRepository.find({
      where: { manualTopupId },
      order: { sentAt: 'ASC' },
    });
  }

  async cancel(id: string): Promise<ManualTopup> {
    const manualTopup = await this.findByIdOrFail(id);
    if (
      manualTopup.status === ManualTopupStatus.COMPLETED ||
      manualTopup.status === ManualTopupStatus.CANCELLED
    ) {
      throw new ConflictException(
        `Manual top-up ${id} is already ${manualTopup.status}`,
      );
    }

    await this.manualTopupRepository.update(id, {
      status: ManualTopupStatus.CANCELLED,
      nextRunAt: null,
    });
    return this.findByIdOrFail(id);
  }

  /** Manually pauses an ACTIVE schedule - distinct from the automatic pause on insufficient coin limit, but resumed the same way (resume()). */
  async pause(id: string): Promise<ManualTopup> {
    const manualTopup = await this.findByIdOrFail(id);
    if (manualTopup.status !== ManualTopupStatus.ACTIVE) {
      throw new ConflictException(
        `Manual top-up ${id} is not active (current status: ${manualTopup.status})`,
      );
    }

    await this.manualTopupRepository.update(id, {
      status: ManualTopupStatus.PAUSED,
      nextRunAt: null,
    });
    return this.findByIdOrFail(id);
  }

  /** Resumes a PAUSED schedule - whether paused manually via pause() or automatically for insufficient coin limit (top up the creator's coin_limit first in that case). */
  async resume(id: string): Promise<ManualTopup> {
    const manualTopup = await this.findByIdOrFail(id);
    if (manualTopup.status !== ManualTopupStatus.PAUSED) {
      throw new ConflictException(
        `Manual top-up ${id} is not paused (current status: ${manualTopup.status})`,
      );
    }

    await this.manualTopupRepository.update(id, {
      status: ManualTopupStatus.ACTIVE,
      nextRunAt: new Date(),
    });
    return this.findByIdOrFail(id);
  }

  /**
   * Sweep for scheduled/partial manual top-ups (client request via Ricky
   * 2026-11-02, corrected same day: "misal di set topup 10000, per berapa
   * menit iku ngirim 100, sampek entek" - genuinely minute-level intervals,
   * so this runs every minute like the LinkQu reconciliation sweep, not
   * hourly) - sends the next due installment for every ACTIVE schedule
   * whose nextRunAt has passed.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processDueInstallments(): Promise<void> {
    const due = await this.manualTopupRepository.find({
      where: {
        status: ManualTopupStatus.ACTIVE,
        nextRunAt: LessThanOrEqual(new Date()),
      },
    });

    if (due.length === 0) {
      return;
    }

    this.logger.log(
      `Processing ${due.length} due manual top-up installment(s)`,
    );

    for (const manualTopup of due) {
      try {
        await this.sendInstallment(manualTopup);
      } catch (error) {
        this.logger.warn(
          `Manual top-up installment failed for ${manualTopup.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
  }

  private async findByIdOrFail(id: string): Promise<ManualTopup> {
    const manualTopup = await this.manualTopupRepository.findOneBy({ id });
    if (!manualTopup) {
      throw new NotFoundException(`Manual top-up ${id} not found`);
    }
    return manualTopup;
  }

  /**
   * Sends one installment (immediate first send on creation, or a due
   * scheduled one from the cron). Reserves the creator's coin budget
   * (if they have an AdminProfile - a superadmin has none and is
   * unlimited) BEFORE the provider call, refunding it if the call fails,
   * rather than holding a DB transaction open across the external HTTP
   * call.
   */
  private async sendInstallment(manualTopup: ManualTopup): Promise<void> {
    const remaining =
      Number(manualTopup.totalAmount) - Number(manualTopup.amountSent);
    if (remaining <= 0) {
      // Defensive: shouldn't happen, since a send that reaches the total
      // is marked COMPLETED immediately below.
      await this.manualTopupRepository.update(manualTopup.id, {
        status: ManualTopupStatus.COMPLETED,
        nextRunAt: null,
      });
      return;
    }
    // The final send takes whatever's left rather than overshooting
    // totalAmount (client correction 2026-11-02: remainder goes on the
    // last send, e.g. total 10000 / per-send 300 -> 33 sends of 300 + one
    // final send of 100).
    const amount = Math.min(Number(manualTopup.amountPerSend), remaining);
    const hasAdminProfile = await this.profileRepository.exists({
      where: { userId: manualTopup.createdBy },
    });

    if (hasAdminProfile) {
      try {
        await this.reserveBudget(manualTopup.createdBy, amount);
      } catch (error) {
        await this.manualTopupRepository.update(manualTopup.id, {
          status: ManualTopupStatus.PAUSED,
        });
        this.logger.warn(
          `Paused manual top-up ${manualTopup.id}: ${error instanceof Error ? error.message : 'insufficient coin limit'}`,
        );
        throw error;
      }
    }

    const result = await this.providerTopUp.injectCoin({
      productProviderCode: MANUAL_TOPUP_GAME_CODE,
      targetUserId: manualTopup.momoUserId,
      coin: amount,
    });

    await this.sendRepository.save(
      this.sendRepository.create({
        manualTopupId: manualTopup.id,
        amount: amount.toFixed(2),
        status: result.success
          ? ManualTopupSendStatus.SUCCESS
          : ManualTopupSendStatus.FAILED,
        providerResponse: result.response,
      }),
    );

    if (!result.success) {
      if (hasAdminProfile) {
        await this.refundBudget(manualTopup.createdBy, amount);
      }
      // Retry on the next cron tick rather than advancing the schedule.
      await this.manualTopupRepository.update(manualTopup.id, {
        nextRunAt: new Date(),
      });
      return;
    }

    if (hasAdminProfile) {
      await this.profileRepository.increment(
        { userId: manualTopup.createdBy },
        'totalCoinSent',
        amount,
      );
    }

    const amountSent = Number(manualTopup.amountSent) + amount;
    const completed = amountSent >= Number(manualTopup.totalAmount);
    await this.manualTopupRepository.update(manualTopup.id, {
      amountSent: amountSent.toFixed(2),
      status: completed
        ? ManualTopupStatus.COMPLETED
        : ManualTopupStatus.ACTIVE,
      nextRunAt: completed
        ? null
        : new Date(
            Date.now() + (manualTopup.intervalMinutes ?? 0) * 60 * 1000,
          ),
    });
  }

  private async reserveBudget(
    createdBy: string,
    amount: number,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const profile = await queryRunner.manager.findOne(AdminProfile, {
        where: { userId: createdBy },
        lock: { mode: 'pessimistic_write' },
      });

      if (!profile || Number(profile.coinLimit) < amount) {
        throw new BadRequestException(
          `Insufficient coin limit (remaining: ${profile?.coinLimit ?? 0}, needed: ${amount})`,
        );
      }

      const newLimit = Number(profile.coinLimit) - amount;
      await queryRunner.manager.update(AdminProfile, profile.id, {
        coinLimit: newLimit.toFixed(2),
      });
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async refundBudget(
    createdBy: string,
    amount: number,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const profile = await queryRunner.manager.findOne(AdminProfile, {
        where: { userId: createdBy },
        lock: { mode: 'pessimistic_write' },
      });
      if (profile) {
        const newLimit = Number(profile.coinLimit) + amount;
        await queryRunner.manager.update(AdminProfile, profile.id, {
          coinLimit: newLimit.toFixed(2),
        });
      }
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
