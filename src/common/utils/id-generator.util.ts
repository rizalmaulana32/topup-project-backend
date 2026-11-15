import type {
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

/**
 * Generates order-style IDs matching the source document's example format
 * (e.g. TRX-20260804-0019). The numeric suffix is randomized, not a strict
 * sequence — exact PK generation strategy was an open question in
 * dev-doc/topup-affiliate-platform/database-diagram.md.
 */
export function generateOrderId(prefix: string): string {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const sequencePart = String(Math.floor(Math.random() * 10000)).padStart(
    4,
    '0',
  );

  return `${prefix}-${datePart}-${sequencePart}`;
}

/**
 * Inserts a new row under a fresh generateOrderId, never overwriting an
 * existing one. Only 10,000 suffixes a day, so collisions are real: the old
 * `save()` silently UPDATEd the existing row on a collision - on prod
 * (2026-11-04..14) that reset 5 already-paid transactions to PENDING under a
 * new customer, and reconciliation, asking LinkQu about the reused
 * partner_reff, saw the OLD payment as success and sent coins for free.
 * ON CONFLICT DO NOTHING (orIgnore) doesn't abort a surrounding transaction,
 * so it's safe inside one too.
 */
export async function insertWithOrderId<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  prefix: string,
  values: QueryDeepPartialEntity<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = generateOrderId(prefix);
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(entity)
      .values({ ...values, id })
      .orIgnore()
      .returning('id')
      .execute();
    if ((result.raw as unknown[]).length > 0) {
      return manager.findOneByOrFail(entity, {
        id,
      } as unknown as FindOptionsWhere<T>);
    }
  }
  throw new Error(`Could not allocate a unique ${prefix} id`);
}

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates a unique-enough referral code (e.g. AFF-7K2QX9). Uniqueness is
 * enforced at the database level (affiliate_code UK); callers should retry
 * on a rare collision.
 */
export function generateReferralCode(prefix = 'AFF'): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix +=
      REFERRAL_CODE_ALPHABET[
        Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length)
      ];
  }

  return `${prefix}-${suffix}`;
}
