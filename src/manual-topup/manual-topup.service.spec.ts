import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AdminProfile } from './entities/admin-profile.entity';
import { ManualTopup } from './entities/manual-topup.entity';
import { ManualTopupSend } from './entities/manual-topup-send.entity';
import { ManualTopupService } from './manual-topup.service';
import { UsersService } from '../users/users.service';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';

describe('ManualTopupService', () => {
  let checkIdMock: jest.Mock;
  let injectCoinMock: jest.Mock;
  let profileExistsMock: jest.Mock;
  let manualTopupSaveMock: jest.Mock;
  let manualTopupCreateMock: jest.Mock;
  let service: ManualTopupService;

  beforeEach(() => {
    checkIdMock = jest.fn();
    injectCoinMock = jest.fn();
    profileExistsMock = jest.fn().mockResolvedValue(false);
    manualTopupCreateMock = jest.fn((entity) => entity);
    manualTopupSaveMock = jest.fn((entity) =>
      Promise.resolve({ ...entity, id: entity.id ?? 'MTU-TEST' }),
    );

    const profileRepository = {
      exists: profileExistsMock,
    } as unknown as Repository<AdminProfile>;
    const manualTopupRepository = {
      create: manualTopupCreateMock,
      save: manualTopupSaveMock,
      update: jest.fn().mockResolvedValue(undefined),
      findOneByOrFail: jest.fn((where: { id: string }) =>
        Promise.resolve({ id: where.id }),
      ),
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
      checkIdMock.mockResolvedValue({ username: 'Player_12345', avatarUrl: null });
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
      checkIdMock.mockResolvedValue({ username: 'Player_12345', avatarUrl: null });
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
});
