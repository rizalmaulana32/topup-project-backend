import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AdminProfile } from '../src/manual-topup/entities/admin-profile.entity';
import { ManualTopup } from '../src/manual-topup/entities/manual-topup.entity';
import { User, UserRole, UserStatus } from '../src/users/entities/user.entity';

/**
 * Exercises the manual-send-only "admin" role + manual top-up (no payment
 * gateway) flow against a real Postgres database (client request via Ricky
 * 2026-11-02, corrected same day for the scheduled-send model). Uses the
 * default mock Provider Top-Up vendor (PROVIDER_TOP_UP_VENDOR unset in
 * this environment) - checkId/injectCoin always succeed for a non-empty
 * momo_user_id, so budget-exhaustion failures below come purely from the
 * coin_limit check, never a provider rejection.
 */
describe('Manual top-up (e2e)', () => {
  let app: INestApplication<App>;
  let userRepository: Repository<User>;
  let adminProfileRepository: Repository<AdminProfile>;
  let manualTopupRepository: Repository<ManualTopup>;

  let superadminToken: string;

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    const body = response.body as { data: { access_token: string } };
    return body.data.access_token;
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
    adminProfileRepository = moduleFixture.get(getRepositoryToken(AdminProfile));
    manualTopupRepository = moduleFixture.get(getRepositoryToken(ManualTopup));

    await userRepository.query(
      'TRUNCATE TABLE manual_topup_sends, manual_topups, admin_profiles, commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_withdrawals, platform_revenue_logs, platform_settings, users, products RESTART IDENTITY CASCADE',
    );

    const passwordHash = await bcrypt.hash('admin-secret-password', 4);
    await userRepository.save(
      userRepository.create({
        name: 'Root Admin',
        email: 'manual-topup-admin.e2e@example.com',
        passwordHash,
        role: UserRole.SUPERADMIN,
        status: UserStatus.ACTIVE,
      }),
    );
    superadminToken = await login(
      'manual-topup-admin.e2e@example.com',
      'admin-secret-password',
    );
  });

  afterAll(async () => {
    await userRepository.query(
      'TRUNCATE TABLE manual_topup_sends, manual_topups, admin_profiles, commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_withdrawals, platform_revenue_logs, platform_settings, users, products RESTART IDENTITY CASCADE',
    );
    await app.close();
  });

  it('rejects manual-admins routes without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/manual-admins')
      .expect(401);
  });

  let manualAdminProfileId: string;
  let manualAdminToken: string;

  it('lets a superadmin create a manual-send-only admin account with a coin budget', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/manual-admins')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        name: 'Manual Admin One',
        email: 'manual-admin-1.e2e@example.com',
        password: 'manual-admin-password',
        coin_limit: 500,
      })
      .expect(201);

    const body = response.body as {
      data: { profile_id: string; user_id: string; coin_limit: string };
    };
    expect(body.data.coin_limit).toBe('500.00');
    manualAdminProfileId = body.data.profile_id;

    manualAdminToken = await login(
      'manual-admin-1.e2e@example.com',
      'manual-admin-password',
    );
  });

  it('rejects the new admin account from any other /admin/* route', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${manualAdminToken}`)
      .expect(403);
  });

  let oneOffManualTopupId: string;

  it('sends a one-off manual top-up immediately and decrements the coin budget', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${manualAdminToken}`)
      .send({
        momo_user_id: '88887777',
        total_amount: 300,
      })
      .expect(201);

    const body = response.body as {
      data: {
        id: string;
        total_amount: string;
        amount_sent: string;
        status: string;
        customer_name: string;
      };
    };
    expect(body.data.total_amount).toBe('300.00');
    expect(body.data.amount_sent).toBe('300.00');
    expect(body.data.status).toBe('completed');
    expect(body.data.customer_name).toBe('Player_88887777');
    oneOffManualTopupId = body.data.id;

    const profile = await adminProfileRepository.findOneByOrFail({
      id: manualAdminProfileId,
    });
    expect(profile.coinLimit).toBe('200.00');
    expect(profile.totalCoinSent).toBe('300.00');
  });

  it('records the send in per-topup history', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/manual-topups/${oneOffManualTopupId}/sends`)
      .set('Authorization', `Bearer ${manualAdminToken}`)
      .expect(200);

    const body = response.body as {
      data: { amount: string; status: string }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ amount: '300.00', status: 'success' });
  });

  it('pauses a manual top-up that exceeds the remaining coin budget and leaves the budget untouched', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${manualAdminToken}`)
      .send({
        momo_user_id: '88887777',
        total_amount: 250, // only 200 remaining
      })
      .expect(400);

    const body = response.body as { message: string };
    expect(body.message).toMatch(/insufficient coin limit/i);

    const profile = await adminProfileRepository.findOneByOrFail({
      id: manualAdminProfileId,
    });
    expect(profile.coinLimit).toBe('200.00'); // unchanged

    const paused = await manualTopupRepository.findOneByOrFail({
      momoUserId: '88887777',
      totalAmount: '250.00',
    });
    expect(paused.status).toBe('paused');
  });

  it('lets the superadmin top up the coin budget and resume the paused schedule', async () => {
    const topUpResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/manual-admins/${manualAdminProfileId}/coin-limit`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: 100 })
      .expect(200);
    const topUpBody = topUpResponse.body as { data: { coin_limit: string } };
    expect(topUpBody.data.coin_limit).toBe('300.00');

    const pausedTopup = await manualTopupRepository.findOneByOrFail({
      momoUserId: '88887777',
      totalAmount: '250.00',
    });

    const resumeResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/manual-topups/${pausedTopup.id}/resume`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const resumeBody = resumeResponse.body as { data: { status: string } };
    expect(resumeBody.data.status).toBe('active');
  });

  it('rejects a negative coin-limit adjustment that would go below zero', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/manual-admins/${manualAdminProfileId}/coin-limit`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: -999999 })
      .expect(400);
  });

  it('creates a scheduled/partial manual top-up, sending only the first tick immediately', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        momo_user_id: '12340000',
        total_amount: 100,
        amount_per_send: 40,
        interval_minutes: 5,
      })
      .expect(201);

    const body = response.body as {
      data: {
        amount_sent: string;
        status: string;
        next_run_at: string | null;
        interval_minutes: number;
      };
    };
    // Only the first tick (40) has gone out so far - not the full 100.
    expect(body.data.amount_sent).toBe('40.00');
    expect(body.data.status).toBe('active');
    expect(body.data.next_run_at).not.toBeNull();
    expect(body.data.interval_minutes).toBe(5);
  });

  it('rejects amount_per_send without interval_minutes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        momo_user_id: '12340000',
        total_amount: 100,
        amount_per_send: 40,
      })
      .expect(400);
  });

  it("lists only the admin's own manual top-ups, never a superadmin's", async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${manualAdminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: { created_by: string; momo_user_id: string }[] };
    };
    expect(
      body.data.items.every((item) => item.momo_user_id === '88887777'),
    ).toBe(true);
    expect(
      body.data.items.some((item) => item.momo_user_id === '12340000'),
    ).toBe(false);
  });

  it("superadmin's list includes every admin's manual top-ups", async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: { momo_user_id: string }[] };
    };
    const momoIds = body.data.items.map((item) => item.momo_user_id);
    expect(momoIds).toEqual(
      expect.arrayContaining(['88887777', '12340000']),
    );
  });

  it('lists manual-send admin accounts with their coin usage', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/manual-admins')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { profile_id: string; total_coin_sent: string }[];
    };
    const mine = body.data.find((a) => a.profile_id === manualAdminProfileId);
    expect(mine?.total_coin_sent).toBe('300.00');
  });

  it('cancels an active manual top-up before completion', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        momo_user_id: '99990000',
        total_amount: 1000,
        amount_per_send: 100,
        interval_minutes: 10,
      })
      .expect(201);
    const createBody = createResponse.body as { data: { id: string } };

    const cancelResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/manual-topups/${createBody.data.id}/cancel`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const cancelBody = cancelResponse.body as {
      data: { status: string; next_run_at: string | null };
    };
    expect(cancelBody.data.status).toBe('cancelled');
    expect(cancelBody.data.next_run_at).toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/admin/manual-topups/${createBody.data.id}/cancel`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(409);
  });

  it('manually pauses an active schedule and resumes it', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        momo_user_id: '99990001',
        total_amount: 1000,
        amount_per_send: 100,
        interval_minutes: 10,
      })
      .expect(201);
    const createBody = createResponse.body as { data: { id: string } };

    const pauseResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/manual-topups/${createBody.data.id}/pause`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const pauseBody = pauseResponse.body as {
      data: { status: string; next_run_at: string | null };
    };
    expect(pauseBody.data.status).toBe('paused');
    expect(pauseBody.data.next_run_at).toBeNull();

    // Pausing again while already paused is rejected.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/manual-topups/${createBody.data.id}/pause`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(409);

    const resumeResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/manual-topups/${createBody.data.id}/resume`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const resumeBody = resumeResponse.body as { data: { status: string } };
    expect(resumeBody.data.status).toBe('active');
  });

  it('rejects pausing a completed schedule', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/manual-topups')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ momo_user_id: '99990002', total_amount: 100 })
      .expect(201);
    const createBody = createResponse.body as {
      data: { id: string; status: string };
    };
    expect(createBody.data.status).toBe('completed');

    await request(app.getHttpServer())
      .post(`/api/v1/admin/manual-topups/${createBody.data.id}/pause`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(409);
  });
});
