import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import { SettingsService } from '../settings/settings.service';
import { TransactionsService } from '../transactions/transactions.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AffiliatesService } from './affiliates.service';
import { AffiliatorProfile } from './entities/affiliator-profile.entity';
import { CommissionLog } from './entities/commission-log.entity';
import {
  CommissionWithdrawal,
  WithdrawalMethod,
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
  let checkIdMock: jest.Mock;
  let injectCoinMock: jest.Mock;
  let withdrawalUpdateMock: jest.Mock;
  let withdrawalFindMock: jest.Mock;
  let adminProfileFindOneMock: jest.Mock;
  let findByIdsMock: jest.Mock;
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
    checkIdMock = jest.fn();
    injectCoinMock = jest.fn();
    withdrawalUpdateMock = jest.fn();
    withdrawalFindMock = jest.fn().mockResolvedValue([]);
    adminProfileFindOneMock = jest.fn();
    findByIdsMock = jest.fn().mockResolvedValue([]);

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
      find: withdrawalFindMock,
      update: withdrawalUpdateMock,
    } as unknown as Repository<CommissionWithdrawal>;
    const dataSource = {
      getRepository: () => ({ findOne: adminProfileFindOneMock }),
    } as unknown as DataSource;
    const usersService = {
      createUser: createUserMock,
      findByEmail: findByEmailMock,
      updateStatus: updateStatusMock,
      archiveEmailForReuse: archiveEmailForReuseMock,
      updatePasswordHash: updatePasswordHashMock,
    } as unknown as UsersService;
    const transactionsService = {
      findByReferralCode: findByReferralCodeMock,
      findByIds: findByIdsMock,
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
      {
        checkId: checkIdMock,
        injectCoin: injectCoinMock,
      } as unknown as ProviderTopUpPort,
    );
  });

  describe('getAdminAffiliateDetail', () => {
    it('adds the Momo username and avatar per referred transaction, one lookup per distinct ID, null on failure', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '17',
        affiliateCode: 'LOVERS',
        user: { name: 'A', email: 'a@x.com', status: UserStatus.ACTIVE },
      });
      findByReferralCodeMock.mockResolvedValue([
        { id: 'TRX-1', targetUserId: '111' },
        { id: 'TRX-2', targetUserId: '111' },
        { id: 'TRX-3', targetUserId: '222' },
      ]);
      commissionLogFindMock.mockResolvedValue([]);
      checkIdMock.mockImplementation((_game: string, id: string) =>
        id === '111'
          ? Promise.resolve({ username: 'Budi', avatarUrl: 'https://a/b.png' })
          : Promise.reject(new Error('user not found')),
      );

      const result = await service.getAdminAffiliateDetail('17');

      expect(checkIdMock).toHaveBeenCalledTimes(2);
      expect(
        result.referred_transactions.map((t) => [
          t.target_user_id,
          t.username,
          t.avatar_url,
        ]),
      ).toEqual([
        ['111', 'Budi', 'https://a/b.png'],
        ['111', 'Budi', 'https://a/b.png'],
        ['222', null, null],
      ]);
    });

    it('adds Momo info to commission history, including transactions under an old referral code', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '17',
        affiliateCode: 'NEWCODE',
        user: { name: 'A', email: 'a@x.com', status: UserStatus.ACTIVE },
      });
      findByReferralCodeMock.mockResolvedValue([]);
      commissionLogFindMock.mockResolvedValue([
        { type: 'credit', transactionId: 'TRX-OLD' },
        { type: 'debit', transactionId: null },
      ]);
      findByIdsMock.mockResolvedValue([{ id: 'TRX-OLD', targetUserId: '333' }]);
      checkIdMock.mockResolvedValue({ username: 'Sari', avatarUrl: 'x.png' });

      const result = await service.getAdminAffiliateDetail('17');

      expect(findByIdsMock).toHaveBeenCalledWith(['TRX-OLD']);
      expect(
        result.commission_history.map((c) => [
          c.transaction_id,
          c.target_user_id,
          c.username,
          c.avatar_url,
        ]),
      ).toEqual([
        ['TRX-OLD', '333', 'Sari', 'x.png'],
        [null, null, null, null],
      ]);
    });
  });

  describe('register', () => {
    const registerDto = {
      name: 'Ana Affiliate',
      email: 'ana@example.com',
      password: 'super-secret',
      bank_name: 'BCA',
      account_number: '123',
      account_holder: 'Ana',
      phone_number: '0812',
    };

    it('links the new affiliate to the admin whose referral code was used', async () => {
      adminProfileFindOneMock.mockResolvedValue({
        id: '5',
        user: { status: UserStatus.ACTIVE },
      });
      createUserMock.mockResolvedValue({ id: '1', email: 'ana@example.com' });
      profileCreateMock.mockImplementation((entity) => entity);

      await service.register({ ...registerDto, referral_code: 'ADM-ABC123' });

      expect(profileCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ adminProfileId: '5' }),
      );
    });

    it('rejects an unknown admin referral code without creating the user', async () => {
      adminProfileFindOneMock.mockResolvedValue(null);

      await expect(
        service.register({ ...registerDto, referral_code: 'ADM-NOPE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createUserMock).not.toHaveBeenCalled();
    });

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
    it('describes withdrawal entries in commission_history as bank or Momo coin payouts', async () => {
      profileFindOneMock.mockResolvedValue({
        id: '1',
        userId: '1',
        affiliateCode: 'AFF-ABC123',
        user: { status: UserStatus.ACTIVE },
      });
      findByReferralCodeMock.mockResolvedValue([]);
      commissionLogFindMock.mockResolvedValue([
        { type: 'debit', transactionId: null, withdrawalId: 'WDW-COIN' },
        { type: 'debit', transactionId: null, withdrawalId: 'WDW-BANK' },
      ]);
      withdrawalFindMock.mockResolvedValue([
        {
          id: 'WDW-COIN',
          method: WithdrawalMethod.MOMO_COIN,
          momoUserId: '7100001',
          netAmount: '60000.00',
          bankName: null,
        },
        {
          id: 'WDW-BANK',
          method: WithdrawalMethod.BANK,
          momoUserId: null,
          netAmount: '50000.00',
          bankName: 'BCA',
        },
      ]);
      checkIdMock.mockResolvedValue({ username: 'Budi', avatarUrl: 'b.png' });

      const result = await service.getDashboard('1');

      expect(result.commission_history[0].withdrawal).toEqual(
        expect.objectContaining({
          method: WithdrawalMethod.MOMO_COIN,
          coin_amount: '60000.00',
          momo_user_id: '7100001',
          momo_username: 'Budi',
          momo_avatar_url: 'b.png',
        }),
      );
      expect(result.commission_history[1].withdrawal).toEqual(
        expect.objectContaining({
          method: WithdrawalMethod.BANK,
          coin_amount: null,
          bank_name: 'BCA',
        }),
      );
    });

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
          targetUserId: '111',
          paymentStatus: 'paid',
          grossAmount: '20000.00',
          createdAt: new Date('2026-08-10T00:00:00Z'),
        },
      ]);
      commissionLogFindMock.mockResolvedValue([]);
      checkIdMock.mockResolvedValue({ username: 'Budi', avatarUrl: 'b.png' });

      const result = await service.getDashboard('1');

      expect(findByReferralCodeMock).toHaveBeenCalledWith('AFF-ABC123');
      expect(result.affiliate_code).toBe('AFF-ABC123');
      expect(result.referred_transaction_count).toBe(1);
      expect(result.referred_transactions[0]).toEqual(
        expect.objectContaining({
          transaction_id: 'TRX-1',
          target_user_id: '111',
          username: 'Budi',
          avatar_url: 'b.png',
        }),
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

    it('uses a custom referral code instead of auto-generating one', async () => {
      const pendingProfile = {
        id: '1',
        userId: '1',
        affiliateCode: null,
        user: { status: UserStatus.PENDING_APPROVAL },
      };
      const approvedProfile = {
        ...pendingProfile,
        affiliateCode: 'YAY-CUSTOM',
      };
      profileFindOneMock
        .mockResolvedValueOnce(pendingProfile) // findProfileByIdOrFail
        .mockResolvedValueOnce(null) // custom-code uniqueness check: free
        .mockResolvedValueOnce(approvedProfile); // findProfileByIdOrFail (return value)
      profileSaveMock.mockResolvedValue(undefined);

      const result = await service.approve('1', 'admin-1', 'YAY-CUSTOM');

      expect(result.affiliateCode).toBe('YAY-CUSTOM');
    });

    it('rejects a custom referral code already used by another affiliate', async () => {
      const pendingProfile = {
        id: '1',
        userId: '1',
        affiliateCode: null,
        user: { status: UserStatus.PENDING_APPROVAL },
      };
      profileFindOneMock
        .mockResolvedValueOnce(pendingProfile) // findProfileByIdOrFail
        .mockResolvedValueOnce({ id: '2', affiliateCode: 'YAY-CUSTOM' }); // taken by someone else

      await expect(
        service.approve('1', 'admin-1', 'YAY-CUSTOM'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(profileSaveMock).not.toHaveBeenCalled();
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
    // In-memory row so the conditional update (WHERE status = pending) behaves like the DB.
    let row: Record<string, unknown>;
    beforeEach(() => {
      withdrawalFindOneMock.mockImplementation(() =>
        Promise.resolve({ ...row }),
      );
      withdrawalUpdateMock.mockImplementation(
        (
          criteria: string | { status?: string },
          patch: Record<string, unknown>,
        ) => {
          if (typeof criteria === 'object' && criteria.status !== row.status) {
            return Promise.resolve({ affected: 0 });
          }
          row = { ...row, ...patch };
          return Promise.resolve({ affected: 1 });
        },
      );
    });

    it('moves a pending bank withdrawal to approved without sending anything', async () => {
      row = {
        id: 'WDW-1',
        method: WithdrawalMethod.BANK,
        status: WithdrawalStatus.PENDING,
      };

      const result = await service.approveWithdrawal('WDW-1', 'admin-1');

      expect(result.status).toBe(WithdrawalStatus.APPROVED);
      expect(result.approvedBy).toBe('admin-1');
      expect(result.approvedAt).toBeInstanceOf(Date);
      expect(injectCoinMock).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the withdrawal is not pending', async () => {
      row = {
        id: 'WDW-1',
        method: WithdrawalMethod.MOMO_COIN,
        status: WithdrawalStatus.APPROVED,
      };

      await expect(
        service.approveWithdrawal('WDW-1', 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(injectCoinMock).not.toHaveBeenCalled();
    });

    it('sends net_amount Momo coins and marks a momo_coin withdrawal paid', async () => {
      row = {
        id: 'WDW-1',
        method: WithdrawalMethod.MOMO_COIN,
        momoUserId: '7100001',
        netAmount: '95000.00',
        status: WithdrawalStatus.PENDING,
      };
      injectCoinMock.mockResolvedValue({ success: true, response: 'ok' });

      const result = await service.approveWithdrawal('WDW-1', 'admin-1');

      expect(injectCoinMock).toHaveBeenCalledWith(
        expect.objectContaining({ targetUserId: '7100001', coin: 95000 }),
      );
      expect(result.status).toBe(WithdrawalStatus.PAID);
      expect(result.processedBy).toBe('admin-1');
    });

    it('puts a momo_coin withdrawal back to pending when the coin send fails', async () => {
      row = {
        id: 'WDW-1',
        method: WithdrawalMethod.MOMO_COIN,
        momoUserId: '7100001',
        netAmount: '95000.00',
        status: WithdrawalStatus.PENDING,
      };
      injectCoinMock.mockRejectedValue(new Error('provider down'));

      await expect(
        service.approveWithdrawal('WDW-1', 'admin-1'),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(row.status).toBe(WithdrawalStatus.PENDING);
      expect(row.approvedBy).toBeNull();
    });
  });

  describe('requestWithdrawal', () => {
    it('rejects a momo_coin withdrawal to a Momo ID that does not exist', async () => {
      checkIdMock.mockRejectedValue(new Error('user not found'));

      await expect(
        service.requestWithdrawal('1', 100000, {
          method: WithdrawalMethod.MOMO_COIN,
          momoUserId: '999',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
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
