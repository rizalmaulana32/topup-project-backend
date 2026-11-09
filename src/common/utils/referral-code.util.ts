import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { generateReferralCode } from './id-generator.util';

export type ReferralCodeTable =
  'admin_profiles' | 'super_affiliate_profiles' | 'affiliator_profiles';

/**
 * One referral code must point at exactly one account across admins, super
 * affiliates and affiliates (soft-deleted rows included - their codes stay
 * reserved so old transactions remain traceable).
 */
export async function findReferralCodeOwner(
  db: DataSource | EntityManager,
  code: string,
): Promise<{ table: ReferralCodeTable; id: string } | null> {
  const rows: { table: ReferralCodeTable; id: string }[] = await db.query(
    `SELECT 'admin_profiles' AS "table", id::text AS id FROM admin_profiles WHERE referral_code = $1
     UNION ALL SELECT 'super_affiliate_profiles', id::text FROM super_affiliate_profiles WHERE referral_code = $1
     UNION ALL SELECT 'affiliator_profiles', id::text FROM affiliator_profiles WHERE affiliate_code = $1
     LIMIT 1`,
    [code],
  );
  return rows[0] ?? null;
}

/** Throws 409 unless `code` is free, or already belongs to `self`. */
export async function assertReferralCodeAvailable(
  db: DataSource | EntityManager,
  code: string,
  self?: { table: ReferralCodeTable; id: string },
): Promise<string> {
  const owner = await findReferralCodeOwner(db, code);
  if (owner && !(owner.table === self?.table && owner.id === String(self.id))) {
    throw new ConflictException(`Referral code ${code} is already in use`);
  }
  return code;
}

export async function generateUniqueReferralCode(
  db: DataSource | EntityManager,
  prefix: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateReferralCode(prefix);
    if (!(await findReferralCodeOwner(db, candidate))) return candidate;
  }
  throw new ConflictException(
    'Could not generate a unique referral code, please retry',
  );
}
