import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import { DuitkuService } from './duitku.service';

function buildService(env: Record<string, string>): DuitkuService {
  const configService = {
    getOrThrow: (key: string) => {
      if (!(key in env)) {
        throw new Error(`Missing config key: ${key}`);
      }
      return env[key];
    },
    get: (key: string, defaultValue?: string) => env[key] ?? defaultValue,
  } as unknown as ConfigService;

  return new DuitkuService(configService);
}

describe('DuitkuService', () => {
  const env = {
    DUITKU_MERCHANT_CODE: 'DXXXX',
    DUITKU_API_KEY: 'test-api-key',
    DUITKU_CALLBACK_URL: 'https://example.com/webhooks/duitku/invoice',
    DUITKU_RETURN_URL: 'https://example.com/return',
  };

  describe('verifyInvoiceCallbackSignature', () => {
    it('accepts a correctly computed signature', () => {
      const service = buildService(env);
      const signature = createHmac('sha256', env.DUITKU_API_KEY)
        .update(`${env.DUITKU_MERCHANT_CODE}20000TRX-1`)
        .digest('hex');

      expect(
        service.verifyInvoiceCallbackSignature({
          merchantOrderId: 'TRX-1',
          amount: '20000',
          signature,
        }),
      ).toBe(true);
    });

    it('rejects an incorrect signature', () => {
      const service = buildService(env);

      expect(
        service.verifyInvoiceCallbackSignature({
          merchantOrderId: 'TRX-1',
          amount: '20000',
          signature: 'wrong-signature',
        }),
      ).toBe(false);
    });

    it('rejects a missing signature', () => {
      const service = buildService(env);

      expect(
        service.verifyInvoiceCallbackSignature({
          merchantOrderId: 'TRX-1',
          amount: '20000',
          signature: undefined,
        }),
      ).toBe(false);
    });

    it('rejects a tampered amount without throwing', () => {
      const service = buildService(env);
      const signature = createHmac('sha256', env.DUITKU_API_KEY)
        .update(`${env.DUITKU_MERCHANT_CODE}20000TRX-1`)
        .digest('hex');

      expect(
        service.verifyInvoiceCallbackSignature({
          merchantOrderId: 'TRX-1',
          amount: '999999',
          signature,
        }),
      ).toBe(false);
    });
  });

  describe('createPayout', () => {
    it('returns a structured failure instead of throwing when no bank code mapping exists', async () => {
      const service = buildService(env);

      const result = await service.createPayout({
        referenceId: 'WDW-1',
        amount: 100000,
        bankName: 'BCA',
        accountNumber: '1234567890',
        accountHolder: 'Test Affiliate',
        description: 'Test payout',
      });

      expect(result.success).toBe(false);
      expect(result.payoutId).toBeNull();
      expect(result.responseCode).toBe('BANK_CODE_MISSING');
      expect(result.responseDesc).toContain('BCA');
    });
  });

  describe('verifyDisbursementCallbackSignature', () => {
    it('accepts a correctly computed signature', () => {
      const service = buildService(env);
      const signature = createHash('sha256')
        .update(`${env.DUITKU_MERCHANT_CODE}50000WDW-1${env.DUITKU_API_KEY}`)
        .digest('hex');

      expect(
        service.verifyDisbursementCallbackSignature({
          referenceId: 'WDW-1',
          amount: '50000',
          signature,
        }),
      ).toBe(true);
    });

    it('rejects an incorrect signature', () => {
      const service = buildService(env);

      expect(
        service.verifyDisbursementCallbackSignature({
          referenceId: 'WDW-1',
          amount: '50000',
          signature: 'wrong-signature',
        }),
      ).toBe(false);
    });
  });
});
