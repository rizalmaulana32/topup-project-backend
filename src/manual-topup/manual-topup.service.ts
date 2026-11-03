import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import { AffiliatorProfile } from '../affiliates/entities/affiliator-profile.entity';
import {
  generateOrderId,
  generateReferralCode,
} from '../common/utils/id-generator.util';
import { PROVIDER_TOP_UP_PORT } from '../provider/provider-top-up.port';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AdminProfile } from './entities/admin-profile.entity';
import { ManualTopup, ManualTopupStatus } from './entities/manual-topup.entity';
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
    referralCode?: string;
    createdBy: string;
  }): Promise<AdminProfile> {
    const referralCode = params.referralCode
      ? await this.assertReferralCodeAvailable(params.referralCode)
      : await this.generateUniqueReferralCode();
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
      referralCode,
      createdBy: params.createdBy,
    });
    return this.profileRepository.save(profile);
  }

  async findAdminOrFail(adminProfileId: string): Promise<AdminProfile> {
    const profile = await this.profileRepository.findOne({
      where: { id: adminProfileId },
      relations: { user: true },
    });
    if (!profile) {
      throw new NotFoundException(`Admin profile ${adminProfileId} not found`);
    }
    return profile;
  }

  async updateAdmin(
    adminProfileId: string,
    changes: {
      name?: string;
      email?: string;
      password?: string;
      referralCode?: string;
    },
  ): Promise<AdminProfile> {
    const profile = await this.findAdminOrFail(adminProfileId);

    if (changes.referralCode && changes.referralCode !== profile.referralCode) {
      await this.assertReferralCodeAvailable(changes.referralCode);
      await this.profileRepository.update(profile.id, {
        referralCode: changes.referralCode,
      });
    }

    await this.usersService.updateAccount(profile.userId, {
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.email !== undefined && { email: changes.email }),
      ...(changes.password !== undefined && {
        passwordHash: await bcrypt.hash(changes.password, BCRYPT_SALT_ROUNDS),
      }),
    });

    return this.findAdminOrFail(adminProfileId);
  }

  /**
   * Soft-deletes an admin: deactivates the user, frees the email for reuse
   * (same as an affiliate delete) and soft-deletes the profile. Their
   * unfinished manual top-up schedules are cancelled first - otherwise the
   * cron would keep sending them with no coin budget check (sendInstallment
   * treats a creator without an admin profile as an unlimited superadmin).
   * Affiliates linked to this admin keep their link.
   */
  async deleteAdmin(adminProfileId: string): Promise<void> {
    const profile = await this.findAdminOrFail(adminProfileId);
    await this.manualTopupRepository.update(
      {
        createdBy: profile.userId,
        status: In([ManualTopupStatus.ACTIVE, ManualTopupStatus.PAUSED]),
      },
      { status: ManualTopupStatus.CANCELLED, nextRunAt: null },
    );
    await this.usersService.updateStatus(profile.userId, UserStatus.INACTIVE);
    await this.usersService.archiveEmailForReuse(profile.userId);
    await this.profileRepository.softDelete(profile.id);
  }

  async findAllAdmins(): Promise<
    (AdminProfile & { affiliateCount: number })[]
  > {
    const profiles = await this.profileRepository.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
    const counts: { admin_profile_id: string; count: string }[] =
      await this.dataSource
        .getRepository(AffiliatorProfile)
        .createQueryBuilder('affiliate')
        .select('affiliate.admin_profile_id', 'admin_profile_id')
        .addSelect('COUNT(*)', 'count')
        .where('affiliate.admin_profile_id IS NOT NULL')
        .groupBy('affiliate.admin_profile_id')
        .getRawMany();
    const countByAdmin = new Map(
      counts.map((row) => [String(row.admin_profile_id), Number(row.count)]),
    );
    return profiles.map((profile) =>
      Object.assign(profile, {
        affiliateCount: countByAdmin.get(String(profile.id)) ?? 0,
      }),
    );
  }

  /**
   * Everything for the admin detail page: the profile (deleted admins
   * included, so their history stays viewable), affiliates linked via the
   * admin's referral code, and every manual top-up the admin created with
   * each one's full per-send history.
   * ponytail: unpaginated - fine at current volumes; page manual_topups if an
   * admin accumulates thousands of schedules.
   */
  async getAdminDetail(adminProfileId: string) {
    const profile = await this.profileRepository.findOne({
      where: { id: adminProfileId },
      relations: { user: true },
      withDeleted: true,
    });
    if (!profile) {
      throw new NotFoundException(`Admin profile ${adminProfileId} not found`);
    }

    const [manualTopups, affiliates] = await Promise.all([
      this.manualTopupRepository.find({
        where: { createdBy: profile.userId },
        order: { createdAt: 'DESC' },
      }),
      this.dataSource.getRepository(AffiliatorProfile).find({
        where: { adminProfileId: profile.id },
        relations: { user: true },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const sends = manualTopups.length
      ? await this.sendRepository.find({
          where: { manualTopupId: In(manualTopups.map((m) => m.id)) },
          order: { sentAt: 'ASC' },
        })
      : [];

    const committedCoin = manualTopups
      .filter(
        (m) =>
          m.status === ManualTopupStatus.ACTIVE ||
          m.status === ManualTopupStatus.PAUSED,
      )
      .reduce(
        (sum, m) => sum + Number(m.totalAmount) - Number(m.amountSent),
        0,
      );

    return { profile, manualTopups, sends, affiliates, committedCoin };
  }

  async findAdminIdByUserIdOrFail(userId: string): Promise<string> {
    const profile = await this.profileRepository.findOne({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Admin profile not found');
    }
    return profile.id;
  }

  /** Throws if another admin (deleted ones included - the DB constraint covers them) already has the code. */
  private async assertReferralCodeAvailable(code: string): Promise<string> {
    const existing = await this.profileRepository.findOne({
      where: { referralCode: code },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException(`Referral code ${code} is already in use`);
    }
    return code;
  }

  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateReferralCode('ADM');
      const existing = await this.profileRepository.findOne({
        where: { referralCode: candidate },
        withDeleted: true,
      });
      if (!existing) return candidate;
    }
    throw new ConflictException(
      'Could not generate a unique referral code, please retry',
    );
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
      params.amountPerSend !== undefined ||
      params.intervalMinutes !== undefined;
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

    // An admin can't send more than their remaining coin_limit. Unfinished
    // schedules aren't reserved - if a later send finds the limit used up,
    // sendInstallment auto-pauses that schedule until the limit is topped up.
    const adminProfile = await this.profileRepository.findOne({
      where: { userId: params.createdBy },
      withDeleted: true,
    });
    if (adminProfile) {
      if (adminProfile.deletedAt) {
        throw new ForbiddenException('This admin account has been deleted');
      }
      if (params.totalAmount > Number(adminProfile.coinLimit)) {
        throw new BadRequestException(
          `total_amount (${params.totalAmount}) exceeds your remaining coin limit (${Number(adminProfile.coinLimit)})`,
        );
      }
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
    ownerUserId?: string,
  ): Promise<ManualTopupSend[]> {
    await this.findByIdOrFail(manualTopupId, ownerUserId);
    return this.sendRepository.find({
      where: { manualTopupId },
      order: { sentAt: 'ASC' },
    });
  }

  /** Every individual coin send across all of one user's manual top-ups, newest first, with the top-up each belongs to. */
  async findSendsForUser(
    userId: string,
    params: { status?: ManualTopupSendStatus; limit: number; offset: number },
  ): Promise<{
    items: { send: ManualTopupSend; manualTopup: ManualTopup | undefined }[];
    total: number;
  }> {
    const qb = this.sendRepository
      .createQueryBuilder('send')
      .innerJoin(ManualTopup, 'topup', 'topup.id = send.manual_topup_id')
      .where('topup.created_by = :userId', { userId })
      .orderBy('send.sentAt', 'DESC')
      .take(params.limit)
      .skip(params.offset);
    if (params.status) {
      qb.andWhere('send.status = :status', { status: params.status });
    }
    const [sends, total] = await qb.getManyAndCount();

    const topups = sends.length
      ? await this.manualTopupRepository.find({
          where: { id: In([...new Set(sends.map((s) => s.manualTopupId))]) },
        })
      : [];
    const topupById = new Map(topups.map((t) => [t.id, t]));
    return {
      items: sends.map((send) => ({
        send,
        manualTopup: topupById.get(send.manualTopupId),
      })),
      total,
    };
  }

  async cancel(id: string, ownerUserId?: string): Promise<ManualTopup> {
    const manualTopup = await this.findByIdOrFail(id, ownerUserId);
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
  async pause(id: string, ownerUserId?: string): Promise<ManualTopup> {
    const manualTopup = await this.findByIdOrFail(id, ownerUserId);
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
  async resume(id: string, ownerUserId?: string): Promise<ManualTopup> {
    const manualTopup = await this.findByIdOrFail(id, ownerUserId);
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

  /** ownerUserId (set for admin-role callers) hides other people's top-ups behind the same 404. */
  private async findByIdOrFail(
    id: string,
    ownerUserId?: string,
  ): Promise<ManualTopup> {
    const manualTopup = await this.manualTopupRepository.findOneBy({ id });
    if (
      !manualTopup ||
      (ownerUserId !== undefined && manualTopup.createdBy !== ownerUserId)
    ) {
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
    // withDeleted: a deleted admin must still go through the budget check
    // (which then fails), not fall through to the unlimited superadmin path.
    const hasAdminProfile = await this.profileRepository.exists({
      where: { userId: manualTopup.createdBy },
      withDeleted: true,
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
        : new Date(Date.now() + (manualTopup.intervalMinutes ?? 0) * 60 * 1000),
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

  private async refundBudget(createdBy: string, amount: number): Promise<void> {
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
