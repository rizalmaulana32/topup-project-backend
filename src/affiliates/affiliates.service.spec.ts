import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { TransactionsService } from '../transactions/transactions.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { LinkQuService } from '../linkqu/linkqu.service';
import { AffiliatesService } from './affiliates.service';
import { AffiliatorProfile } from './entities/affiliator-profile.entity';
import { CommissionLog } from './entities/commission-log.entity';
import { CommissionWithdrawal } from './entities/commission-withdrawal.entity';

describe('AffiliatesService', () => {
  let profileCreateMock: jest.Mock;
  let profileSaveMock: jest.Mock;
  let profileFindOneMock: jest.Mock;
  let commissionLogFindMock: jest.Mock;
  let withdrawalFindOneMock: jest.Mock;
  let createUserMock: jest.Mock;
  let updateStatusMock: jest.Mock;
  let findByReferralCodeMock: jest.Mock;
  let settingsGetMock: jest.Mock;
  let service: AffiliatesService;

  const defaultSettings = {
    id: 1,
    globalCommissionRate: '10.00',
    minimumWithdrawalAmount: '100000.00',
  };

  beforeEach(() => {
    profileCreateMock = jest.fn();
    profileSaveMock = jest.fn();
    profileFindOneMock = jest.fn();
    commissionLogFindMock = jest.fn();
    withdrawalFindOneMock = jest.fn();
    createUserMock = jest.fn();
    updateStatusMock = jest.fn();
    findByReferralCodeMock = jest.fn();
    settingsGetMock = jest.fn().mockResolvedValue(defaultSettings);

    const profileRepository = {
      create: profileCreateMock,
      save: profileSaveMock,
      findOne: profileFindOneMock,
    } as unknown as Repository<AffiliatorProfile>;
    const commissionLogRepository = {
      find: commissionLogFindMock,
    } as unknown as Repository<CommissionLog>;
    const withdrawalRepository = {
      findOne: withdrawalFindOneMock,
    } as unknown as Repository<CommissionWithdrawal>;
    const dataSource = {} as unknown as DataSource;
    const usersService = {
      createUser: createUserMock,
      updateStatus: updateStatusMock,
    } as unknown as UsersService;
    const transactionsService = {
      findByReferralCode: findByReferralCodeMock,
    } as unknown as TransactionsService;
    const settingsService = {
      get: settingsGetMock,
    } as unknown as SettingsService;
    const linkQuService = {} as unknown as LinkQuService;

    service = new AffiliatesService(
      profileRepository,
      commissionLogRepository,
      withdrawalRepository,
      dataSource,
      usersService,
      transactionsService,
      settingsService,
      linkQuService,
    );
  });

  describe('register', () => {
    it('creates a pending user and an affiliate profile using the global commission rate', async () => {
      createUserMock.mockResolvedValue({
        id: '1',
        email: 'ana@example.com',
        status: UserStatus.PENDING_APPROVAL,
      });
      profileCreateMock.mockReturnValue({ userId: '1' });
      profileSaveMock.mockResolvedValue({ userId: '1' });

      const result = await service.register({
        name: 'Ana Affiliate',
        email: 'ana@example.com',
        password: 'super-secret',
        bank_name: 'BCA',
        account_number: '1234567890',
        account_holder: 'Ana Affiliate',
      });

      expect(settingsGetMock).toHaveBeenCalled();
      expect(createUserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ana Affiliate',
          email: 'ana@example.com',
          role: UserRole.AFFILIATOR,
          status: UserStatus.PENDING_APPROVAL,
        }),
      );
      expect(profileCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '1',
          bankName: 'BCA',
          accountNumber: '1234567890',
          accountHolder: 'Ana Affiliate',
          commissionRate: '10.00',
        }),
      );
      expect(result).toEqual({
        user_id: '1',
        email: 'ana@example.com',
        status: UserStatus.PENDING_APPROVAL,
        message:
          'Registration received. Your account is pending superadmin approval.',
      });
    });
  });

  describe('getDashboard', () => {
    it('throws NotFoundException when no profile exists for the user', async () => {
      profileFindOneMock.mockResolvedValue(null);

      await expect(service.getDashboard('999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the affiliate is not yet approved', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '1',
        userId: '1',
        affiliateCode: null,
        user: { status: UserStatus.PENDING_APPROVAL },
      });

      await expect(service.getDashboard('1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns balance, referred transactions, and commission history for an active affiliate', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '1',
        userId: '1',
        affiliateCode: 'AFF-ABC123',
        commissionBalance: '0.00',
        totalCommissionEarned: '0.00',
        user: { status: UserStatus.ACTIVE },
      });
      findByReferralCodeMock.mockResolvedValue([
        {
          id: 'TRX-1',
          paymentStatus: 'paid',
          grossAmount: '20000.00',
          createdAt: new Date('2026-08-10T00:00:00Z'),
        },
      ]);
      commissionLogFindMock.mockResolvedValue([]);

      const result = await service.getDashboard('1');

      expect(findByReferralCodeMock).toHaveBeenCalledWith('AFF-ABC123');
      expect(result.affiliate_code).toBe('AFF-ABC123');
      expect(result.referred_transaction_count).toBe(1);
      expect(result.referred_transactions[0]).toEqual(
        expect.objectContaining({ transaction_id: 'TRX-1' }),
      );
      expect(result.commission_history).toEqual([]);
    });
  });

  describe('approve', () => {
    it('generates a referral code and activates the affiliate', async () => {
      const pendingProfile = {
        id: '1',
        userId: '1',
        affiliateCode: null,
        user: { status: UserStatus.PENDING_APPROVAL },
      };
      const approvedProfile = {
        ...pendingProfile,
        affiliateCode: 'AFF-GENERATED',
      };
      profileFindOneMock
        .mockResolvedValueOnce(pendingProfile) // findProfileByIdOrFail (start of approve)
        .mockResolvedValueOnce(null) // uniqueness check inside generateUniqueReferralCode
        .mockResolvedValueOnce(approvedProfile); // findProfileByIdOrFail (return value)
      profileSaveMock.mockResolvedValue(undefined);

      const result = await service.approve('1', 'admin-1');

      expect(result.affiliateCode).toBe('AFF-GENERATED');
      expect(updateStatusMock).toHaveBeenCalledWith('1', UserStatus.ACTIVE);
    });

    it('keeps an existing referral code on re-approval', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '1',
        userId: '1',
        affiliateCode: 'AFF-EXISTING',
        user: { status: UserStatus.INACTIVE },
      });
      profileSaveMock.mockResolvedValue(undefined);

      const result = await service.approve('1', 'admin-1');

      expect(result.affiliateCode).toBe('AFF-EXISTING');
    });

    it('throws NotFoundException for an unknown profile', async () => {
      profileFindOneMock.mockResolvedValue(null);

      await expect(service.approve('999', 'admin-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('sets the user status to inactive', async () => {
      profileFindOneMock.mockResolvedValue({ id: '1', userId: '1' });

      await service.reject('1');

      expect(updateStatusMock).toHaveBeenCalledWith('1', UserStatus.INACTIVE);
    });
  });

  describe('updateCommissionRate', () => {
    it('updates and formats the commission rate', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '1',
        commissionRate: '10.00',
      });
      profileSaveMock.mockImplementation((v: unknown) => Promise.resolve(v));

      const result = await service.updateCommissionRate('1', 12.5);

      expect(result).toEqual(
        expect.objectContaining({ commissionRate: '12.50' }),
      );
    });
  });

  describe('updateBankDetails', () => {
    it('updates only the provided fields', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '1',
        userId: '1',
        bankName: 'BCA',
        accountNumber: '1234567890',
        accountHolder: 'Old Name',
      });
      profileSaveMock.mockImplementation((v: unknown) => Promise.resolve(v));

      const result = await service.updateBankDetails('1', {
        accountHolder: 'New Name',
      });

      expect(result).toEqual(
        expect.objectContaining({
          bankName: 'BCA',
          accountNumber: '1234567890',
          accountHolder: 'New Name',
        }),
      );
    });

    it('throws NotFoundException when no profile matches the user', async () => {
      profileFindOneMock.mockResolvedValue(null);

      await expect(
        service.updateBankDetails('999', { bankName: 'BNI' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findWithdrawalByIdOrFail', () => {
    it('throws NotFoundException when no withdrawal matches', async () => {
      withdrawalFindOneMock.mockResolvedValue(null);

      await expect(
        service.findWithdrawalByIdOrFail('WDW-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generateUniqueReferralCode via approve', () => {
    it('retries when a generated code already exists, eventually throwing ConflictException if exhausted', async () => {
      profileFindOneMock
        .mockResolvedValueOnce({
          id: '1',
          userId: '1',
          affiliateCode: null,
          user: { status: UserStatus.PENDING_APPROVAL },
        })
        // Every uniqueness check inside generateUniqueReferralCode reports a collision.
        .mockResolvedValue({ id: 'collides' });

      await expect(service.approve('1', 'admin-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
