import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AdminProfile } from './entities/admin-profile.entity';
import { ManualTopup, ManualTopupStatus } from './entities/manual-topup.entity';
import { ManualTopupSend } from './entities/manual-topup-send.entity';
import { ManualTopupService } from './manual-topup.service';
import { UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import type { AffiliatesService } from '../affiliates/affiliates.service';
import type { SuperAffiliatesService } from '../super-affiliates/super-affiliates.service';

describe('ManualTopupService', () => {
  let checkIdMock: jest.Mock;
  let injectCoinMock: jest.Mock;
  let profileExistsMock: jest.Mock;
  let profileFindOneMock: jest.Mock;
  let manualTopupFindOneByMock: jest.Mock;
  let manualTopupSaveMock: jest.Mock;
  let manualTopupCreateMock: jest.Mock;
  let manualTopupFindMock: jest.Mock;
  let claimExecuteMock: jest.Mock;
  let sendUpdateMock: jest.Mock;
  let manualTopupUpdateMock: jest.Mock;
  let checkCodeValidityMock: jest.Mock;
  let affiliateCreditMock: jest.Mock;
  let superAffiliateCreditMock: jest.Mock;
  let service: ManualTopupService;

  beforeEach(() => {
    checkCodeValidityMock = jest.fn().mockResolvedValue({ valid: true });
    affiliateCreditMock = jest.fn().mockResolvedValue('0.00');
    superAffiliateCreditMock = jest.fn().mockResolvedValue('0.00');
    checkIdMock = jest.fn();
    injectCoinMock = jest.fn();
    profileExistsMock = jest.fn().mockResolvedValue(false);
    profileFindOneMock = jest.fn().mockResolvedValue(null);
    manualTopupFindOneByMock = jest.fn();
    manualTopupFindMock = jest.fn().mockResolvedValue([]);
    manualTopupUpdateMock = jest.fn().mockResolvedValue(undefined);
    claimExecuteMock = jest.fn().mockResolvedValue({ affected: 1 });
    const claimQb = {
      update: () => claimQb,
      set: () => claimQb,
      where: () => claimQb,
      andWhere: () => claimQb,
      execute: claimExecuteMock,
    };
    manualTopupCreateMock = jest.fn((entity) => entity);
    manualTopupSaveMock = jest.fn((entity) =>
      Promise.resolve({ ...entity, id: entity.id ?? 'MTU-TEST' }),
    );

    const profileRepository = {
      exists: profileExistsMock,
      findOne: profileFindOneMock,
    } as unknown as Repository<AdminProfile>;
    const manualTopupRepository = {
      create: manualTopupCreateMock,
      save: manualTopupSaveMock,
      update: manualTopupUpdateMock,
      findOneByOrFail: jest.fn((where: { id: string }) =>
        Promise.resolve({ id: where.id }),
      ),
      findOneBy: manualTopupFindOneByMock,
      find: manualTopupFindMock,
      createQueryBuilder: () => claimQb,
    } as unknown as Repository<ManualTopup>;
    sendUpdateMock = jest.fn().mockResolvedValue(undefined);
    const sendRepository = {
      create: jest.fn((entity) => entity),
      save: jest.fn((entity: object) =>
        Promise.resolve({ ...entity, id: 'SEND-1' }),
      ),
      update: sendUpdateMock,
    } as unknown as Repository<ManualTopupSend>;
    const txManager = {
      update: (entity: unknown, criteria: unknown, changes: unknown) =>
        entity === ManualTopupSend
          ? sendUpdateMock(criteria, changes)
          : manualTopupUpdateMock(criteria, changes),
      increment: jest.fn(),
    };
    const dataSource = {
      transaction: (fn: (manager: typeof txManager) => Promise<unknown>) =>
        fn(txManager),
    } as unknown as DataSource;
    const usersService = {} as unknown as UsersService;
    const providerTopUp: ProviderTopUpPort = {
      checkId: checkIdMock,
      injectCoin: injectCoinMock,
      getBalance: jest.fn(),
    };

    service = new ManualTopupService(
      profileRepository,
      manualTopupRepository,
      sendRepository,
      dataSource,
      usersService,
      providerTopUp,
      {
        checkCodeValidity: checkCodeValidityMock,
        creditCommissionForTransaction: affiliateCreditMock,
      } as unknown as AffiliatesService,
      {
        creditCommissionForTransaction: superAffiliateCreditMock,
      } as unknown as SuperAffiliatesService,
    );
  });

  describe('createManualTopup', () => {
    it('rejects an admin whose total_amount exceeds the remaining coin_limit', async () => {
      profileFindOneMock.mockResolvedValue({
        userId: '24',
        coinLimit: '1000.00',
        deletedAt: null,
      });

      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 1500,
          createdBy: '24',
        }),
      ).rejects.toThrow('remaining coin limit (1000)');
      expect(manualTopupSaveMock).not.toHaveBeenCalled();
      expect(injectCoinMock).not.toHaveBeenCalled();
    });

    it('rejects amount_per_send without interval_seconds', async () => {
      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 10000,
          amountPerSend: 100,
          createdBy: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(checkIdMock).not.toHaveBeenCalled();
    });

    it('rejects interval_seconds without amount_per_send', async () => {
      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 10000,
          intervalSeconds: 30,
          createdBy: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(checkIdMock).not.toHaveBeenCalled();
    });

    it('rejects interval_seconds below the minimum with 422', async () => {
      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 10000,
          amountPerSend: 100,
          intervalSeconds: 4,
          createdBy: '1',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(checkIdMock).not.toHaveBeenCalled();
    });

    it('rejects amount_per_send greater than total_amount', async () => {
      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 100,
          amountPerSend: 500,
          intervalSeconds: 30,
          createdBy: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(checkIdMock).not.toHaveBeenCalled();
    });

    it('sends the full total_amount once for a one-off send (no schedule fields)', async () => {
      checkIdMock.mockResolvedValue({
        username: 'Player_12345',
        avatarUrl: null,
      });
      injectCoinMock.mockResolvedValue({ success: true, response: '{}' });

      await service.createManualTopup({
        momoUserId: '12345',
        totalAmount: 10000,
        createdBy: '1',
      });

      expect(injectCoinMock).toHaveBeenCalledWith(
        expect.objectContaining({ targetUserId: '12345', coin: 10000 }),
      );
      const saved = manualTopupSaveMock.mock.calls[0][0];
      expect(saved.amountPerSend).toBe('10000.00');
      expect(saved.intervalSeconds).toBeNull();
    });

    it('auto-fills customer_name from the provider when not given', async () => {
      checkIdMock.mockResolvedValue({
        username: 'Player_12345',
        avatarUrl: null,
      });
      injectCoinMock.mockResolvedValue({ success: true, response: '{}' });

      await service.createManualTopup({
        momoUserId: '12345',
        totalAmount: 1000,
        createdBy: '1',
      });

      const saved = manualTopupSaveMock.mock.calls[0][0];
      expect(saved.customerName).toBe('Player_12345');
    });
  });

  describe('referral code', () => {
    beforeEach(() => {
      checkIdMock.mockResolvedValue({ username: 'P', avatarUrl: null });
    });

    it('rejects a code that is not an active affiliate, before sending anything', async () => {
      checkCodeValidityMock.mockResolvedValue({ valid: false });

      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 1000,
          referralCode: 'NOPE',
          createdBy: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(injectCoinMock).not.toHaveBeenCalled();
    });

    it('credits affiliate and super affiliate commission per successful send, keyed by send', async () => {
      injectCoinMock.mockResolvedValue({ success: true, response: '{}' });

      await service.createManualTopup({
        momoUserId: '12345',
        totalAmount: 1000,
        referralCode: 'AFF1',
        createdBy: '1',
      });

      const saved = (manualTopupSaveMock.mock.calls[0] as ManualTopup[])[0];
      expect(saved.referralCode).toBe('AFF1');
      expect(affiliateCreditMock).toHaveBeenCalledWith({
        referralCode: 'AFF1',
        transactionId: `${saved.id}#SEND-1`,
        originalAmount: '1000.00',
      });
      expect(superAffiliateCreditMock).toHaveBeenCalledWith({
        referralCode: 'AFF1',
        transactionId: `${saved.id}#SEND-1`,
        grossAmount: '1000.00',
      });
    });

    it('credits nothing when the send is rejected', async () => {
      injectCoinMock.mockResolvedValue({
        success: false,
        rejected: true,
        response: 'no',
      });

      await service.createManualTopup({
        momoUserId: '12345',
        totalAmount: 1000,
        referralCode: 'AFF1',
        createdBy: '1',
      });

      expect(affiliateCreditMock).not.toHaveBeenCalled();
      expect(superAffiliateCreditMock).not.toHaveBeenCalled();
    });

    it('does not fail the send when commission crediting throws', async () => {
      injectCoinMock.mockResolvedValue({ success: true, response: '{}' });
      affiliateCreditMock.mockRejectedValue(new Error('db down'));

      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 1000,
          referralCode: 'AFF1',
          createdBy: '1',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('ownership', () => {
    it("hides another user's manual top-up from an admin-role caller", async () => {
      manualTopupFindOneByMock.mockResolvedValue({
        id: 'MTU-1',
        createdBy: '1',
        status: 'active',
      });

      await expect(service.cancel('MTU-1', '24')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('processDueInstallments', () => {
    it('skips a due top-up whose claim was taken by another sweep', async () => {
      manualTopupFindMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'MTU-1' }]);
      claimExecuteMock.mockResolvedValue({ affected: 0 });

      await service.processDueInstallments();

      expect(injectCoinMock).not.toHaveBeenCalled();
    });

    const dueTopup = {
      id: 'MTU-1',
      momoUserId: '12345',
      totalAmount: '1000.00',
      amountPerSend: '100.00',
      amountSent: '0.00',
      intervalSeconds: 30,
      createdBy: '1',
    };
    // Due rows first, then (pauseStaleLocks runs first) stale rows.
    const mockDue = () =>
      manualTopupFindMock
        .mockResolvedValueOnce([]) // stale locks
        .mockResolvedValueOnce([{ id: 'MTU-1' }]); // due
    const updatesFor = (key: string) =>
      manualTopupUpdateMock.mock.calls.filter(
        ([, changes]) => key in (changes as object),
      ) as [unknown, Record<string, unknown>][];

    it('sends a claimed top-up once, schedules the next run interval_seconds later (only if still active) and releases its own lock', async () => {
      mockDue();
      manualTopupFindOneByMock.mockResolvedValue(dueTopup);
      injectCoinMock.mockResolvedValue({ success: true, response: '{}' });
      const before = Date.now();

      await service.processDueInstallments();

      expect(injectCoinMock).toHaveBeenCalledTimes(1);
      const [[criteria, changes]] = updatesFor('nextRunAt');
      expect(criteria).toEqual({
        id: 'MTU-1',
        status: ManualTopupStatus.ACTIVE,
      });
      const delay = (changes.nextRunAt as Date).getTime() - before;
      expect(delay).toBeGreaterThanOrEqual(30000);
      expect(delay).toBeLessThan(31000);
      const [[releaseCriteria]] = updatesFor('lockedAt') as [
        { id: string; lockedAt: Date },
        unknown,
      ][];
      expect(releaseCriteria.id).toBe('MTU-1');
      expect(releaseCriteria.lockedAt).toBeInstanceOf(Date);
      expect(sendUpdateMock).toHaveBeenCalledWith('SEND-1', {
        status: 'success',
        providerResponse: '{}',
      });
    });

    it('pauses (no retry, no refund) when the provider outcome is unknown', async () => {
      mockDue();
      manualTopupFindOneByMock.mockResolvedValue(dueTopup);
      injectCoinMock.mockResolvedValue({
        success: false,
        response: 'The operation was aborted due to timeout',
      });

      await service.processDueInstallments();

      expect(sendUpdateMock).toHaveBeenCalledWith(
        'SEND-1',
        expect.objectContaining({ status: 'unknown' }),
      );
      const [[criteria, changes]] = updatesFor('status');
      expect(criteria).toEqual({
        id: 'MTU-1',
        status: ManualTopupStatus.ACTIVE,
      });
      expect(changes).toEqual({
        status: ManualTopupStatus.PAUSED,
        nextRunAt: null,
      });
      expect(updatesFor('amountSent')).toHaveLength(0);
    });

    it('retries after one interval when the provider definitely rejected', async () => {
      mockDue();
      manualTopupFindOneByMock.mockResolvedValue(dueTopup);
      injectCoinMock.mockResolvedValue({
        success: false,
        rejected: true,
        response: 'rejected',
      });

      await service.processDueInstallments();

      expect(sendUpdateMock).toHaveBeenCalledWith(
        'SEND-1',
        expect.objectContaining({ status: 'failed' }),
      );
      expect(updatesFor('status')).toHaveLength(0);
      expect(updatesFor('nextRunAt')).toHaveLength(1);
      expect(updatesFor('amountSent')).toHaveLength(0);
    });

    it('pauses an active top-up whose lock went stale (crashed mid-send) instead of resending', async () => {
      const lockedAt = new Date(Date.now() - 10 * 60 * 1000);
      manualTopupFindMock
        .mockResolvedValueOnce([
          { id: 'MTU-1', status: ManualTopupStatus.ACTIVE, lockedAt },
        ])
        .mockResolvedValueOnce([]);

      await service.processDueInstallments();

      expect(manualTopupUpdateMock).toHaveBeenCalledWith(
        { id: 'MTU-1', lockedAt },
        { lockedAt: null, status: ManualTopupStatus.PAUSED, nextRunAt: null },
      );
      expect(injectCoinMock).not.toHaveBeenCalled();
    });
  });
});

describe('ManualTopupService admin management', () => {
  const admin = { id: '5', userId: '50', referralCode: 'ADM-OLD', user: {} };
  let profileFindOneMock: jest.Mock;
  let profileUpdateMock: jest.Mock;
  let profileSoftDeleteMock: jest.Mock;
  let manualTopupUpdateMock: jest.Mock;
  let referralCodeQueryMock: jest.Mock;
  let usersService: Record<string, jest.Mock>;
  let service: ManualTopupService;

  beforeEach(() => {
    profileFindOneMock = jest.fn();
    profileUpdateMock = jest.fn();
    profileSoftDeleteMock = jest.fn();
    manualTopupUpdateMock = jest.fn();
    referralCodeQueryMock = jest.fn().mockResolvedValue([]);
    usersService = {
      updateAccount: jest.fn(),
      updateStatus: jest.fn(),
      archiveEmailForReuse: jest.fn(),
    };
    service = new ManualTopupService(
      {
        findOne: profileFindOneMock,
        update: profileUpdateMock,
        softDelete: profileSoftDeleteMock,
      } as unknown as Repository<AdminProfile>,
      { update: manualTopupUpdateMock } as unknown as Repository<ManualTopup>,
      {} as unknown as Repository<ManualTopupSend>,
      { query: referralCodeQueryMock } as unknown as DataSource,
      usersService as unknown as UsersService,
      {} as unknown as ProviderTopUpPort,
      {} as unknown as AffiliatesService,
      {} as unknown as SuperAffiliatesService,
    );
  });

  it('deleteAdmin cancels the admin’s unfinished schedules before deactivating and soft-deleting', async () => {
    profileFindOneMock.mockResolvedValue(admin);

    await service.deleteAdmin('5');

    expect(manualTopupUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: '50' }),
      expect.objectContaining({ status: ManualTopupStatus.CANCELLED }),
    );
    expect(usersService.updateStatus).toHaveBeenCalledWith(
      '50',
      UserStatus.INACTIVE,
    );
    expect(usersService.archiveEmailForReuse).toHaveBeenCalledWith('50');
    expect(profileSoftDeleteMock).toHaveBeenCalledWith('5');
  });

  it('updateAdmin rejects a referral code another account (admin, super affiliate or affiliate) already has', async () => {
    profileFindOneMock.mockResolvedValueOnce(admin);
    referralCodeQueryMock.mockResolvedValueOnce([
      { table: 'super_affiliate_profiles', id: '6' },
    ]);

    await expect(
      service.updateAdmin('5', { name: 'New', referralCode: 'ADM-TAKEN' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(profileUpdateMock).not.toHaveBeenCalled();
    expect(usersService.updateAccount).not.toHaveBeenCalled();
  });
});
