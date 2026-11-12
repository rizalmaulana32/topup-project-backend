/**
 * Dev-only sample data for the super affiliate (SA) feature, built through
 * the real services so balances, logs and commissions are consistent.
 *
 *   npm run seed:super-affiliates            # (re)create the seed data
 *   npm run seed:super-affiliates -- --clean # remove it only
 *
 * Everything it creates is tagged (emails @seed.yaytopup.test, codes
 * SA-SEED-* / AFF-SEED-*) and is removed first, so it is safe to re-run.
 * Other rows are never deleted; a non-seed affiliate that joined a seed SA
 * is only detached from it. Platform revenue is NOT credited (it would move
 * the dev platform balance). All passwords: password123.
 */
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { AffiliatorProfile } from '../src/affiliates/entities/affiliator-profile.entity';
import { WithdrawalMethod } from '../src/affiliates/entities/commission-withdrawal.entity';
import { BonusTiersService } from '../src/bonus-tiers/bonus-tiers.service';
import { SettingsService } from '../src/settings/settings.service';
import { SuperAffiliateThresholdMode as Mode } from '../src/super-affiliates/entities/super-affiliate-profile.entity';
import { SuperAffiliatesService } from '../src/super-affiliates/super-affiliates.service';
import { calculateCustomAmountPricing } from '../src/topup/custom-amount-pricing.util';
import {
  PaymentStatus,
  ProviderStatus,
  Transaction,
} from '../src/transactions/entities/transaction.entity';
import { UserStatus } from '../src/users/entities/user.entity';

const DOMAIN = '@seed.yaytopup.test';
const PASSWORD = 'password123';
const bank = (name: string) => ({
  phoneNumber: '081200000000',
  bankName: 'BCA',
  accountNumber: '8800112233',
  accountHolder: name,
});

const SUPER_AFFILIATES = [
  {
    key: 'budi',
    name: 'Budi Santoso',
    code: 'SA-SEED-BUDI',
    mode: Mode.PER_TRANSACTION,
    rate: 1,
    threshold: 1000000,
  },
  {
    key: 'citra',
    name: 'Citra Lestari',
    code: 'SA-SEED-CITRA',
    mode: Mode.MONTHLY_TOTAL_DOWNLINE,
    rate: 1.5,
    threshold: 3000000,
  },
  {
    key: 'dewi',
    name: 'Dewi Anggraini',
    code: 'SA-SEED-DEWI',
    mode: Mode.MONTHLY_PER_AFFILIATE,
    rate: 2,
    threshold: 2000000,
  },
  {
    key: 'eko',
    name: 'Eko Prasetyo',
    code: 'SA-SEED-EKO',
    mode: Mode.PER_TRANSACTION,
    rate: 1,
    threshold: 1000000,
    inactive: true,
  },
] as const;

/** n -> upline SA key (null = no upline); `pending` = registered, not approved. */
const AFFILIATES: {
  n: number;
  name: string;
  sa: string | null;
  pending?: boolean;
}[] = [
  { n: 1, name: 'Fajar Nugroho', sa: 'budi' },
  { n: 2, name: 'Gita Permata', sa: 'budi' },
  { n: 3, name: 'Hadi Wijaya', sa: 'citra' },
  { n: 4, name: 'Indah Sari', sa: 'citra' },
  { n: 5, name: 'Joko Susilo', sa: 'citra' },
  { n: 6, name: 'Kartika Dewi', sa: 'dewi' },
  { n: 7, name: 'Lukman Hakim', sa: 'dewi' },
  { n: 8, name: 'Maya Putri', sa: 'eko' },
  { n: 9, name: 'Nanda Pratama', sa: null },
  { n: 10, name: 'Oki Setiawan', sa: 'budi', pending: true },
];

/** [affiliate n, gross] in paid order - chosen to cross each SA's threshold mid-month. */
const TRANSACTIONS: [number, number][] = [
  [1, 250000],
  [3, 800000],
  [6, 1200000],
  [1, 1200000],
  [4, 900000],
  [7, 1500000],
  [2, 1000000],
  [3, 1000000],
  [6, 900000],
  [4, 500000],
  [1, 500000],
  [8, 2000000],
  [2, 750000],
  [4, 1500000],
  [6, 300000],
  [5, 400000],
  [7, 400000],
  [1, 2000000],
  [9, 600000],
  [2, 3000000],
  [5, 2000000],
  [1, 5000000],
];

const code = (n: number) => `AFF-SEED-${String(n).padStart(2, '0')}`;

async function clean(db: DataSource) {
  const sa = `SELECT p.id FROM super_affiliate_profiles p JOIN users u ON u.id = p.user_id WHERE u.email LIKE '%${DOMAIN}'`;
  const aff = `SELECT p.id FROM affiliator_profiles p JOIN users u ON u.id = p.user_id WHERE u.email LIKE '%${DOMAIN}'`;
  await db.transaction(async (m) => {
    await m.query(
      `DELETE FROM super_affiliate_commission_logs WHERE super_affiliate_profile_id IN (${sa})`,
    );
    await m.query(
      `DELETE FROM super_affiliate_withdrawals WHERE super_affiliate_profile_id IN (${sa})`,
    );
    await m.query(
      `DELETE FROM commission_logs WHERE affiliator_id IN (SELECT id::text FROM (${aff}) a)`,
    );
    await m.query(
      `DELETE FROM commission_withdrawals WHERE affiliator_id IN (${aff})`,
    );
    await m.query(
      `DELETE FROM transactions WHERE referral_code LIKE 'AFF-SEED-%' AND provider_response = 'seed'`,
    );
    // Non-seed affiliates who joined a seed SA (e.g. QA sign-ups) are detached, not deleted.
    await m.query(
      `UPDATE affiliator_profiles SET super_affiliate_profile_id = NULL WHERE super_affiliate_profile_id IN (${sa}) AND id NOT IN (${aff})`,
    );
    await m.query(`DELETE FROM affiliator_profiles WHERE id IN (${aff})`);
    await m.query(`DELETE FROM super_affiliate_profiles WHERE id IN (${sa})`);
    await m.query(`DELETE FROM users WHERE email LIKE '%${DOMAIN}'`);
  });
}

/** TRX-YYYYMMDD-NNNN dated by the paid date, avoiding existing ids. */
async function transactionId(db: DataSource, paidAt: Date): Promise<string> {
  const ymd = paidAt.toISOString().slice(0, 10).replace(/-/g, '');
  for (;;) {
    const id = `TRX-${ymd}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    const taken: unknown[] = await db.query(
      'SELECT 1 FROM transactions WHERE id = $1',
      [id],
    );
    if (!taken.length) return id;
  }
}

/**
 * Seed accounts share a known password and carry withdrawable balances, so
 * never let this touch production: refuse unless the env is clearly dev
 * (production runs NODE_ENV=production with the real momo coin provider).
 */
function assertDevEnvironment() {
  dotenv.config();
  const nodeEnv = process.env.NODE_ENV ?? '';
  const vendor = process.env.PROVIDER_TOP_UP_VENDOR ?? 'mock';
  if (nodeEnv === 'production' || vendor !== 'mock') {
    throw new Error(
      `Refusing to seed: NODE_ENV=${nodeEnv || '(unset)'}, PROVIDER_TOP_UP_VENDOR=${vendor}. ` +
        'This script is for local development only (needs NODE_ENV != production and the mock provider).',
    );
  }
}

async function main() {
  assertDevEnvironment();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get(DataSource);
  const saService = app.get(SuperAffiliatesService);
  const affiliatesService = app.get(AffiliatesService);

  await clean(db);
  if (process.argv.includes('--clean')) {
    console.log('Seed data removed.');
    return app.close();
  }

  const [{ id: adminId }]: { id: string }[] = await db.query(
    `SELECT id::text FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1`,
  );

  const saIds: Record<string, string> = {};
  for (const sa of SUPER_AFFILIATES) {
    const profile = await saService.create(
      {
        name: sa.name,
        email: `${sa.key}${DOMAIN}`,
        password: PASSWORD,
        ...bank(sa.name),
        referralCode: sa.code,
        commissionRate: sa.rate,
        thresholdMode: sa.mode,
        thresholdAmount: sa.threshold,
      },
      adminId,
    );
    saIds[sa.key] = profile.id;
  }

  for (const a of AFFILIATES) {
    const sa = SUPER_AFFILIATES.find((s) => s.key === a.sa);
    const { user_id } = await affiliatesService.register({
      name: a.name,
      email: `affiliate${a.n}${DOMAIN}`,
      password: PASSWORD,
      phone_number: '081300000000',
      bank_name: 'Mandiri',
      account_number: `13000000${a.n}`,
      account_holder: a.name,
      ...(sa && { referral_code: sa.code }),
    });
    if (a.pending) continue;
    const profile = await db
      .getRepository(AffiliatorProfile)
      .findOneByOrFail({ userId: user_id });
    await affiliatesService.approve(profile.id, adminId, code(a.n));
  }

  // Inactive SA (after its affiliate joined): its downline sale earns it nothing.
  await saService.update(saIds.eko, { status: UserStatus.INACTIVE });

  // Paid transactions spread over this UTC month so far, oldest first.
  const settings = await app.get(SettingsService).get();
  const tiers = await app.get(BonusTiersService).findAll();
  const now = Date.now();
  const monthStart = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    1,
  );
  const step = (now - monthStart) / (TRANSACTIONS.length + 1);
  for (const [i, [n, gross]] of TRANSACTIONS.entries()) {
    const paidAt = new Date(monthStart + step * (i + 1));
    const pricing = calculateCustomAmountPricing(
      gross,
      tiers,
      Number(settings.customAmountMarginRate),
      settings.customAmountExtraCoinEnabled,
    );
    const id = await transactionId(db, paidAt);
    await db.getRepository(Transaction).insert({
      id,
      targetUserId: `71000${String(n).padStart(2, '0')}`,
      referralCode: code(n),
      grossAmount: gross.toFixed(2),
      coinAmount: pricing.coinAmount.toFixed(2),
      costBasis: pricing.costBasis.toFixed(2),
      bonusCoin: pricing.bonusCoin.toFixed(2),
      paymentStatus: PaymentStatus.PAID,
      providerStatus: ProviderStatus.SUCCESS,
      providerResponse: 'seed',
      paidAt,
      completedAt: paidAt,
      createdAt: paidAt,
    });
    await affiliatesService.creditCommissionForTransaction({
      referralCode: code(n),
      transactionId: id,
      originalAmount: gross.toFixed(2),
      bonusDeduction: pricing.bonusCoin.toFixed(2),
    });
    await saService.creditCommissionForTransaction({
      referralCode: code(n),
      transactionId: id,
      grossAmount: gross.toFixed(2),
    });
  }

  // Withdrawals in every status (bank only - momo_coin would call MomoLive).
  const bankPayout = { method: WithdrawalMethod.BANK };
  const budiUser = `budi${DOMAIN}`;
  const [{ id: budiUserId }]: { id: string }[] = await db.query(
    'SELECT id::text FROM users WHERE email = $1',
    [budiUser],
  );
  const rejected = await saService.requestWithdrawal(
    budiUserId,
    20000,
    bankPayout,
  );
  await saService.rejectWithdrawal(rejected.id, adminId);
  const paid = await saService.requestWithdrawal(budiUserId, 25000, bankPayout);
  await saService.approveWithdrawal(paid.id, adminId);
  await saService.markWithdrawalProcessed(
    paid.id,
    adminId,
    'Transfer BCA ref SEED-001',
  );
  const approved = await saService.requestWithdrawal(
    budiUserId,
    15000,
    bankPayout,
  );
  await saService.approveWithdrawal(approved.id, adminId);
  await saService.requestWithdrawal(budiUserId, 10000, bankPayout); // pending

  const [{ id: citraUserId }]: { id: string }[] = await db.query(
    'SELECT id::text FROM users WHERE email = $1',
    [`citra${DOMAIN}`],
  );
  await saService.requestWithdrawal(citraUserId, 50000, bankPayout); // pending

  const rows: Record<string, unknown>[] = await db.query(
    `SELECT u.email, p.referral_code, p.threshold_mode, p.commission_balance, p.total_commission_earned, u.status
     FROM super_affiliate_profiles p JOIN users u ON u.id = p.user_id
     WHERE u.email LIKE '%${DOMAIN}' ORDER BY p.id`,
  );
  console.table(rows);
  console.log(`Password for every seed account: ${PASSWORD}`);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
