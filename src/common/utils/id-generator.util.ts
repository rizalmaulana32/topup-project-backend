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
