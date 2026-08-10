import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AffiliatorProfile } from '../src/affiliates/entities/affiliator-profile.entity';
import { Product } from '../src/products/entities/product.entity';
import { User, UserRole, UserStatus } from '../src/users/entities/user.entity';

/**
 * Exercises the superadmin endpoints (SRS-ADM-01/02/03/05 + monitoring)
 * against a real Postgres database. Superadmin accounts are provisioned
 * directly through the repository (no self-registration endpoint exists,
 * by design — see plan/topup-affiliate-platform-superadmin-commission-payout-2026-08-10.md).
 */
describe('Admin (e2e)', () => {
  let app: INestApplication<App>;
  let userRepository: Repository<User>;
  let profileRepository: Repository<AffiliatorProfile>;
  let productRepository: Repository<Product>;

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
    }).compile();

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
    productRepository = moduleFixture.get(getRepositoryToken(Product));

    await userRepository.query(
      'TRUNCATE TABLE commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_settings, users, products RESTART IDENTITY CASCADE',
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
      'TRUNCATE TABLE commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_settings, users, products RESTART IDENTITY CASCADE',
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
      };
    };
    expect(body.data.global_commission_rate).toBe('10.00');
    expect(body.data.minimum_withdrawal_amount).toBe('100000.00');
  });

  it('updates platform settings', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ global_commission_rate: 12, minimum_withdrawal_amount: 50000 })
      .expect(200);

    const body = response.body as {
      data: {
        global_commission_rate: string;
        minimum_withdrawal_amount: string;
      };
    };
    expect(body.data.global_commission_rate).toBe('12.00');
    expect(body.data.minimum_withdrawal_amount).toBe('50000.00');
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

  it('creates and updates a product', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        name: '250 Diamonds',
        provider_code: 'ml_250',
        base_price: 30000,
        selling_price: 40000,
      })
      .expect(201);

    const createBody = createResponse.body as { data: { id: string } };
    expect(createBody.data.id).toBeDefined();

    const updateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/products/${createBody.data.id}`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ selling_price: 45000 })
      .expect(200);

    const updateBody = updateResponse.body as {
      data: { sellingPrice: string };
    };
    expect(updateBody.data.sellingPrice).toBe('45000.00');

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);
    const listBody = listResponse.body as { data: { id: string }[] };
    expect(listBody.data.some((p) => p.id === createBody.data.id)).toBe(true);

    await productRepository.delete(createBody.data.id);
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
});
