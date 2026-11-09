import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { LinkQuService } from '../src/linkqu/linkqu.service';
import { SuperAffiliatesService } from '../src/super-affiliates/super-affiliates.service';

/**
 * Super affiliate (SA) lifecycle against a real Postgres: creation and
 * cross-table referral-code uniqueness, affiliate registration under an SA,
 * the three threshold modes, idempotent crediting, inactive/deleted SAs,
 * platform revenue, moving affiliates, and SA withdrawals.
 */
const TEST_SIGNATURE = 'e2e-test-signature';

class FakeLinkQuService {
  createInvoice(params: { externalId: string }) {
    return Promise.resolve({
      invoiceId: `fake-reference-${params.externalId}`,
      invoiceUrl: `https://cognos.linkqu.id/pay/fake-reference-${params.externalId}`,
      status: '00',
    });
  }

  verifyInvoiceCallbackSignature(params: { signature: string | undefined }) {
    return params.signature === TEST_SIGNATURE;
  }
}

/** Typed `data` of a `{ success, data }` response. */

const dataOf = (res: { body: unknown }) =>
  (res.body as { data: any }).data as Record<string, any>;

const TRUNCATE =
  'TRUNCATE TABLE super_affiliate_withdrawals, super_affiliate_commission_logs, commission_withdrawals, commission_logs, transactions, affiliator_profiles, super_affiliate_profiles, admin_profiles, platform_withdrawals, platform_revenue_logs, platform_settings, users RESTART IDENTITY CASCADE';

describe('Super affiliates (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let superAffiliatesService: SuperAffiliatesService;
  let adminToken: string;
  let saToken: string;
  let saId: string;
  let saCode: string;
  const affiliates: { profileId: string; code: string }[] = [];

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);

  async function login(email: string, password: string): Promise<string> {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return (res.body as { data: { access_token: string } }).data.access_token;
  }

  async function registerAndApprove(
    n: number,
    referralCode?: string,
  ): Promise<{ profileId: string; code: string }> {
    const email = `sa.downline${n}.e2e@example.com`;
    await http()
      .post('/api/v1/affiliate/register')
      .send({
        name: `Downline ${n}`,
        email,
        password: 'super-secret-password',
        bank_name: 'BCA',
        account_number: '123',
        account_holder: `Downline ${n}`,
        phone_number: '0812',
        ...(referralCode && { referral_code: referralCode }),
      })
      .expect(201);
    const [{ id }]: { id: string }[] = await db.query(
      `SELECT ap.id::text AS id FROM affiliator_profiles ap JOIN users u ON u.id = ap.user_id WHERE u.email = $1`,
      [email],
    );
    const res = await asAdmin(
      http().post(`/api/v1/admin/affiliates/${id}/approve`),
    )
      .send({ referral_code: `DOWN-${n}` })
      .expect(201);
    return {
      profileId: id,
      code: (res.body as { data: { affiliate_code: string } }).data
        .affiliate_code,
    };
  }

  /** checkout-custom + paid webhook; returns the transaction id. */
  async function pay(amount: number, affiliateCode: string): Promise<string> {
    const res = await http()
      .post('/api/v1/topup/checkout-custom')
      .send({
        amount,
        target_user_id: '12345678',
        affiliate_code: affiliateCode,
      })
      .expect(201);
    const id = (res.body as { data: { transaction_id: string } }).data
      .transaction_id;
    await webhook(id, amount);
    return id;
  }

  async function webhook(transactionId: string, amount: number) {
    await http()
      .post('/api/v1/webhooks/linkqu/payment')
      .send({
        partner_reff: transactionId,
        amount,
        va_number: '7136490000031689',
        username: 'LI307GXIN',
        status: 'SUCCESS',
        signature: TEST_SIGNATURE,
      })
      .expect(200);
  }

  async function saCommissionFor(transactionId: string): Promise<string> {
    const rows: { amount: string }[] = await db.query(
      `SELECT amount FROM super_affiliate_commission_logs WHERE transaction_id = $1 AND type = 'credit'`,
      [transactionId],
    );
    return rows[0]?.amount ?? '0.00';
  }

  async function setRule(rule: Record<string, unknown>) {
    await asAdmin(http().patch(`/api/v1/admin/super-affiliates/${saId}`))
      .send(rule)
      .expect(200);
  }

  /** Pushes every existing transaction into last month so the current month starts from 0. */
  const moveHistoryToLastMonth = () =>
    db.query(
      `UPDATE transactions SET paid_at = paid_at - interval '1 month', created_at = created_at - interval '1 month'`,
    );

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
    db = moduleFixture.get(getDataSourceToken());
    superAffiliatesService = moduleFixture.get(SuperAffiliatesService);
    await db.query(TRUNCATE);

    await db.query(
      `INSERT INTO users (name, email, password_hash, role, status) VALUES ('Root', 'root.sa.e2e@example.com', $1, 'superadmin', 'active')`,
      [await bcrypt.hash('admin-secret-password', 4)],
    );
    adminToken = await login(
      'root.sa.e2e@example.com',
      'admin-secret-password',
    );
    await asAdmin(http().patch('/api/v1/admin/settings'))
      .send({
        global_commission_rate: 10,
        custom_amount_margin_rate: 50,
        minimum_withdrawal_amount: 5000,
        withdrawal_admin_fee: 0,
        custom_amount_extra_coin_enabled: false,
      })
      .expect(200);
  });

  afterAll(async () => {
    await db.query(TRUNCATE);
    await app.close();
  });

  it('creates a super affiliate with defaults (1%, per_transaction, threshold 1.000.000)', async () => {
    const res = await asAdmin(http().post('/api/v1/admin/super-affiliates'))
      .send({
        name: 'Super One',
        email: 'super.one.e2e@example.com',
        password: 'super-secret-password',
        phone_number: '0811',
        bank_name: 'BCA',
        account_number: '999',
        account_holder: 'Super One',
      })
      .expect(201);
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(data).toEqual(
      expect.objectContaining({
        commission_rate: '1.00',
        threshold_mode: 'per_transaction',
        threshold_amount: '1000000.00',
        downline_count: 0,
        status: 'active',
      }),
    );
    expect(data.referral_code).toMatch(/^SA-/);
    saId = String(data.id);
    saCode = String(data.referral_code);
    saToken = await login('super.one.e2e@example.com', 'super-secret-password');
  });

  it('rejects a referral code already used by an admin, a super affiliate or an affiliate', async () => {
    await asAdmin(http().post('/api/v1/admin/manual-admins'))
      .send({
        name: 'Manual Admin',
        email: 'manual.admin.sa.e2e@example.com',
        password: 'super-secret-password',
        coin_limit: 0,
        referral_code: 'ADM-TAKEN',
      })
      .expect(201);
    const base = {
      name: 'Super Two',
      email: 'super.two.e2e@example.com',
      password: 'super-secret-password',
      phone_number: '0811',
      bank_name: 'BCA',
      account_number: '999',
      account_holder: 'Super Two',
    };
    await asAdmin(http().post('/api/v1/admin/super-affiliates'))
      .send({ ...base, referral_code: 'ADM-TAKEN' })
      .expect(409);
    await asAdmin(http().post('/api/v1/admin/manual-admins'))
      .send({
        name: 'Manual Admin 2',
        email: 'manual.admin2.sa.e2e@example.com',
        password: 'super-secret-password',
        coin_limit: 0,
        referral_code: saCode,
      })
      .expect(409);
    // Editing an SA onto a taken code is rejected too.
    await asAdmin(http().patch(`/api/v1/admin/super-affiliates/${saId}`))
      .send({ referral_code: 'ADM-TAKEN' })
      .expect(409);
  });

  it('checks the optional registration referral code', async () => {
    const valid = await http()
      .get('/api/v1/affiliate/check-referral-code')
      .query({ code: saCode.toLowerCase() })
      .expect(200);
    expect(valid.body).toEqual({
      success: true,
      data: { valid: true, type: 'super_affiliate', name: 'Super One' },
    });
    const invalid = await http()
      .get('/api/v1/affiliate/check-referral-code')
      .query({ code: 'NOPE-123' })
      .expect(200);
    expect(invalid.body).toEqual({
      success: true,
      data: { valid: false, type: null, name: null },
    });
  });

  it('links affiliates registering with the SA code; the code is optional', async () => {
    affiliates.push(await registerAndApprove(1, saCode));
    affiliates.push(await registerAndApprove(2, saCode));
    affiliates.push(await registerAndApprove(3)); // no upline

    const rows: { id: string; sa: string | null; admin: string | null }[] =
      await db.query(
        `SELECT id::text, super_affiliate_profile_id::text AS sa, admin_profile_id::text AS admin FROM affiliator_profiles ORDER BY id`,
      );
    expect(rows.map((r) => [r.sa, r.admin])).toEqual([
      [saId, null],
      [saId, null],
      [null, null],
    ]);

    // An affiliate's code can't take the SA's either.
    await asAdmin(
      http().patch(
        `/api/v1/admin/affiliates/${affiliates[2].profileId}/referral-code`,
      ),
    )
      .send({ referral_code: saCode })
      .expect(409);
  });

  it('per_transaction: only a transaction >= threshold earns 1% of gross; affiliate commission is unchanged', async () => {
    const below = await pay(500000, affiliates[0].code);
    const at = await pay(1000000, affiliates[0].code);

    expect(await saCommissionFor(below)).toBe('0.00');
    expect(await saCommissionFor(at)).toBe('10000.00');

    // Affiliate still gets exactly 10% minus the customer's bonus coin.
    const [tx]: { affiliate_commission: string; bonus_coin: string }[] =
      await db.query(
        `SELECT affiliate_commission, bonus_coin FROM transactions WHERE id = $1`,
        [at],
      );
    expect(Number(tx.affiliate_commission)).toBe(
      100000 - Number(tx.bonus_coin),
    );
  });

  it('platform revenue drops by the affiliate AND the SA commission', async () => {
    const id = await pay(2000000, affiliates[0].code);
    const [row]: {
      gross: string;
      coin: string;
      aff: string;
      revenue: string;
    }[] = await db.query(
      `SELECT t.gross_amount AS gross, t.coin_amount AS coin, t.affiliate_commission AS aff, l.amount AS revenue
       FROM transactions t JOIN platform_revenue_logs l ON l.transaction_id = t.id WHERE t.id = $1`,
      [id],
    );
    const sa = Number(await saCommissionFor(id));
    expect(sa).toBe(20000);
    expect(Number(row.revenue)).toBeCloseTo(
      Number(row.gross) - Number(row.coin) - Number(row.aff) - sa,
      2,
    );
  });

  it('a re-delivered webhook credits the SA only once', async () => {
    const id = await pay(1500000, affiliates[1].code);
    await webhook(id, 1500000);
    // Even called again directly (bypassing the paid-status guard), it's a no-op.
    await expect(
      superAffiliatesService.creditCommissionForTransaction({
        referralCode: affiliates[1].code,
        transactionId: id,
        grossAmount: '1500000.00',
      }),
    ).resolves.toBe('0.00');
    const logs: unknown[] = await db.query(
      `SELECT 1 FROM super_affiliate_commission_logs WHERE transaction_id = $1`,
      [id],
    );
    expect(logs).toHaveLength(1);
  });

  it('monthly_total_downline: from the transaction crossing the threshold on, not retroactive; next month starts from 0', async () => {
    await moveHistoryToLastMonth();
    await setRule({
      threshold_mode: 'monthly_total_downline',
      threshold_amount: 1000000,
    });

    const first = await pay(600000, affiliates[0].code); // 600k
    const crossing = await pay(400000, affiliates[1].code); // 1.000.000
    const after = await pay(100000, affiliates[0].code); // 1.100.000
    expect(await saCommissionFor(first)).toBe('0.00');
    expect(await saCommissionFor(crossing)).toBe('4000.00');
    expect(await saCommissionFor(after)).toBe('1000.00');

    await moveHistoryToLastMonth();
    const nextMonth = await pay(400000, affiliates[0].code);
    expect(await saCommissionFor(nextMonth)).toBe('0.00');
  });

  it('monthly_per_affiliate: only the source affiliate’s own month volume counts', async () => {
    await moveHistoryToLastMonth();
    await setRule({ threshold_mode: 'monthly_per_affiliate' });

    await pay(700000, affiliates[0].code);
    await pay(600000, affiliates[1].code);
    // Downline total is 1.600.000, but affiliate 2 alone is only 900.000.
    const notYet = await pay(300000, affiliates[1].code);
    const crossing = await pay(300000, affiliates[0].code); // affiliate 1: 1.000.000
    expect(await saCommissionFor(notYet)).toBe('0.00');
    expect(await saCommissionFor(crossing)).toBe('3000.00');
  });

  it('dashboard and downline show this month’s volume', async () => {
    const dash = await http()
      .get('/api/v1/super-affiliate/dashboard')
      .set('Authorization', `Bearer ${saToken}`)
      .expect(200);
    expect(dataOf(dash)).toEqual(
      expect.objectContaining({
        referral_code: saCode,
        downline_count: 2,
        month_volume: '1900000.00',
        threshold_mode: 'monthly_per_affiliate',
      }),
    );
    const downline = await http()
      .get('/api/v1/super-affiliate/affiliates')
      .set('Authorization', `Bearer ${saToken}`)
      .expect(200);
    const volumes = Object.fromEntries(
      (
        dataOf(downline) as unknown as {
          affiliate_code: string;
          month_volume: number;
        }[]
      ).map((a) => [a.affiliate_code, a.month_volume]),
    );
    expect(volumes).toEqual({ 'DOWN-1': 1000000, 'DOWN-2': 900000 });

    await http()
      .get('/api/v1/super-affiliate/dashboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  it('SA withdrawal: request locks, reject refunds with a CREDIT log, approve + process pays', async () => {
    const balance = async () => {
      const [row]: { commission_balance: string }[] = await db.query(
        `SELECT commission_balance FROM super_affiliate_profiles WHERE id = $1`,
        [saId],
      );
      return Number(row.commission_balance);
    };
    const start = await balance();
    const withdraw = async () =>
      (
        (
          await http()
            .post('/api/v1/super-affiliate/withdrawals')
            .set('Authorization', `Bearer ${saToken}`)
            .send({ amount: 10000 })
            .expect(201)
        ).body as { data: { withdrawal_id: string; status: string } }
      ).data;

    const rejected = await withdraw();
    expect(rejected.status).toBe('pending');
    expect(await balance()).toBe(start - 10000);
    await asAdmin(
      http().post(
        `/api/v1/admin/super-affiliate-withdrawals/${rejected.withdrawal_id}/reject`,
      ),
    ).expect(201);
    expect(await balance()).toBe(start);
    const refundLogs: unknown[] = await db.query(
      `SELECT 1 FROM super_affiliate_commission_logs WHERE withdrawal_id = $1 AND type = 'credit'`,
      [rejected.withdrawal_id],
    );
    expect(refundLogs).toHaveLength(1);

    const paid = await withdraw();
    await asAdmin(
      http().post(
        `/api/v1/admin/super-affiliate-withdrawals/${paid.withdrawal_id}/process`,
      ),
    ).expect(409); // not approved yet
    await asAdmin(
      http().post(
        `/api/v1/admin/super-affiliate-withdrawals/${paid.withdrawal_id}/approve`,
      ),
    ).expect(201);
    const processed = await asAdmin(
      http().post(
        `/api/v1/admin/super-affiliate-withdrawals/${paid.withdrawal_id}/process`,
      ),
    )
      .send({ notes: 'transfer ref 1' })
      .expect(201);
    expect(dataOf(processed).status).toBe('paid');
    expect(await balance()).toBe(start - 10000);

    const list = await asAdmin(
      http().get('/api/v1/admin/super-affiliate-withdrawals'),
    )
      .query({ super_affiliate_id: saId, status: 'paid' })
      .expect(200);
    expect(dataOf(list).total).toBe(1);

    await http()
      .post('/api/v1/super-affiliate/withdrawals')
      .set('Authorization', `Bearer ${saToken}`)
      .send({ amount: 999999999 })
      .expect(400);
  });

  it('moves an affiliate to another upline (one upline only), or detaches it', async () => {
    const target = affiliates[2].profileId;
    await asAdmin(http().patch(`/api/v1/admin/affiliates/${target}/upline`))
      .send({ referral_code: 'ADM-TAKEN' })
      .expect(200);
    const moved = await asAdmin(
      http().patch(`/api/v1/admin/affiliates/${target}/upline`),
    )
      .send({ referral_code: saCode })
      .expect(200);
    expect(dataOf(moved).admin).toBeNull();
    expect(dataOf(moved).super_affiliate).toEqual(
      expect.objectContaining({ referral_code: saCode }),
    );

    await asAdmin(http().patch(`/api/v1/admin/affiliates/${target}/upline`))
      .send({ referral_code: 'NOPE-123' })
      .expect(400);
    await asAdmin(http().patch(`/api/v1/admin/affiliates/${target}/upline`))
      .send({})
      .expect(400);
    const detached = await asAdmin(
      http().patch(`/api/v1/admin/affiliates/${target}/upline`),
    )
      .send({ referral_code: null })
      .expect(200);
    expect(dataOf(detached).super_affiliate).toBeNull();

    // The DB itself refuses two uplines.
    await expect(
      db.query(
        `UPDATE affiliator_profiles SET admin_profile_id = (SELECT id FROM admin_profiles LIMIT 1), super_affiliate_profile_id = $1 WHERE id = $2`,
        [saId, target],
      ),
    ).rejects.toThrow(/CHK_affiliator_profiles_single_upline/);
  });

  it('an inactive or deleted SA earns nothing; the affiliate still does', async () => {
    await setRule({ threshold_mode: 'per_transaction', status: 'inactive' });
    const inactive = await pay(2000000, affiliates[0].code);
    expect(await saCommissionFor(inactive)).toBe('0.00');

    await setRule({ status: 'active' });
    await asAdmin(
      http().delete(`/api/v1/admin/super-affiliates/${saId}`),
    ).expect(200);
    const deleted = await pay(2000000, affiliates[0].code);
    expect(await saCommissionFor(deleted)).toBe('0.00');

    const [tx]: { affiliate_commission: string }[] = await db.query(
      `SELECT affiliate_commission FROM transactions WHERE id = $1`,
      [deleted],
    );
    expect(Number(tx.affiliate_commission)).toBeGreaterThan(0);
    const [link]: { sa: string }[] = await db.query(
      `SELECT super_affiliate_profile_id::text AS sa FROM affiliator_profiles WHERE id = $1`,
      [affiliates[0].profileId],
    );
    expect(link.sa).toBe(saId);

    // A deleted SA's code no longer registers new affiliates, but stays reserved.
    const check = await http()
      .get('/api/v1/affiliate/check-referral-code')
      .query({ code: saCode })
      .expect(200);
    expect(dataOf(check).valid).toBe(false);
    await asAdmin(http().post('/api/v1/admin/manual-admins'))
      .send({
        name: 'Manual Admin 3',
        email: 'manual.admin3.sa.e2e@example.com',
        password: 'super-secret-password',
        coin_limit: 0,
        referral_code: saCode,
      })
      .expect(409);
  });
});
