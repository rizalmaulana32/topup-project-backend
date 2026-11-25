import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AffiliatorProfile } from '../src/affiliates/entities/affiliator-profile.entity';
import { LinkQuService } from '../src/linkqu/linkqu.service';
import {
  PaymentStatus,
  ProviderStatus,
  Transaction,
} from '../src/transactions/entities/transaction.entity';
import { User, UserRole, UserStatus } from '../src/users/entities/user.entity';

/**
 * Exercises the superadmin endpoints (SRS-ADM-01/02/03/05 + monitoring)
 * against a real Postgres database. Superadmin accounts are provisioned
 * directly through the repository (no self-registration endpoint exists,
 * by design — see plan/topup-affiliate-platform-superadmin-commission-payout-2026-08-10.md).
 *
 * LinkQuService is overridden with a deterministic double for the
 * GET /admin/linkqu/balance test only — this environment has no real
 * LINKQU_* credentials configured.
 */
class FakeLinkQuService {
  checkBalance() {
    return Promise.resolve({
      success: true,
      balance: 9806952445,
      unsettleAmount: 0,
      responseCode: '00',
      responseDesc: 'Berhasil',
    });
  }
}
describe('Admin (e2e)', () => {
  let app: INestApplication<App>;
  let userRepository: Repository<User>;
  let profileRepository: Repository<AffiliatorProfile>;
  let transactionRepository: Repository<Transaction>;

  let superadminToken: string;
  let pendingAffiliateProfileId: string;
  let secondPendingAffiliateProfileId: string;

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    const body = response.body as { data: { access_token: string } };
    return body.data.access_token;
  }

  async function registerPendingAffiliate(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/affiliate/register')
      .send({
        name: 'Pending Affiliate',
        email,
        password: 'super-secret-password',
        bank_name: 'BCA',
        account_number: '1234567890',
        account_holder: 'Pending Affiliate',
        phone_number: '081234567890',
      })
      .expect(201);
    const body = response.body as { data: { user_id: string } };
    const profile = await profileRepository.findOneOrFail({
      where: { userId: body.data.user_id },
    });
    return profile.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LinkQuService)
      .useClass(FakeLinkQuService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    userRepository = moduleFixture.get(getRepositoryToken(User));
    profileRepository = moduleFixture.get(
      getRepositoryToken(AffiliatorProfile),
    );
    transactionRepository = moduleFixture.get(getRepositoryToken(Transaction));

    await userRepository.query(
      'TRUNCATE TABLE commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_withdrawals, platform_revenue_logs, platform_settings, users, products RESTART IDENTITY CASCADE',
    );

    const passwordHash = await bcrypt.hash('admin-secret-password', 4);
    await userRepository.save(
      userRepository.create({
        name: 'Root Admin',
        email: 'admin.e2e@example.com',
        passwordHash,
        role: UserRole.SUPERADMIN,
        status: UserStatus.ACTIVE,
      }),
    );

    superadminToken = await login(
      'admin.e2e@example.com',
      'admin-secret-password',
    );
    pendingAffiliateProfileId = await registerPendingAffiliate(
      'pending1.e2e@example.com',
    );
    secondPendingAffiliateProfileId = await registerPendingAffiliate(
      'pending2.e2e@example.com',
    );
  });

  afterAll(async () => {
    await userRepository.query(
      'TRUNCATE TABLE commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_withdrawals, platform_revenue_logs, platform_settings, users, products RESTART IDENTITY CASCADE',
    );
    await app.close();
  });

  it('rejects admin routes without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .expect(401);
  });

  it('rejects admin routes for a non-superadmin (affiliate) token', async () => {
    const affiliateToken = await login(
      'pending1.e2e@example.com',
      'super-secret-password',
    );

    await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${affiliateToken}`)
      .expect(403);
  });

  it('returns default platform settings', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: {
        global_commission_rate: string;
        minimum_withdrawal_amount: string;
        custom_amount_margin_rate: string;
        customer_discount_rate: string;
        customer_discount_min_amount: string;
        withdrawal_admin_fee: string;
      };
    };
    expect(body.data.global_commission_rate).toBe('10.00');
    expect(body.data.minimum_withdrawal_amount).toBe('100000.00');
    expect(body.data.custom_amount_margin_rate).toBe('0.00');
    expect(body.data.customer_discount_rate).toBe('0.00');
    expect(body.data.customer_discount_min_amount).toBe('350000.00');
    expect(body.data.withdrawal_admin_fee).toBe('0.00');
  });

  it('updates platform settings, including the adjustable-checkout margin rate', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        global_commission_rate: 12,
        minimum_withdrawal_amount: 50000,
        custom_amount_margin_rate: 15,
        customer_discount_rate: 1,
        customer_discount_min_amount: 300000,
        withdrawal_admin_fee: 5000,
      })
      .expect(200);

    const body = response.body as {
      data: {
        global_commission_rate: string;
        minimum_withdrawal_amount: string;
        custom_amount_margin_rate: string;
        customer_discount_rate: string;
        customer_discount_min_amount: string;
        withdrawal_admin_fee: string;
      };
    };
    expect(body.data.global_commission_rate).toBe('12.00');
    expect(body.data.minimum_withdrawal_amount).toBe('50000.00');
    expect(body.data.custom_amount_margin_rate).toBe('15.00');
    expect(body.data.customer_discount_rate).toBe('1.00');
    expect(body.data.customer_discount_min_amount).toBe('300000.00');
    expect(body.data.withdrawal_admin_fee).toBe('5000.00');

    // Reset so later tests in this file (and other suites sharing global
    // settings semantics) aren't affected by this probe value.
    await request(app.getHttpServer())
      .patch('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        global_commission_rate: 10,
        minimum_withdrawal_amount: 100000,
        custom_amount_margin_rate: 0,
        customer_discount_rate: 0,
        customer_discount_min_amount: 350000,
        withdrawal_admin_fee: 0,
      })
      .expect(200);
  });

  it('approves a pending affiliate and generates a referral code', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/affiliates/${pendingAffiliateProfileId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);

    const body = response.body as {
      data: { profile_id: string; affiliate_code: string };
    };
    expect(body.data.affiliate_code).toMatch(/^AFF-/);

    const user = await userRepository.findOneOrFail({
      where: { email: 'pending1.e2e@example.com' },
    });
    expect(user.status).toBe(UserStatus.ACTIVE);
  });

  it('approves an affiliate with a custom referral code instead of auto-generating one', async () => {
    const profileId = await registerPendingAffiliate(
      'custom-code.e2e@example.com',
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/affiliates/${profileId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ referral_code: 'YAY-CUSTOM1' })
      .expect(201);

    const body = response.body as { data: { affiliate_code: string } };
    expect(body.data.affiliate_code).toBe('YAY-CUSTOM1');
  });

  it('rejects approving with a referral code already used by another affiliate', async () => {
    const profileId = await registerPendingAffiliate(
      'custom-code-2.e2e@example.com',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/admin/affiliates/${profileId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ referral_code: 'YAY-CUSTOM1' })
      .expect(409);
  });

  it("edits an already-approved affiliate's referral code without touching approved_at", async () => {
    const profileId = await registerPendingAffiliate(
      'edit-code.e2e@example.com',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/admin/affiliates/${profileId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);

    const profileBefore = await profileRepository.findOneOrFail({
      where: { id: profileId },
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/admin/affiliates/${profileId}/referral-code`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ referral_code: 'YAY-EDITED1' })
      .expect(200);

    const body = response.body as { data: { affiliate_code: string } };
    expect(body.data.affiliate_code).toBe('YAY-EDITED1');

    const profileAfter = await profileRepository.findOneOrFail({
      where: { id: profileId },
    });
    expect(profileAfter.approvedAt).toEqual(profileBefore.approvedAt);
    expect(profileAfter.approvedBy).toEqual(profileBefore.approvedBy);
  });

  it('rejects editing a referral code to one already used by another affiliate', async () => {
    const profileId = await registerPendingAffiliate(
      'edit-code-2.e2e@example.com',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/admin/affiliates/${profileId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/affiliates/${profileId}/referral-code`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ referral_code: 'YAY-EDITED1' })
      .expect(409);
  });

  it('returns full affiliate detail including phone_number captured at registration', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/affiliates/${pendingAffiliateProfileId}`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: {
        profile_id: string;
        email: string;
        phone_number: string;
        commission_balance: string;
        referred_transactions: unknown[];
        commission_history: unknown[];
        withdrawals: unknown[];
      };
    };
    expect(body.data.profile_id).toBe(pendingAffiliateProfileId);
    expect(body.data.email).toBe('pending1.e2e@example.com');
    expect(body.data.phone_number).toBe('081234567890');
    expect(body.data.commission_balance).toBe('0.00');
    expect(body.data.referred_transactions).toEqual([]);
    expect(body.data.commission_history).toEqual([]);
    expect(body.data.withdrawals).toEqual([]);
  });

  it("manually adjusts an affiliate's commission balance up and back down", async () => {
    const creditResponse = await request(app.getHttpServer())
      .patch(
        `/api/v1/admin/affiliates/${pendingAffiliateProfileId}/commission-balance`,
      )
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: 50000, reason: 'e2e test credit' })
      .expect(200);
    const creditBody = creditResponse.body as {
      data: { commission_balance: string; total_commission_earned: string };
    };
    expect(creditBody.data.commission_balance).toBe('50000.00');
    expect(creditBody.data.total_commission_earned).toBe('50000.00');

    const debitResponse = await request(app.getHttpServer())
      .patch(
        `/api/v1/admin/affiliates/${pendingAffiliateProfileId}/commission-balance`,
      )
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: -50000, reason: 'e2e test revert' })
      .expect(200);
    const debitBody = debitResponse.body as {
      data: { commission_balance: string; total_commission_earned: string };
    };
    expect(debitBody.data.commission_balance).toBe('0.00');
    // Deducting never reduces the lifetime-earned counter.
    expect(debitBody.data.total_commission_earned).toBe('50000.00');
  });

  it('rejects a commission-balance adjustment that would go negative', async () => {
    await request(app.getHttpServer())
      .patch(
        `/api/v1/admin/affiliates/${pendingAffiliateProfileId}/commission-balance`,
      )
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: -1 })
      .expect(400);
  });

  it('rejects a pending affiliate', async () => {
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/affiliates/${secondPendingAffiliateProfileId}/reject`,
      )
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);

    const user = await userRepository.findOneOrFail({
      where: { email: 'pending2.e2e@example.com' },
    });
    expect(user.status).toBe(UserStatus.INACTIVE);
  });

  it('reject also deactivates an already-active affiliate, and approve reactivates them with the same referral code', async () => {
    const beforeDeactivate = await profileRepository.findOneOrFail({
      where: { id: pendingAffiliateProfileId },
    });
    const originalCode = beforeDeactivate.affiliateCode;
    expect(originalCode).toMatch(/^AFF-/);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/affiliates/${pendingAffiliateProfileId}/reject`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);

    const deactivatedUser = await userRepository.findOneOrFail({
      where: { email: 'pending1.e2e@example.com' },
    });
    expect(deactivatedUser.status).toBe(UserStatus.INACTIVE);

    const reactivateResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/affiliates/${pendingAffiliateProfileId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const reactivateBody = reactivateResponse.body as {
      data: { affiliate_code: string };
    };
    expect(reactivateBody.data.affiliate_code).toBe(originalCode);

    const reactivatedUser = await userRepository.findOneOrFail({
      where: { email: 'pending1.e2e@example.com' },
    });
    expect(reactivatedUser.status).toBe(UserStatus.ACTIVE);
  });

  it('lists affiliates, optionally filtered by status', async () => {
    const allResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/affiliates')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);
    const allBody = allResponse.body as {
      data: { items: { profile_id: string; status: string }[]; total: number };
    };
    expect(allBody.data.total).toBeGreaterThanOrEqual(2);
    expect(
      allBody.data.items.some(
        (item) => item.profile_id === pendingAffiliateProfileId,
      ),
    ).toBe(true);

    const activeResponse = await request(app.getHttpServer())
      .get(`/api/v1/admin/affiliates?status=${UserStatus.ACTIVE}`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);
    const activeBody = activeResponse.body as {
      data: { items: { profile_id: string; status: UserStatus }[] };
    };
    expect(
      activeBody.data.items.every((item) => item.status === UserStatus.ACTIVE),
    ).toBe(true);
    expect(
      activeBody.data.items.some(
        (item) => item.profile_id === pendingAffiliateProfileId,
      ),
    ).toBe(true);
    expect(
      activeBody.data.items.some(
        (item) => item.profile_id === secondPendingAffiliateProfileId,
      ),
    ).toBe(false);
  });

  it('finds an affiliate by exact user_id or profile_id via search', async () => {
    const find = async (search: string) =>
      (
        (
          await request(app.getHttpServer())
            .get(`/api/v1/admin/affiliates?search=${search}&limit=5`)
            .set('Authorization', `Bearer ${superadminToken}`)
            .expect(200)
        ).body as {
          data: { items: { profile_id: string; user_id: string }[] };
        }
      ).data.items;
    const [target] = await find(pendingAffiliateProfileId);
    expect(target.profile_id).toBe(pendingAffiliateProfileId);
    expect(
      (await find(target.user_id)).some(
        (item) => item.profile_id === pendingAffiliateProfileId,
      ),
    ).toBe(true);
  });

  it('updates an individual affiliate commission rate override', async () => {
    const response = await request(app.getHttpServer())
      .patch(
        `/api/v1/admin/affiliates/${pendingAffiliateProfileId}/commission-rate`,
      )
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ commission_rate: 20 })
      .expect(200);

    const body = response.body as { data: { commission_rate: string } };
    expect(body.data.commission_rate).toBe('20.00');
  });

  it('soft-deletes an affiliate: hidden from listings, underlying user deactivated, email freed for reuse', async () => {
    const profileBeforeDelete = await profileRepository.findOneOrFail({
      where: { id: secondPendingAffiliateProfileId },
    });

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/v1/admin/affiliates/${secondPendingAffiliateProfileId}`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);
    expect((deleteResponse.body as { success: boolean }).success).toBe(true);

    // The original email must no longer resolve to a user at all - it's
    // archived (renamed), freeing it for a brand new registration (see
    // UsersService.archiveEmailForReuse, fixed 2026-10-10 after a real
    // "Email already registered" 409 on re-registration post-delete).
    const stillByOldEmail = await userRepository.findOne({
      where: { email: 'pending2.e2e@example.com' },
    });
    expect(stillByOldEmail).toBeNull();

    const user = await userRepository.findOneOrFail({
      where: { id: profileBeforeDelete.userId },
    });
    expect(user.status).toBe(UserStatus.INACTIVE);
    expect(user.email).toMatch(/^deleted-\d+-pending2\.e2e@example\.com$/);

    // Re-registering with the original email must now succeed.
    await request(app.getHttpServer())
      .post('/api/v1/affiliate/register')
      .send({
        name: 'Reregistered Affiliate',
        email: 'pending2.e2e@example.com',
        password: 'super-secret-password',
        bank_name: 'BCA',
        account_number: '1234567890',
        account_holder: 'Reregistered Affiliate',
        phone_number: '081234567890',
      })
      .expect(201);

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/affiliates')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);
    const listBody = listResponse.body as {
      data: { items: { profile_id: string }[] };
    };
    expect(
      listBody.data.items.some(
        (item) => item.profile_id === secondPendingAffiliateProfileId,
      ),
    ).toBe(false);
  });

  it('manages bonus tiers and rejects overlapping ranges', async () => {
    const auth = { Authorization: `Bearer ${superadminToken}` };
    // Seeded by the migration: [350000, 1000000) 1%, [1000000, -) 2%.
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/bonus-tiers')
      .set(auth)
      .send({ min_amount: 100000, max_amount: 350000, bonus_percent: 0.5 })
      .expect(201);
    const created = (
      createResponse.body as { data: { id: number; is_active: boolean } }
    ).data;
    expect(created).toEqual({
      id: expect.any(Number),
      min_amount: 100000,
      max_amount: 350000,
      bonus_percent: 0.5,
      is_active: true,
    });

    const overlap = await request(app.getHttpServer())
      .post('/api/v1/admin/bonus-tiers')
      .set(auth)
      .send({ min_amount: 300000, max_amount: 400000, bonus_percent: 1 })
      .expect(400);
    expect((overlap.body as { message: string }).message).toBe(
      'Rentang bentrok dengan rentang 100.000 – 350.000.',
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/bonus-tiers/${created.id}`)
      .set(auth)
      .send({ is_active: false })
      .expect(200);
    const estimate = await request(app.getHttpServer())
      .get('/api/v1/topup/estimate')
      .query({ amount: 200000 })
      .expect(200);
    expect(
      (estimate.body as { data: { bonus_coin: number } }).data.bonus_coin,
    ).toBe(0);

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/bonus-tiers/${created.id}`)
      .set(auth)
      .expect(200)
      .expect({ success: true });
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/bonus-tiers/${created.id}`)
      .set(auth)
      .expect(404);
  });

  it('no longer serves the removed product CRUD', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(404);
  });

  it('lists transactions for monitoring', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/transactions?limit=5&offset=0')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: unknown[]; total: number; limit: number; offset: number };
    };
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.limit).toBe(5);
  });

  it('filters transactions by referral code and amount range', async () => {
    await transactionRepository.save([
      transactionRepository.create({
        id: 'TRX-FILTER-TEST-1',
        targetUserId: '11111111',
        grossAmount: '10000.00',
        referralCode: 'FILTERCODE',
        paymentStatus: PaymentStatus.PENDING,
        providerStatus: ProviderStatus.PENDING,
      }),
      transactionRepository.create({
        id: 'TRX-FILTER-TEST-2',
        targetUserId: '22222222',
        grossAmount: '500000.00',
        referralCode: 'FILTERCODE',
        paymentStatus: PaymentStatus.PENDING,
        providerStatus: ProviderStatus.PENDING,
      }),
      transactionRepository.create({
        id: 'TRX-FILTER-TEST-3',
        targetUserId: '33333333',
        grossAmount: '10000.00',
        referralCode: 'OTHERCODE',
        paymentStatus: PaymentStatus.PENDING,
        providerStatus: ProviderStatus.PENDING,
      }),
    ]);

    const response = await request(app.getHttpServer())
      .get(
        '/api/v1/admin/transactions?referral_code=FILTERCODE&amount_min=5000&amount_max=20000',
      )
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: { id: string }[] };
    };
    const ids = body.data.items.map((item) => item.id);
    expect(ids).toContain('TRX-FILTER-TEST-1');
    expect(ids).not.toContain('TRX-FILTER-TEST-2');
    expect(ids).not.toContain('TRX-FILTER-TEST-3');

    await transactionRepository.delete([
      'TRX-FILTER-TEST-1',
      'TRX-FILTER-TEST-2',
      'TRX-FILTER-TEST-3',
    ]);
  });

  it('filters transactions by transaction_id (trims spaces and a leading #)', async () => {
    await transactionRepository.save([
      transactionRepository.create({
        id: 'TRX-ID-FILTER-1',
        targetUserId: '11111111',
        grossAmount: '10000.00',
        paymentStatus: PaymentStatus.PAID,
        providerStatus: ProviderStatus.SUCCESS,
      }),
      transactionRepository.create({
        id: 'TRX-ID-FILTER-2',
        targetUserId: '22222222',
        grossAmount: '10000.00',
        paymentStatus: PaymentStatus.PAID,
        providerStatus: ProviderStatus.SUCCESS,
      }),
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/transactions')
      .query({
        transaction_id: ' #TRX-ID-FILTER-1 ',
        status: 'sukses',
        limit: 20,
        offset: 0,
      })
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: { id: string }[]; total: number };
    };
    expect(body.data.items.map((item) => item.id)).toEqual(['TRX-ID-FILTER-1']);
    expect(body.data.total).toBe(1);

    await transactionRepository.delete(['TRX-ID-FILTER-1', 'TRX-ID-FILTER-2']);
  });

  it('totals paid transactions - gross-only and including the real LinkQu fee (2026-10-10 client request)', async () => {
    await transactionRepository.save([
      transactionRepository.create({
        id: 'TRX-TOTALS-TEST-1',
        targetUserId: '5700893',
        grossAmount: '10000.00',
        providerFee: '4000.00',
        paymentStatus: PaymentStatus.PAID,
        providerStatus: ProviderStatus.SUCCESS,
      }),
      transactionRepository.create({
        id: 'TRX-TOTALS-TEST-2',
        targetUserId: '12345678',
        grossAmount: '10000.00',
        providerFee: '4000.00',
        paymentStatus: PaymentStatus.PAID,
        providerStatus: ProviderStatus.SUCCESS,
      }),
      // A pending transaction must not be counted in either total.
      transactionRepository.create({
        id: 'TRX-TOTALS-TEST-3',
        targetUserId: '99999999',
        grossAmount: '500000.00',
        paymentStatus: PaymentStatus.PENDING,
        providerStatus: ProviderStatus.PENDING,
      }),
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/transactions/totals')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { gross_total: string; total_with_fee: string };
    };
    expect(body.data.gross_total).toBe('20000.00');
    expect(body.data.total_with_fee).toBe('28000.00');

    await transactionRepository.delete([
      'TRX-TOTALS-TEST-1',
      'TRX-TOTALS-TEST-2',
      'TRX-TOTALS-TEST-3',
    ]);
  });

  it('rejects transaction totals without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/transactions/totals')
      .expect(401);
  });

  it('lists withdrawals for monitoring (empty in this suite)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/withdrawals')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: unknown[]; total: number };
    };
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.total).toBe(0);
  });

  it("returns the provider's mock coin balance", async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/provider/balance')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as { data: { balance: number } };
    expect(typeof body.data.balance).toBe('number');
  });

  it('rejects the provider balance check for a non-superadmin token', async () => {
    const affiliateToken = await login(
      'pending1.e2e@example.com',
      'super-secret-password',
    );

    await request(app.getHttpServer())
      .get('/api/v1/admin/provider/balance')
      .set('Authorization', `Bearer ${affiliateToken}`)
      .expect(403);
  });

  it('manually transfers coin via the provider for a support/compensation case', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/provider/coin-transfer')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        target_user_id: '1000007',
        coin: 50,
        reason: 'e2e test - manual compensation credit',
      })
      .expect(201);

    const body = response.body as {
      success: boolean;
      data: { target_user_id: string; coin: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.target_user_id).toBe('1000007');
    expect(body.data.coin).toBe(50);
  });

  it('rejects a manual coin transfer with a non-positive coin amount', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/provider/coin-transfer')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        target_user_id: '1000007',
        coin: 0,
        reason: 'should be rejected',
      })
      .expect(400);
  });

  it('checks the LinkQu account balance', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/linkqu/balance')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      success: boolean;
      data: { balance: number; response_code: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.response_code).toBe('00');
  });

  it('rejects the LinkQu balance check for a non-superadmin token', async () => {
    const affiliateToken = await login(
      'pending1.e2e@example.com',
      'super-secret-password',
    );

    await request(app.getHttpServer())
      .get('/api/v1/admin/linkqu/balance')
      .set('Authorization', `Bearer ${affiliateToken}`)
      .expect(403);
  });
});
