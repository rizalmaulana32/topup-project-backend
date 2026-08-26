import { Repository } from 'typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let findOneMock: jest.Mock;
  let createMock: jest.Mock;
  let saveMock: jest.Mock;
  let service: SettingsService;

  beforeEach(() => {
    findOneMock = jest.fn();
    createMock = jest.fn();
    saveMock = jest.fn();

    const repository = {
      findOne: findOneMock,
      create: createMock,
      save: saveMock,
    } as unknown as Repository<PlatformSettings>;

    service = new SettingsService(repository);
  });

  describe('get', () => {
    it('returns the existing settings row if present', async () => {
      const existing = {
        id: 1,
        globalCommissionRate: '15.00',
        minimumWithdrawalAmount: '50000.00',
      };
      findOneMock.mockResolvedValue(existing);

      const result = await service.get();

      expect(result).toBe(existing);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('creates and persists a default row when none exists', async () => {
      findOneMock.mockResolvedValue(null);
      const defaults = { id: 1 };
      createMock.mockReturnValue(defaults);
      saveMock.mockResolvedValue(defaults);

      const result = await service.get();

      expect(createMock).toHaveBeenCalledWith({ id: 1 });
      expect(saveMock).toHaveBeenCalledWith(defaults);
      expect(result).toBe(defaults);
    });
  });

  describe('update', () => {
    it('updates only the provided fields', async () => {
      const current = {
        id: 1,
        globalCommissionRate: '10.00',
        minimumWithdrawalAmount: '100000.00',
      };
      findOneMock.mockResolvedValue(current);
      saveMock.mockImplementation((value: PlatformSettings) =>
        Promise.resolve(value),
      );

      const result = await service.update({ globalCommissionRate: 12.5 });

      expect(result.globalCommissionRate).toBe('12.50');
      expect(result.minimumWithdrawalAmount).toBe('100000.00');
    });

    it('sets admin payout bank details', async () => {
      const current = {
        id: 1,
        globalCommissionRate: '10.00',
        minimumWithdrawalAmount: '100000.00',
        adminBankName: null,
        adminAccountNumber: null,
        adminAccountHolder: null,
      };
      findOneMock.mockResolvedValue(current);
      saveMock.mockImplementation((value: PlatformSettings) =>
        Promise.resolve(value),
      );

      const result = await service.update({
        adminBankName: 'BCA',
        adminAccountNumber: '9999999999',
        adminAccountHolder: 'Platform Admin',
      });

      expect(result.adminBankName).toBe('BCA');
      expect(result.adminAccountNumber).toBe('9999999999');
      expect(result.adminAccountHolder).toBe('Platform Admin');
    });
  });
});
