import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import {
  DataSource,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { AffiliatorProfile } from '../affiliates/entities/affiliator-profile.entity';
import { insertWithOrderId } from '../common/utils/id-generator.util';
import { countByGroups } from '../common/utils/list-query.util';
import {
  assertReferralCodeAvailable,
  generateUniqueReferralCode,
} from '../common/utils/referral-code.util';
import { PROVIDER_TOP_UP_PORT } from '../provider/provider-top-up.port';
import type {
  InjectCoinResult,
  ProviderTopUpPort,
} from '../provider/provider-top-up.port';
import { SuperAffiliatesService } from '../super-affiliates/super-affiliates.service';
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
export const MIN_INTERVAL_SECONDS = 5;
/**
 * A lock older than this means the process died mid-send (the provider call
 * itself times out well before - see MomoProviderTopUpService). The outcome
 * of that send is unknown, so the schedule is paused, never auto-resent.
 */
const STALE_LOCK_SECONDS = 300;
/** Retry delay after a failed provider call for one-off sends (no interval of their own). */
const ONE_OFF_RETRY_SECONDS = 60;
/**
 * createManualTopup rejects a second request for the same admin/momo
 * user/amount within this window as a likely duplicate submission (client
 * report 2026-11-14, Ricky: two manual top-ups for the same user, same
 * nominal, same instant - "keki validasi setiap topup gak oleh ngirim maneh
 * dengan nominal karo waktu seng podo"). This is separate from, and in
 * addition to, processDueInstallments's per-row lock (d4d8057): that lock
 * only stops the SAME row being sent twice, but a duplicate *request* (a
 * double-tap, a retried network call) creates two distinct rows, each of
 * which the lock then correctly sends exactly once - two real sends
 * either way. Tight enough (seconds, not minutes) that a deliberate repeat
 * top-up to the same user later the same day is never blocked.
 */
const DUPLICATE_CREATE_WINDOW_SECONDS = 10;

/** Commission-log transaction_id of one manual send; super-affiliate month volumes build the same key in SQL. */
export const manualTopupSendKey = (manualTopupId: string, sendId: string) =>
  `${manualTopupId}#${sendId}`;

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
    private readonly affiliatesService: AffiliatesService,
    private readonly superAffiliatesService: SuperAffiliatesService,
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

  /** Codes are unique across admins, super affiliates and affiliates (deleted ones included). */
  private assertReferralCodeAvailable(code: string): Promise<string> {
    return assertReferralCodeAvailable(this.dataSource, code);
  }

  private generateUniqueReferralCode(): Promise<string> {
    return generateUniqueReferralCode(this.dataSource, 'ADM');
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
    referralCode?: string;
    totalAmount: number;
    amountPerSend?: number;
    intervalSeconds?: number;
    createdBy: string;
  }): Promise<ManualTopup> {
    const isScheduled =
      params.amountPerSend !== undefined ||
      params.intervalSeconds !== undefined;
    if (
      params.intervalSeconds !== undefined &&
      params.intervalSeconds < MIN_INTERVAL_SECONDS
    ) {
      throw new UnprocessableEntityException(
        `interval_seconds must be at least ${MIN_INTERVAL_SECONDS} seconds (got ${params.intervalSeconds})`,
      );
    }
    if (isScheduled && (!params.amountPerSend || !params.intervalSeconds)) {
      throw new BadRequestException(
        'amount_per_send and interval_seconds must be given together for a scheduled send',
      );
    }
    if (isScheduled && params.amountPerSend! > params.totalAmount) {
      throw new BadRequestException(
        'amount_per_send cannot exceed total_amount',
      );
    }

    if (
      params.referralCode &&
      !(await this.affiliatesService.checkCodeValidity(params.referralCode))
        .valid
    ) {
      throw new BadRequestException(
        `referral_code ${params.referralCode} is not an active affiliate code`,
      );
    }

    const recentDuplicate = await this.manualTopupRepository.findOne({
      where: {
        createdBy: params.createdBy,
        momoUserId: params.momoUserId,
        totalAmount: params.totalAmount.toFixed(2),
        createdAt: MoreThan(
          new Date(Date.now() - DUPLICATE_CREATE_WINDOW_SECONDS * 1000),
        ),
      },
      order: { createdAt: 'DESC' },
    });
    if (recentDuplicate) {
      throw new ConflictException(
        `A manual top-up for ${params.momoUserId} with the same amount (${params.totalAmount}) was already created ${recentDuplicate.id} moments ago - this looks like a duplicate submission, not a new one. Wait a few seconds and retry if this is really a separate top-up.`,
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

    // Born locked, so nothing else can send it while the first send runs.
    const lockedAt = new Date();
    const manualTopup = await insertWithOrderId(
      this.manualTopupRepository.manager,
      ManualTopup,
      'MTU',
      {
        momoUserId: params.momoUserId,
        customerName: params.customerName ?? check.username,
        totalAmount: params.totalAmount.toFixed(2),
        // One-off send: amountPerSend == totalAmount, so the single send
        // below exhausts it and completes immediately.
        amountPerSend: (params.amountPerSend ?? params.totalAmount).toFixed(2),
        amountSent: '0.00',
        intervalSeconds: isScheduled ? (params.intervalSeconds ?? null) : null,
        referralCode: params.referralCode ?? null,
        status: ManualTopupStatus.ACTIVE,
        nextRunAt: null,
        lockedAt,
        createdBy: params.createdBy,
      },
    );

    await this.sendLocked(manualTopup, lockedAt);

    return this.manualTopupRepository.findOneByOrFail({
      id: manualTopup.id,
    });
  }

  async findAll(params: {
    status?: ManualTopupStatus;
    createdBy?: string;
    limit: number;
    offset: number;
  }) {
    const qb = this.manualTopupRepository.createQueryBuilder('m');
    if (params.createdBy) {
      qb.andWhere('m.createdBy = :createdBy', { createdBy: params.createdBy });
    }
    const counts = await countByGroups(
      qb,
      'm.status',
      Object.fromEntries(
        Object.values(ManualTopupStatus).map((s) => [s, [s]]),
      ) as Record<ManualTopupStatus, ManualTopupStatus[]>,
    );
    if (params.status) {
      qb.andWhere('m.status = :status', { status: params.status });
    }
    const [items, total] = await qb
      .orderBy('m.createdAt', 'DESC')
      .take(params.limit)
      .skip(params.offset)
      .getManyAndCount();
    return { items, total, counts };
  }

  /**
   * One page of an admin's manual top-ups with each one's sends, for the
   * admin detail page (replaces getAdminDetail's unpaginated manualTopups).
   * Works for deleted admins too.
   */
  async findAdminTopups(
    adminProfileId: string,
    params: { status?: ManualTopupStatus; limit: number; offset: number },
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: adminProfileId },
      withDeleted: true,
    });
    if (!profile) {
      throw new NotFoundException(`Admin profile ${adminProfileId} not found`);
    }
    const page = await this.findAll({ ...params, createdBy: profile.userId });
    const sends = page.items.length
      ? await this.sendRepository.find({
          where: { manualTopupId: In(page.items.map((m) => m.id)) },
          order: { sentAt: 'ASC' },
        })
      : [];
    return { ...page, sends };
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
  /**
   * Manual transfer history (one row per send), newest first. scope: createdBy
   * = one admin's sends, referralCodes = sends made under those affiliate
   * codes, {} = everyone's (superadmin).
   */
  async findSends(
    scope: { createdBy?: string; referralCodes?: string[] },
    params: { status?: ManualTopupSendStatus; limit: number; offset: number },
  ): Promise<{
    items: { send: ManualTopupSend; manualTopup: ManualTopup | undefined }[];
    total: number;
  }> {
    if (scope.referralCodes && !scope.referralCodes.length) {
      return { items: [], total: 0 };
    }
    const qb = this.sendRepository
      .createQueryBuilder('send')
      .innerJoin(ManualTopup, 'topup', 'topup.id = send.manual_topup_id')
      .orderBy('send.sentAt', 'DESC')
      .addOrderBy('send.id', 'DESC')
      .take(params.limit)
      .skip(params.offset);
    if (scope.createdBy) {
      qb.andWhere('topup.created_by = :createdBy', {
        createdBy: scope.createdBy,
      });
    }
    if (scope.referralCodes) {
      qb.andWhere('topup.referral_code IN (:...codes)', {
        codes: scope.referralCodes,
      });
    }
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

  /**
   * Codes whose manual sends an affiliate / super affiliate may see: the
   * affiliate's own code, or every live downline affiliate's code (same
   * downline rule as super-affiliate month volumes).
   * ponytail: current codes only - sends under a since-edited code drop out,
   * same as referred_transactions on the affiliate dashboard.
   */
  async referralCodesForUser(
    userId: string,
    role: UserRole.AFFILIATOR | UserRole.SUPER_AFFILIATE,
  ): Promise<string[]> {
    const qb = this.dataSource
      .getRepository(AffiliatorProfile)
      .createQueryBuilder('ap')
      .select('ap.affiliate_code', 'code')
      .where('ap.affiliate_code IS NOT NULL');
    if (role === UserRole.AFFILIATOR) {
      qb.andWhere('ap.user_id = :userId', { userId });
    } else {
      // Soft-deleted downline is excluded automatically (DeleteDateColumn).
      qb.innerJoin(
        'super_affiliate_profiles',
        'sa',
        'sa.id = ap.super_affiliate_profile_id',
      ).andWhere('sa.user_id = :userId', { userId });
    }
    const rows: { code: string }[] = await qb.getRawMany();
    return rows.map((r) => r.code);
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

  private sweeping = false;

  /**
   * Sweep for scheduled/partial manual top-ups (client request via Ricky
   * 2026-11-02: "misal di set topup 10000, per berapa menit iku ngirim 100,
   * sampek entek"; later extended to second-level intervals) - runs every
   * second and sends the next due installment for every ACTIVE schedule
   * whose nextRunAt has passed. Overlapping ticks are skipped; each row is
   * claimed atomically (claim) so it's never sent twice concurrently, even
   * across instances.
   */
  @Interval(1000)
  async processDueInstallments(): Promise<void> {
    if (this.sweeping) {
      return;
    }
    this.sweeping = true;
    try {
      await this.pauseStaleLocks();

      const due = await this.manualTopupRepository.find({
        select: { id: true },
        where: {
          status: ManualTopupStatus.ACTIVE,
          nextRunAt: LessThanOrEqual(new Date()),
          lockedAt: IsNull(),
        },
      });

      for (const { id } of due) {
        try {
          const lockedAt = new Date();
          const manualTopup = await this.claim(id, lockedAt);
          if (manualTopup) {
            await this.sendLocked(manualTopup, lockedAt);
          }
        } catch (error) {
          this.logger.warn(
            `Manual top-up installment failed for ${id}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Per-top-up lock: sets lockedAt only if the row is still ACTIVE, due and
   * unlocked, so exactly one caller wins. Returns the fresh row (read after
   * the lock, so amountSent is current), or null if someone else has it or
   * it was paused/cancelled meanwhile.
   */
  private async claim(id: string, lockedAt: Date): Promise<ManualTopup | null> {
    const result = await this.manualTopupRepository
      .createQueryBuilder()
      .update(ManualTopup)
      .set({ lockedAt })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: ManualTopupStatus.ACTIVE })
      .andWhere('next_run_at <= now()')
      .andWhere('locked_at IS NULL')
      .execute();
    if (!result.affected) {
      return null;
    }
    return this.manualTopupRepository.findOneBy({ id });
  }

  /** Runs one send under an already-held lock and always releases it - only if it's still ours (lockedAt is the owner token). */
  private async sendLocked(
    manualTopup: ManualTopup,
    lockedAt: Date,
  ): Promise<void> {
    try {
      await this.sendInstallment(manualTopup);
    } finally {
      await this.manualTopupRepository.update(
        { id: manualTopup.id, lockedAt },
        { lockedAt: null },
      );
    }
  }

  /**
   * A lock that outlived STALE_LOCK_SECONDS belongs to a process that died
   * mid-send: the coin may or may not have gone out (its send row stays
   * 'unknown'), so pause the schedule for an admin to check, and unlock it.
   */
  private async pauseStaleLocks(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_LOCK_SECONDS * 1000);
    const stale = await this.manualTopupRepository.find({
      select: { id: true, status: true, lockedAt: true },
      where: { lockedAt: LessThan(staleBefore) },
    });
    for (const { id, status, lockedAt } of stale) {
      await this.manualTopupRepository.update(
        { id, lockedAt: lockedAt! },
        status === ManualTopupStatus.ACTIVE
          ? {
              lockedAt: null,
              status: ManualTopupStatus.PAUSED,
              nextRunAt: null,
            }
          : { lockedAt: null },
      );
      this.logger.error(
        `Manual top-up ${id}: send was interrupted (stale lock from ${lockedAt!.toISOString()}), outcome unknown - paused for manual check`,
      );
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
   * scheduled one from the sweep). Caller must hold the lock (sendLocked).
   * Status/nextRunAt writes are guarded by status = ACTIVE, so a pause or
   * cancel that lands mid-send is never overwritten. Reserves the creator's coin budget
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
        await this.manualTopupRepository.update(
          { id: manualTopup.id, status: ManualTopupStatus.ACTIVE },
          { status: ManualTopupStatus.PAUSED, nextRunAt: null },
        );
        this.logger.warn(
          `Paused manual top-up ${manualTopup.id}: ${error instanceof Error ? error.message : 'insufficient coin limit'}`,
        );
        throw error;
      }
    }

    // Written before the provider call: if the process dies mid-call this
    // row stays 'unknown' as the record of a possibly-sent installment.
    const send = await this.sendRepository.save(
      this.sendRepository.create({
        manualTopupId: manualTopup.id,
        amount: amount.toFixed(2),
        status: ManualTopupSendStatus.UNKNOWN,
        providerResponse: null,
      }),
    );

    let result: InjectCoinResult;
    try {
      result = await this.providerTopUp.injectCoin({
        productProviderCode: MANUAL_TOPUP_GAME_CODE,
        targetUserId: manualTopup.momoUserId,
        coin: amount,
        // Later installments of this same schedule repeat the amount on purpose.
        allowRepeat: Number(manualTopup.amountSent) > 0,
        refId: manualTopupSendKey(manualTopup.id, send.id),
      });
    } catch (error) {
      result = {
        success: false,
        response: error instanceof Error ? error.message : 'unknown error',
      };
    }

    const sendStatus = result.success
      ? ManualTopupSendStatus.SUCCESS
      : result.rejected
        ? ManualTopupSendStatus.FAILED
        : ManualTopupSendStatus.UNKNOWN;
    const now = Date.now();
    const onlyIfActive = {
      id: manualTopup.id,
      status: ManualTopupStatus.ACTIVE,
    };

    // Each outcome's writes are one transaction: a crash can never leave a
    // send marked success with amountSent behind (-> resent on resume), or
    // a refused send without its refund.
    await this.dataSource.transaction(async (manager) => {
      await manager.update(ManualTopupSend, send.id, {
        status: sendStatus,
        providerResponse: result.response,
      });

      if (sendStatus === ManualTopupSendStatus.UNKNOWN) {
        // Timeout / 5xx / network error: the coin may have been delivered.
        // Retrying could double-send and refunding could free budget that
        // was actually spent, so keep it reserved and pause for an admin.
        await manager.update(ManualTopup, onlyIfActive, {
          status: ManualTopupStatus.PAUSED,
          nextRunAt: null,
        });
        return;
      }

      if (sendStatus === ManualTopupSendStatus.FAILED) {
        // Provider definitely refused - nothing was sent, so refund and
        // retry after one interval (not the next 1s tick, which would
        // hammer it).
        if (hasAdminProfile) {
          await manager.increment(
            AdminProfile,
            { userId: manualTopup.createdBy },
            'coinLimit',
            amount,
          );
        }
        if (result.duplicate) {
          // Retrying would just send it once the window passes - cancel.
          await manager.update(ManualTopup, onlyIfActive, {
            status: ManualTopupStatus.CANCELLED,
            nextRunAt: null,
          });
          return;
        }
        const retrySeconds =
          manualTopup.intervalSeconds ?? ONE_OFF_RETRY_SECONDS;
        await manager.update(ManualTopup, onlyIfActive, {
          nextRunAt: new Date(now + retrySeconds * 1000),
        });
        return;
      }

      if (hasAdminProfile) {
        await manager.increment(
          AdminProfile,
          { userId: manualTopup.createdBy },
          'totalCoinSent',
          amount,
        );
      }
      // amountSent is recorded whatever the status now is (the coin went
      // out); the next run is only scheduled if nobody paused/cancelled it.
      const amountSent = Number(manualTopup.amountSent) + amount;
      const completed = amountSent >= Number(manualTopup.totalAmount);
      await manager.update(
        ManualTopup,
        manualTopup.id,
        completed
          ? {
              amountSent: amountSent.toFixed(2),
              status: ManualTopupStatus.COMPLETED,
              nextRunAt: null,
            }
          : { amountSent: amountSent.toFixed(2) },
      );
      if (!completed) {
        await manager.update(ManualTopup, onlyIfActive, {
          nextRunAt: new Date(now + (manualTopup.intervalSeconds ?? 0) * 1000),
        });
      }
    });

    if (result.duplicate) {
      throw new ConflictException(result.response);
    }

    if (sendStatus === ManualTopupSendStatus.UNKNOWN) {
      this.logger.error(
        `Manual top-up ${manualTopup.id}: send ${send.id} outcome unknown (${result.response}) - paused for manual check`,
      );
    }

    if (
      sendStatus === ManualTopupSendStatus.SUCCESS &&
      manualTopup.referralCode
    ) {
      await this.creditReferralCommission(manualTopup, send.id, amount);
    }
  }

  /**
   * Same commission flow as a referred checkout (TopupService.handleInvoicePaid),
   * once per successful send with the coin amount as the gross amount (no bonus
   * coin on a manual send). Keyed per send so the super affiliate's
   * once-per-transaction guard allows every installment. The coin already went
   * out, so a crediting failure is logged, never thrown into the send flow.
   */
  private async creditReferralCommission(
    manualTopup: ManualTopup,
    sendId: string,
    amount: number,
  ): Promise<void> {
    const transactionId = manualTopupSendKey(manualTopup.id, sendId);
    const referralCode = manualTopup.referralCode!;
    const grossAmount = amount.toFixed(2);
    try {
      await this.affiliatesService.creditCommissionForTransaction({
        referralCode,
        transactionId,
        originalAmount: grossAmount,
      });
      await this.superAffiliatesService.creditCommissionForTransaction({
        referralCode,
        transactionId,
        grossAmount,
      });
    } catch (error) {
      this.logger.error(
        `Commission credit failed for manual send ${transactionId} (code ${referralCode}, amount ${grossAmount}) - credit it manually: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
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
}
