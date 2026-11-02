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
import { AffiliatesService } from './affiliates.service';
import { AffiliatorProfile } from './entities/affiliator-profile.entity';
import { CommissionLog } from './entities/commission-log.entity';
import {
  CommissionWithdrawal,
  WithdrawalStatus,
} from './entities/commission-withdrawal.entity';

describe('AffiliatesService', () => {
  let profileCreateMock: jest.Mock;
  let profileSaveMock: jest.Mock;
  let profileFindOneMock: jest.Mock;
  let commissionLogFindMock: jest.Mock;
  let withdrawalFindOneMock: jest.Mock;
  let withdrawalSaveMock: jest.Mock;
  let createUserMock: jest.Mock;
  let findByEmailMock: jest.Mock;
  let updateStatusMock: jest.Mock;
  let archiveEmailForReuseMock: jest.Mock;
  let updatePasswordHashMock: jest.Mock;
  let profileSoftDeleteMock: jest.Mock;
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
    withdrawalSaveMock = jest.fn((entity) => Promise.resolve(entity));
    createUserMock = jest.fn();
    findByEmailMock = jest.fn();
    updateStatusMock = jest.fn();
    archiveEmailForReuseMock = jest.fn();
    updatePasswordHashMock = jest.fn();
    profileSoftDeleteMock = jest.fn();
    findByReferralCodeMock = jest.fn();
    settingsGetMock = jest.fn().mockResolvedValue(defaultSettings);

    const profileRepository = {
      create: profileCreateMock,
      save: profileSaveMock,
      findOne: profileFindOneMock,
      softDelete: profileSoftDeleteMock,
    } as unknown as Repository<AffiliatorProfile>;
    const commissionLogRepository = {
      find: commissionLogFindMock,
    } as unknown as Repository<CommissionLog>;
    const withdrawalRepository = {
      findOne: withdrawalFindOneMock,
      save: withdrawalSaveMock,
    } as unknown as Repository<CommissionWithdrawal>;
    const dataSource = {} as unknown as DataSource;
    const usersService = {
      createUser: createUserMock,
      findByEmail: findByEmailMock,
      updateStatus: updateStatusMock,
      archiveEmailForReuse: archiveEmailForReuseMock,
      updatePasswordHash: updatePasswordHashMock,
    } as unknown as UsersService;
    const transactionsService = {
      findByReferralCode: findByReferralCodeMock,
    } as unknown as TransactionsService;
    const settingsService = {
      get: settingsGetMock,
    } as unknown as SettingsService;

    service = new AffiliatesService(
      profileRepository,
      commissionLogRepository,
      withdrawalRepository,
      dataSource,
      usersService,
      transactionsService,
      settingsService,
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
        phone_number: '081234567890',
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

  describe('softDelete', () => {
    it('deactivates the user, archives their email for reuse, and soft-deletes the profile', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '1',
        userId: '42',
        user: { id: '42', email: 'affiliate@example.com' },
      });

      await service.softDelete('1');

      expect(updateStatusMock).toHaveBeenCalledWith('42', UserStatus.INACTIVE);
      expect(archiveEmailForReuseMock).toHaveBeenCalledWith('42');
      expect(profileSoftDeleteMock).toHaveBeenCalledWith('1');
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

  describe('setTieredCommissionEnabled', () => {
    it('enables tiered mode on the profile', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '1',
        tieredCommissionEnabled: false,
      });
      profileSaveMock.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.setTieredCommissionEnabled('1', true);

      expect(result.tieredCommissionEnabled).toBe(true);
      expect(profileSaveMock).toHaveBeenCalledWith(
        expect.objectContaining({ tieredCommissionEnabled: true }),
      );
    });

    it('throws NotFoundException for an unknown profile', async () => {
      profileFindOneMock.mockResolvedValue(null);

      await expect(
        service.setTieredCommissionEnabled('999', true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resetPassword', () => {
    it('hashes the new password and updates the linked user', async () => {
      profileFindOneMock.mockResolvedValue({ id: '1', userId: '42' });

      await service.resetPassword('1', 'a-new-secret-password');

      expect(updatePasswordHashMock).toHaveBeenCalledWith(
        '42',
        expect.any(String),
      );
      const hashUsed = updatePasswordHashMock.mock.calls[0][1] as string;
      expect(hashUsed).not.toBe('a-new-secret-password');
      expect(hashUsed.startsWith('$2b$')).toBe(true);
    });

    it('throws NotFoundException for an unknown profile', async () => {
      profileFindOneMock.mockResolvedValue(null);

      await expect(
        service.resetPassword('999', 'a-new-secret-password'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(updatePasswordHashMock).not.toHaveBeenCalled();
    });
  });

  describe('isEmailRegistered', () => {
    it('returns true when a user with that email exists', async () => {
      findByEmailMock.mockResolvedValue({ id: '1', email: 'a@b.com' });

      await expect(service.isEmailRegistered('a@b.com')).resolves.toBe(true);
    });

    it('returns false when no user has that email', async () => {
      findByEmailMock.mockResolvedValue(null);

      await expect(service.isEmailRegistered('nobody@b.com')).resolves.toBe(
        false,
      );
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

  describe('approveWithdrawal', () => {
    it('moves a pending withdrawal to approved without any disbursement call', async () => {
      withdrawalFindOneMock.mockResolvedValue({
        id: 'WDW-1',
        status: WithdrawalStatus.PENDING,
      });

      const result = await service.approveWithdrawal('WDW-1', 'admin-1');

      expect(result.status).toBe(WithdrawalStatus.APPROVED);
      expect(result.approvedBy).toBe('admin-1');
      expect(result.approvedAt).toBeInstanceOf(Date);
      expect(withdrawalSaveMock).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when the withdrawal is not pending', async () => {
      withdrawalFindOneMock.mockResolvedValue({
        id: 'WDW-1',
        status: WithdrawalStatus.APPROVED,
      });

      await expect(
        service.approveWithdrawal('WDW-1', 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(withdrawalSaveMock).not.toHaveBeenCalled();
    });
  });

  describe('markWithdrawalProcessed', () => {
    it('moves an approved withdrawal to paid and records the admin note', async () => {
      withdrawalFindOneMock.mockResolvedValue({
        id: 'WDW-1',
        status: WithdrawalStatus.APPROVED,
      });

      const result = await service.markWithdrawalProcessed(
        'WDW-1',
        'admin-1',
        'Transferred manually, ref 123',
      );

      expect(result.status).toBe(WithdrawalStatus.PAID);
      expect(result.processedBy).toBe('admin-1');
      expect(result.processedAt).toBeInstanceOf(Date);
      expect(result.adminNotes).toBe('Transferred manually, ref 123');
    });

    it('throws ConflictException when the withdrawal is not approved', async () => {
      withdrawalFindOneMock.mockResolvedValue({
        id: 'WDW-1',
        status: WithdrawalStatus.PENDING,
      });

      await expect(
        service.markWithdrawalProcessed('WDW-1', 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(withdrawalSaveMock).not.toHaveBeenCalled();
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
