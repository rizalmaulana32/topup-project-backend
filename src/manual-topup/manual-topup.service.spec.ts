import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AdminProfile } from './entities/admin-profile.entity';
import { ManualTopup, ManualTopupStatus } from './entities/manual-topup.entity';
import { ManualTopupSend } from './entities/manual-topup-send.entity';
import { ManualTopupService } from './manual-topup.service';
import { UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';

describe('ManualTopupService', () => {
  let checkIdMock: jest.Mock;
  let injectCoinMock: jest.Mock;
  let profileExistsMock: jest.Mock;
  let profileFindOneMock: jest.Mock;
  let manualTopupFindOneByMock: jest.Mock;
  let manualTopupSaveMock: jest.Mock;
  let manualTopupCreateMock: jest.Mock;
  let service: ManualTopupService;

  beforeEach(() => {
    checkIdMock = jest.fn();
    injectCoinMock = jest.fn();
    profileExistsMock = jest.fn().mockResolvedValue(false);
    profileFindOneMock = jest.fn().mockResolvedValue(null);
    manualTopupFindOneByMock = jest.fn();
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
      update: jest.fn().mockResolvedValue(undefined),
      findOneByOrFail: jest.fn((where: { id: string }) =>
        Promise.resolve({ id: where.id }),
      ),
      findOneBy: manualTopupFindOneByMock,
    } as unknown as Repository<ManualTopup>;
    const sendRepository = {
      create: jest.fn((entity) => entity),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<ManualTopupSend>;
    const dataSource = {} as unknown as DataSource;
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

    it('rejects amount_per_send without interval_minutes', async () => {
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

    it('rejects interval_minutes without amount_per_send', async () => {
      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 10000,
          intervalMinutes: 5,
          createdBy: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(checkIdMock).not.toHaveBeenCalled();
    });

    it('rejects amount_per_send greater than total_amount', async () => {
      await expect(
        service.createManualTopup({
          momoUserId: '12345',
          totalAmount: 100,
          amountPerSend: 500,
          intervalMinutes: 5,
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
      expect(saved.intervalMinutes).toBeNull();
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
});

describe('ManualTopupService admin management', () => {
  const admin = { id: '5', userId: '50', referralCode: 'ADM-OLD', user: {} };
  let profileFindOneMock: jest.Mock;
  let profileUpdateMock: jest.Mock;
  let profileSoftDeleteMock: jest.Mock;
  let manualTopupUpdateMock: jest.Mock;
  let usersService: Record<string, jest.Mock>;
  let service: ManualTopupService;

  beforeEach(() => {
    profileFindOneMock = jest.fn();
    profileUpdateMock = jest.fn();
    profileSoftDeleteMock = jest.fn();
    manualTopupUpdateMock = jest.fn();
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
      {} as unknown as DataSource,
      usersService as unknown as UsersService,
      {} as unknown as ProviderTopUpPort,
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

  it('updateAdmin rejects a referral code another admin already has', async () => {
    profileFindOneMock
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce({ id: '6', referralCode: 'ADM-TAKEN' });

    await expect(
      service.updateAdmin('5', { name: 'New', referralCode: 'ADM-TAKEN' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(profileUpdateMock).not.toHaveBeenCalled();
    expect(usersService.updateAccount).not.toHaveBeenCalled();
  });
});
