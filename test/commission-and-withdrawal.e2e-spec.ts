import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AffiliatorProfile } from '../src/affiliates/entities/affiliator-profile.entity';
import {
  CommissionLog,
  CommissionLogType,
} from '../src/affiliates/entities/commission-log.entity';
import {
  CommissionWithdrawal,
  WithdrawalStatus,
} from '../src/affiliates/entities/commission-withdrawal.entity';
import {
  Product,
  ProductStatus,
} from '../src/products/entities/product.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { User, UserRole, UserStatus } from '../src/users/entities/user.entity';
import { LinkQuService } from '../src/linkqu/linkqu.service';

/**
 * Exercises the full referred-purchase -> commission-credit -> withdrawal
 * -> LinkQu disbursement lifecycle against a real Postgres database.
 * LinkQuService is overridden with a deterministic double for both Payment
 * Link and disbursement calls (no real LinkQu credentials assumed here);
 * see topup.e2e-spec.ts for the live-checkout-only override and
 * admin.e2e-spec.ts for the affiliate approval flow this test builds on.
 */
const TEST_SIGNATURE = 'e2e-test-signature';

// LinkQu's real withdraw/payment can return PAID or PENDING; the fake
// forces a FAILED result for a specific test without a separate webhook
// call, mirroring the old Duitku fake's forced-failure mechanism.
const failingPayoutReferenceIds = new Set<string>();

class FakeLinkQuService {
  createInvoice(params: { externalId: string }) {
    return Promise.resolve({
      invoiceId: `fake-reference-${params.externalId}`,
      invoiceUrl: `https://cognos.linkqu.id/pay/fake-reference-${params.externalId}`,
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
        status: 'FAILED' as const,
      });
    }
    return Promise.resolve({
      success: true,
      payoutId: `fake-payout-${params.referenceId}`,
      responseCode: '00',
      responseDesc: 'Success',
      status: 'PAID' as const,
    });
  }

  verifyInvoiceCallbackSignature(params: {
    signature: string | undefined;
  }): boolean {
    return params.signature === TEST_SIGNATURE;
  }

  verifyDisbursementCallbackSignature(params: {
    signature: string | undefined;
  }): boolean {
    return params.signature === TEST_SIGNATURE;
  }
}

describe('Commission crediting and withdrawal (e2e)', () => {
  let app: INestApplication<App>;
  let userRepository: Repository<User>;
  let profileRepository: Repository<AffiliatorProfile>;
  let productRepository: Repository<Product>;
  let transactionRepository: Repository<Transaction>;
  let commissionLogRepository: Repository<CommissionLog>;
  let withdrawalRepository: Repository<CommissionWithdrawal>;

  let superadminToken: string;
  let affiliateToken: string;
  let affiliateProfileId: string;
  let affiliateCode: string;
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
    productRepository = moduleFixture.get(getRepositoryToken(Product));
    transactionRepository = moduleFixture.get(getRepositoryToken(Transaction));
    commissionLogRepository = moduleFixture.get(
      getRepositoryToken(CommissionLog),
    );
    withdrawalRepository = moduleFixture.get(
      getRepositoryToken(CommissionWithdrawal),
    );

    await userRepository.query(
      'TRUNCATE TABLE commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_withdrawals, platform_revenue_logs, platform_settings, users, products RESTART IDENTITY CASCADE',
    );

    const adminPasswordHash = await bcrypt.hash('admin-secret-password', 4);
    await userRepository.save(
      userRepository.create({
        name: 'Root Admin',
        email: 'admin.commission.e2e@example.com',
        passwordHash: adminPasswordHash,
        role: UserRole.SUPERADMIN,
        status: UserStatus.ACTIVE,
      }),
    );
    superadminToken = await login(
      'admin.commission.e2e@example.com',
      'admin-secret-password',
    );

    await request(app.getHttpServer())
      .post('/api/v1/affiliate/register')
      .send({
        name: 'Commission Affiliate',
        email: 'commission.affiliate.e2e@example.com',
        password: 'super-secret-password',
        bank_name: 'BCA',
        account_number: '1234567890',
        account_holder: 'Commission Affiliate',
      })
      .expect(201);

    const affiliateUser = await userRepository.findOneOrFail({
      where: { email: 'commission.affiliate.e2e@example.com' },
    });
    const pendingProfile = await profileRepository.findOneOrFail({
      where: { userId: affiliateUser.id },
    });

    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/affiliates/${pendingProfile.id}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const approveBody = approveResponse.body as {
      data: { profile_id: string; affiliate_code: string };
    };
    affiliateProfileId = approveBody.data.profile_id;
    affiliateCode = approveBody.data.affiliate_code;

    affiliateToken = await login(
      'commission.affiliate.e2e@example.com',
      'super-secret-password',
    );

    product = await productRepository.save(
      productRepository.create({
        name: '2000 Diamonds (e2e)',
        providerCode: 'ml_2000_e2e',
        basePrice: '1500000.00',
        sellingPrice: '2000000.00',
        coinAmount: '2000.00',
        status: ProductStatus.ACTIVE,
      }),
    );
  });

  afterAll(async () => {
    await userRepository.query(
      'TRUNCATE TABLE commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_withdrawals, platform_revenue_logs, platform_settings, users, products RESTART IDENTITY CASCADE',
    );
    await app.close();
  });

  it('credits commission when a referred purchase is paid and injected', async () => {
    const checkoutResponse = await request(app.getHttpServer())
      .post('/api/v1/topup/checkout')
      .send({
        product_id: product.id,
        target_user_id: '12345678',
        affiliate_code: affiliateCode,
      })
      .expect(201);

    const checkoutBody = checkoutResponse.body as {
      data: { transaction_id: string };
    };
    const transactionId = checkoutBody.data.transaction_id;

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/linkqu/payment')
      .send({
        partner_reff: transactionId,
        amount: 2000000,
        va_number: '7136490000031689',
        username: 'LI307GXIN',
        status: 'SUCCESS',
        signature: TEST_SIGNATURE,
      })
      .expect(200);

    const transaction = await transactionRepository.findOneOrFail({
      where: { id: transactionId },
    });
    expect(transaction.affiliateCommission).toBe('200000.00');

    const profile = await profileRepository.findOneOrFail({
      where: { id: affiliateProfileId },
    });
    expect(profile.commissionBalance).toBe('200000.00');
    expect(profile.totalCommissionEarned).toBe('200000.00');

    const logs = await commissionLogRepository.find({
      where: { affiliatorId: affiliateProfileId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe('credit');
    expect(logs[0].amount).toBe('200000.00');
  });

  it('rejects a withdrawal request without an affiliator-role token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/affiliate/withdraw')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ amount: 50000 })
      .expect(403);
  });

  it('requests a withdrawal, locking the amount immediately', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/affiliate/withdraw')
      .set('Authorization', `Bearer ${affiliateToken}`)
      .send({ amount: 100000 })
      .expect(201);

    const body = response.body as {
      data: { withdrawal_id: string; status: string };
    };
    expect(body.data.status).toBe(WithdrawalStatus.PENDING);

    const profile = await profileRepository.findOneOrFail({
      where: { id: affiliateProfileId },
    });
    expect(profile.commissionBalance).toBe('100000.00');
  });

  it('rejects a withdrawal exceeding the available balance', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/affiliate/withdraw')
      .set('Authorization', `Bearer ${affiliateToken}`)
      .send({ amount: 999999 })
      .expect(400);
  });

  it('completes a withdrawal immediately on admin approval when LinkQu returns PAID synchronously', async () => {
    const pending = await withdrawalRepository.findOneOrFail({
      where: {
        affiliatorId: affiliateProfileId,
        status: WithdrawalStatus.PENDING,
      },
    });

    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${pending.id}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const approveBody = approveResponse.body as {
      data: { status: string; linkqu_disbursement_id: string };
    };
    expect(approveBody.data.status).toBe(WithdrawalStatus.PAID);
    expect(approveBody.data.linkqu_disbursement_id).toBe(
      `fake-payout-${pending.id}`,
    );

    const paid = await withdrawalRepository.findOneOrFail({
      where: { id: pending.id },
    });
    expect(paid.status).toBe(WithdrawalStatus.PAID);

    // Balance stays at 100000 — the debit was already recorded at request
    // time; a successful disbursement does not touch the balance further.
    const profile = await profileRepository.findOneOrFail({
      where: { id: affiliateProfileId },
    });
    expect(profile.commissionBalance).toBe('100000.00');
  });

  it('lists withdrawals for monitoring, filterable by status', async () => {
    const paidRecord = await withdrawalRepository.findOneOrFail({
      where: {
        affiliatorId: affiliateProfileId,
        status: WithdrawalStatus.PAID,
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/withdrawals?status=${WithdrawalStatus.PAID}`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: { id: string; status: WithdrawalStatus }[] };
    };
    expect(
      body.data.items.every((w) => w.status === WithdrawalStatus.PAID),
    ).toBe(true);
    expect(body.data.items.some((w) => w.id === paidRecord.id)).toBe(true);
  });

  it('accepts "success" as an alias for "paid" when filtering withdrawals', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/withdrawals?status=success')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);

    const body = response.body as {
      data: { items: { status: WithdrawalStatus }[] };
    };
    expect(
      body.data.items.every((w) => w.status === WithdrawalStatus.PAID),
    ).toBe(true);
  });

  it('refunds the balance when a withdrawal payout fails', async () => {
    const requestResponse = await request(app.getHttpServer())
      .post('/api/v1/affiliate/withdraw')
      .set('Authorization', `Bearer ${affiliateToken}`)
      .send({ amount: 50000 })
      .expect(201);
    const requestBody = requestResponse.body as {
      data: { withdrawal_id: string };
    };
    const withdrawalId = requestBody.data.withdrawal_id;
    failingPayoutReferenceIds.add(withdrawalId);

    const balanceAfterLock = await profileRepository.findOneOrFail({
      where: { id: affiliateProfileId },
    });
    expect(balanceAfterLock.commissionBalance).toBe('50000.00');

    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${withdrawalId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const approveBody = approveResponse.body as { data: { status: string } };
    expect(approveBody.data.status).toBe(WithdrawalStatus.FAILED);

    const failed = await withdrawalRepository.findOneOrFail({
      where: { id: withdrawalId },
    });
    expect(failed.status).toBe(WithdrawalStatus.FAILED);

    const refundedProfile = await profileRepository.findOneOrFail({
      where: { id: affiliateProfileId },
    });
    expect(refundedProfile.commissionBalance).toBe('100000.00');

    // Two entries share this withdrawalId: the debit recorded when the
    // amount was locked at request time, and this refund credit.
    const logs = await commissionLogRepository.find({
      where: { affiliatorId: affiliateProfileId, withdrawalId },
    });
    expect(logs).toHaveLength(2);
    const refundLog = logs.find((log) => log.type === CommissionLogType.CREDIT);
    expect(refundLog).toBeDefined();
    expect(refundLog?.amount).toBe('50000.00');
  });

  it('rejects a withdrawal request and refunds the balance without contacting LinkQu', async () => {
    const requestResponse = await request(app.getHttpServer())
      .post('/api/v1/affiliate/withdraw')
      .set('Authorization', `Bearer ${affiliateToken}`)
      .send({ amount: 30000 })
      .expect(201);
    const requestBody = requestResponse.body as {
      data: { withdrawal_id: string };
    };
    const withdrawalId = requestBody.data.withdrawal_id;

    const balanceAfterLock = await profileRepository.findOneOrFail({
      where: { id: affiliateProfileId },
    });
    expect(balanceAfterLock.commissionBalance).toBe('70000.00');

    const rejectResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${withdrawalId}/reject`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const rejectBody = rejectResponse.body as { data: { status: string } };
    expect(rejectBody.data.status).toBe(WithdrawalStatus.REJECTED);

    const rejected = await withdrawalRepository.findOneOrFail({
      where: { id: withdrawalId },
    });
    expect(rejected.status).toBe(WithdrawalStatus.REJECTED);
    expect(rejected.linkQuDisbursementId).toBeNull();

    const refundedProfile = await profileRepository.findOneOrFail({
      where: { id: affiliateProfileId },
    });
    expect(refundedProfile.commissionBalance).toBe('100000.00');

    const logs = await commissionLogRepository.find({
      where: { affiliatorId: affiliateProfileId, withdrawalId },
    });
    expect(logs).toHaveLength(2);
    const refundLog = logs.find((log) => log.type === CommissionLogType.CREDIT);
    expect(refundLog).toBeDefined();
    expect(refundLog?.amount).toBe('30000.00');
  });

  it('rejects rejecting a withdrawal that is not pending', async () => {
    const paidRecord = await withdrawalRepository.findOneOrFail({
      where: {
        affiliatorId: affiliateProfileId,
        status: WithdrawalStatus.PAID,
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${paidRecord.id}/reject`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(409);
  });

  it('rejects a disbursement webhook with an invalid signature', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/linkqu/disbursement')
      .send({
        partner_reff: 'WDW-doesnotmatter',
        amount: 1000,
        accountnumber: '1234567890',
        username: 'LI307GXIN',
        status: 'SUCCESS',
        signature: 'wrong-signature',
      })
      .expect(401);
  });
});
