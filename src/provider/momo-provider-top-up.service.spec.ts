import { createHash } from 'crypto';
import { signMomoParams } from './momo-provider-top-up.service';

describe('signMomoParams', () => {
  const apiSecret = 'Xz9Pq4RkLm2Tn8sBv6Yw7eHj1Gf3cD5';

  it('sorts keys alphabetically and appends the secret with no separator', () => {
    const params = {
      user_id: 1000007,
      merchant_id: 1000007,
      timestamp: 1700000000,
    };

    const expected = createHash('sha256')
      .update(
        `merchant_id=1000007&timestamp=1700000000&user_id=1000007${apiSecret}`,
      )
      .digest('hex');

    expect(signMomoParams(params, apiSecret)).toBe(expected);
  });

  it('produces a different signature when a value changes', () => {
    const base = {
      merchant_id: 1000007,
      timestamp: 1700000000,
      user_id: 1000007,
    };
    const changed = { ...base, user_id: 999999 };

    expect(signMomoParams(base, apiSecret)).not.toBe(
      signMomoParams(changed, apiSecret),
    );
  });
});
