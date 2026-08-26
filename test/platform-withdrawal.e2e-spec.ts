import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DuitkuService } from '../src/duitku/duitku.service';
import {
  PlatformRevenueLog,
  PlatformRevenueLogType,
} from '../src/platform/entities/platform-revenue-log.entity';
import {
  PlatformWithdrawal,
  PlatformWithdrawalStatus,
} from '../src/platform/entities/platform-withdrawal.entity';
import {
  Product,
  ProductStatus,
} from '../src/products/entities/product.entity';
import { PlatformSettings } from '../src/settings/entities/platform-settings.entity';
import { User, UserRole, UserStatus } from '../src/users/entities/user.entity';

/**
 * Exercises the platform's own revenue ledger and withdrawal lifecycle
 * (a purchase credits platform_settings.platform_balance -> superadmin
 * withdraws to their own bank account on file -> real-synchronous Duitku
 * disbursement, mirroring the affiliate withdrawal flow in
 * commission-and-withdrawal.e2e-spec.ts) against a real Postgres database.
 */
const TEST_SIGNATURE = 'e2e-test-signature';
const failingPayoutReferenceIds = new Set<string>();

class FakeDuitkuService {
  createInvoice(params: { externalId: string }) {
    return Promise.resolve({
      invoiceId: `fake-reference-${params.externalId}`,
      invoiceUrl: `https://app-sandbox.duitku.com/checkout/fake-reference-${params.externalId}`,
      status: '00',
    });
  }

  createPayout(params: { referenceId: string }) {
    if (failingPayoutReferenceIds.has(params.referenceId)) {
      return Promise.resolve({
        success: false,
        payoutId: null,
        responseCode: '01',
        responseDesc: 'Insufficient funds',
      });
    }
    return Promise.resolve({
      success: true,
      payoutId: `fake-payout-${params.referenceId}`,
      responseCode: '00',
      responseDesc: 'Success',
    });
  }

  verifyInvoiceCallbackSignature(params: {
    signature: string | undefined;
  }): boolean {
    return params.signature === TEST_SIGNATURE;
  }
}

describe('Platform revenue and withdrawal (e2e)', () => {
  let app: INestApplication<App>;
  let userRepository: Repository<User>;
  let productRepository: Repository<Product>;
  let settingsRepository: Repository<PlatformSettings>;
  let revenueLogRepository: Repository<PlatformRevenueLog>;
  let withdrawalRepository: Repository<PlatformWithdrawal>;

  let superadminToken: string;
  let product: Product;

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
    })
      .overrideProvider(DuitkuService)
      .useClass(FakeDuitkuService)
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
    productRepository = moduleFixture.get(getRepositoryToken(Product));
    settingsRepository = moduleFixture.get(
      getRepositoryToken(PlatformSettings),
    );
    revenueLogRepository = moduleFixture.get(
      getRepositoryToken(PlatformRevenueLog),
    );
    withdrawalRepository = moduleFixture.get(
      getRepositoryToken(PlatformWithdrawal),
    );

    await userRepository.query(
      'TRUNCATE TABLE platform_withdrawals, platform_revenue_logs, platform_settings, transactions, users, products RESTART IDENTITY CASCADE',
    );

    const adminPasswordHash = await bcrypt.hash('admin-secret-password', 4);
    await userRepository.save(
      userRepository.create({
        name: 'Root Admin',
        email: 'admin.platform.e2e@example.com',
        passwordHash: adminPasswordHash,
        role: UserRole.SUPERADMIN,
        status: UserStatus.ACTIVE,
      }),
    );
    superadminToken = await login(
      'admin.platform.e2e@example.com',
      'admin-secret-password',
    );

    product = await productRepository.save(
      productRepository.create({
        name: '2000 Diamonds (platform e2e)',
        providerCode: 'ml_2000_platform_e2e',
        basePrice: '1500000.00',
        sellingPrice: '2000000.00',
        coinAmount: '2000.00',
        status: ProductStatus.ACTIVE,
      }),
    );
  });

  afterAll(async () => {
    await userRepository.query(
      'TRUNCATE TABLE platform_withdrawals, platform_revenue_logs, platform_settings, transactions, users, products RESTART IDENTITY CASCADE',
    );
    await app.close();
  });

  it('credits platform revenue (gross - cost) when an unreferred purchase is paid and injected', async () => {
    const checkoutResponse = await request(app.getHttpServer())
      .post('/api/v1/topup/checkout')
      .send({ product_id: product.id, target_user_id: '12345678' })
      .expect(201);

    const checkoutBody = checkoutResponse.body as {
      data: { transaction_id: string };
    };
    const transactionId = checkoutBody.data.transaction_id;

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/duitku/invoice')
      .type('form')
      .send({
        merchantOrderId: transactionId,
        amount: '2000000',
        resultCode: '00',
        signature: TEST_SIGNATURE,
      })
      .expect(200);

    const settings = await settingsRepository.findOneOrFail({
      where: { id: 1 },
    });
    // No referral code, so commissionPaid is 0: revenue = 2000000 - 1500000.
    expect(settings.platformBalance).toBe('500000.00');

    const logs = await revenueLogRepository.find({
      where: { transactionId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe(PlatformRevenueLogType.CREDIT);
    expect(logs[0].amount).toBe('500000.00');
  });

  it('rejects a withdrawal request when the admin payout account is not set', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/platform/withdraw')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: 100000 })
      .expect(400);
  });

  it('rejects platform withdrawal routes without a superadmin token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/platform/balance')
      .expect(401);
  });

  it('sets the admin payout bank details via PATCH /admin/settings', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        admin_bank_name: 'BCA',
        admin_account_number: '9999999999',
        admin_account_holder: 'Platform Admin',
      })
      .expect(200);

    const body = response.body as {
      data: { admin_bank_name: string; admin_account_number: string };
    };
    expect(body.data.admin_bank_name).toBe('BCA');
    expect(body.data.admin_account_number).toBe('9999999999');
  });

  it('checks the platform balance', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/platform/balance')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as { data: { balance: string } };
    expect(body.data.balance).toBe('500000.00');
  });

  it('rejects a withdrawal exceeding the available platform balance', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/platform/withdraw')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: 999999999 })
      .expect(400);
  });

  it('requests a platform withdrawal, locking the amount immediately', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/platform/withdraw')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: 200000 })
      .expect(201);

    const body = response.body as {
      data: { withdrawal_id: string; status: string };
    };
    expect(body.data.status).toBe(PlatformWithdrawalStatus.PENDING);

    const settings = await settingsRepository.findOneOrFail({
      where: { id: 1 },
    });
    expect(settings.platformBalance).toBe('300000.00');
  });

  it('completes a platform withdrawal immediately on admin approval', async () => {
    const pending = await withdrawalRepository.findOneOrFail({
      where: { status: PlatformWithdrawalStatus.PENDING },
    });

    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/platform/withdrawals/${pending.id}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const approveBody = approveResponse.body as {
      data: { status: string; duitku_disbursement_id: string };
    };
    expect(approveBody.data.status).toBe(PlatformWithdrawalStatus.PAID);
    expect(approveBody.data.duitku_disbursement_id).toBe(
      `fake-payout-${pending.id}`,
    );

    // Balance stays at 300000 — the debit was already recorded at request
    // time, matching the affiliate withdrawal flow.
    const settings = await settingsRepository.findOneOrFail({
      where: { id: 1 },
    });
    expect(settings.platformBalance).toBe('300000.00');
  });

  it('lists platform withdrawals for monitoring, filterable by status', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/admin/platform/withdrawals?status=${PlatformWithdrawalStatus.PAID}`,
      )
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: { status: PlatformWithdrawalStatus }[] };
    };
    expect(
      body.data.items.every((w) => w.status === PlatformWithdrawalStatus.PAID),
    ).toBe(true);
  });

  it('refunds the balance when a platform withdrawal payout fails', async () => {
    const requestResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/platform/withdraw')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: 100000 })
      .expect(201);
    const requestBody = requestResponse.body as {
      data: { withdrawal_id: string };
    };
    const withdrawalId = requestBody.data.withdrawal_id;
    failingPayoutReferenceIds.add(withdrawalId);

    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/platform/withdrawals/${withdrawalId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const approveBody = approveResponse.body as { data: { status: string } };
    expect(approveBody.data.status).toBe(PlatformWithdrawalStatus.FAILED);

    const settings = await settingsRepository.findOneOrFail({
      where: { id: 1 },
    });
    // 300000 (before this request) - 100000 (locked) + 100000 (refund) = 300000
    expect(settings.platformBalance).toBe('300000.00');
  });

  it('rejects a platform withdrawal request and refunds the balance without contacting Duitku', async () => {
    const requestResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/platform/withdraw')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: 50000 })
      .expect(201);
    const requestBody = requestResponse.body as {
      data: { withdrawal_id: string };
    };
    const withdrawalId = requestBody.data.withdrawal_id;

    const rejectResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/platform/withdrawals/${withdrawalId}/reject`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const rejectBody = rejectResponse.body as { data: { status: string } };
    expect(rejectBody.data.status).toBe(PlatformWithdrawalStatus.REJECTED);

    const settings = await settingsRepository.findOneOrFail({
      where: { id: 1 },
    });
    expect(settings.platformBalance).toBe('300000.00');
  });

  it('rejects approving an already-resolved platform withdrawal', async () => {
    const paid = await withdrawalRepository.findOneOrFail({
      where: { status: PlatformWithdrawalStatus.PAID },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/admin/platform/withdrawals/${paid.id}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(409);
  });
});
