import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AffiliatorProfile } from '../src/affiliates/entities/affiliator-profile.entity';
import { generateReferralCode } from '../src/common/utils/id-generator.util';
import { User, UserStatus } from '../src/users/entities/user.entity';

/**
 * Exercises affiliate registration + the JWT-guarded dashboard against a
 * real Postgres database. Superadmin approval is a separate future slice,
 * so activation here is done directly through the repository (same
 * dev/test pattern used for seeding products in topup.e2e-spec.ts).
 */
describe('Affiliate (e2e)', () => {
  let app: INestApplication<App>;
  let userRepository: Repository<User>;
  let profileRepository: Repository<AffiliatorProfile>;

  const registrationPayload = {
    name: 'Ana Affiliate',
    email: 'ana.affiliate.e2e@example.com',
    password: 'super-secret-password',
    bank_name: 'BCA',
    account_number: '1234567890',
    account_holder: 'Ana Affiliate',
  };

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

    await userRepository.query(
      'TRUNCATE TABLE affiliator_profiles, commission_logs, users RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await userRepository.query(
      'TRUNCATE TABLE affiliator_profiles, commission_logs, users RESTART IDENTITY CASCADE',
    );
    await app.close();
  });

  it('rejects dashboard access without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/affiliate/dashboard')
      .expect(401);
  });

  it('registers a new affiliate as pending_approval', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/affiliate/register')
      .send(registrationPayload)
      .expect(201);

    const body = response.body as {
      success: boolean;
      data: { user_id: string; email: string; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe(UserStatus.PENDING_APPROVAL);
  });

  it('rejects a duplicate email registration', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/affiliate/register')
      .send(registrationPayload)
      .expect(409);
  });

  it('rejects login and dashboard access while still pending approval', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registrationPayload.email,
        password: registrationPayload.password,
      })
      .expect(201);

    const loginBody = loginResponse.body as {
      data: { access_token: string };
    };

    await request(app.getHttpServer())
      .get('/api/v1/affiliate/dashboard')
      .set('Authorization', `Bearer ${loginBody.data.access_token}`)
      .expect(403);
  });

  it('returns dashboard data once the affiliate is approved and activated', async () => {
    const user = await userRepository.findOneOrFail({
      where: { email: registrationPayload.email },
    });
    await userRepository.update(user.id, { status: UserStatus.ACTIVE });

    const profile = await profileRepository.findOneOrFail({
      where: { userId: user.id },
    });
    const referralCode = generateReferralCode();
    await profileRepository.update(profile.id, {
      affiliateCode: referralCode,
      approvedAt: new Date(),
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registrationPayload.email,
        password: registrationPayload.password,
      })
      .expect(201);

    const loginBody = loginResponse.body as {
      data: { access_token: string; refresh_token: string };
    };
    expect(loginBody.data.access_token).toEqual(expect.any(String));
    expect(loginBody.data.refresh_token).toEqual(expect.any(String));

    const dashboardResponse = await request(app.getHttpServer())
      .get('/api/v1/affiliate/dashboard')
      .set('Authorization', `Bearer ${loginBody.data.access_token}`)
      .expect(200);

    const dashboardBody = dashboardResponse.body as {
      success: boolean;
      data: {
        affiliate_code: string;
        commission_balance: string;
        referred_transaction_count: number;
        commission_history: unknown[];
      };
    };
    expect(dashboardBody.success).toBe(true);
    expect(dashboardBody.data.affiliate_code).toBe(referralCode);
    expect(dashboardBody.data.commission_balance).toBe('0.00');
    expect(dashboardBody.data.referred_transaction_count).toBe(0);
    expect(dashboardBody.data.commission_history).toEqual([]);

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: loginBody.data.refresh_token })
      .expect(201);

    const refreshBody = refreshResponse.body as {
      success: boolean;
      data: { access_token: string };
    };
    expect(refreshBody.success).toBe(true);
    expect(refreshBody.data.access_token).toEqual(expect.any(String));
  });

  it('rejects login with a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: registrationPayload.email, password: 'wrong-password' })
      .expect(401);
  });
});
