import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { LinkQuService } from './linkqu.service';

function buildService(env: Record<string, string>): LinkQuService {
  const configService = {
    getOrThrow: (key: string) => {
      if (!(key in env)) {
        throw new Error(`Missing config key: ${key}`);
      }
      return env[key];
    },
    get: (key: string, defaultValue?: string) => env[key] ?? defaultValue,
  } as unknown as ConfigService;

  return new LinkQuService(configService);
}

describe('LinkQuService', () => {
  const env = {
    LINKQU_CLIENT_ID: 'testing',
    LINKQU_CLIENT_SECRET: '123',
    LINKQU_USERNAME: 'LI307GXIN',
    LINKQU_PIN: '2K2NPCBBNNTovgB',
    LINKQU_SIGNATURE_KEY: 'LinkQu@2020',
  };

  describe('verifyInvoiceCallbackSignature', () => {
    it('accepts a correctly computed signature (formula real-verified from LinkQu docs)', () => {
      const service = buildService(env);
      const signature = createHmac('sha256', env.LINKQU_SIGNATURE_KEY)
        .update('TRX-1200007136490000031689LI307GXIN')
        .digest('hex');

      expect(
        service.verifyInvoiceCallbackSignature({
          partnerReff: 'TRX-1',
          amount: '20000',
          vaNumber: '7136490000031689',
          username: 'LI307GXIN',
          signature,
        }),
      ).toBe(true);
    });

    it('rejects an incorrect signature', () => {
      const service = buildService(env);

      expect(
        service.verifyInvoiceCallbackSignature({
          partnerReff: 'TRX-1',
          amount: '20000',
          vaNumber: '7136490000031689',
          username: 'LI307GXIN',
          signature: 'wrong-signature',
        }),
      ).toBe(false);
    });

    it('rejects a missing signature', () => {
      const service = buildService(env);

      expect(
        service.verifyInvoiceCallbackSignature({
          partnerReff: 'TRX-1',
          amount: '20000',
          vaNumber: '7136490000031689',
          username: 'LI307GXIN',
          signature: undefined,
        }),
      ).toBe(false);
    });

    it('rejects a tampered amount without throwing', () => {
      const service = buildService(env);
      const signature = createHmac('sha256', env.LINKQU_SIGNATURE_KEY)
        .update('TRX-1200007136490000031689LI307GXIN')
        .digest('hex');

      expect(
        service.verifyInvoiceCallbackSignature({
          partnerReff: 'TRX-1',
          amount: '999999',
          vaNumber: '7136490000031689',
          username: 'LI307GXIN',
          signature,
        }),
      ).toBe(false);
    });
  });

  describe('verifyDisbursementCallbackSignature', () => {
    it('accepts a correctly computed signature', () => {
      const service = buildService(env);
      const signature = createHmac('sha256', env.LINKQU_SIGNATURE_KEY)
        .update('WDW-15000012345678LI307GXIN')
        .digest('hex');

      expect(
        service.verifyDisbursementCallbackSignature({
          partnerReff: 'WDW-1',
          amount: '50000',
          accountNumber: '12345678',
          username: 'LI307GXIN',
          signature,
        }),
      ).toBe(true);
    });

    it('rejects an incorrect signature', () => {
      const service = buildService(env);

      expect(
        service.verifyDisbursementCallbackSignature({
          partnerReff: 'WDW-1',
          amount: '50000',
          accountNumber: '12345678',
          username: 'LI307GXIN',
          signature: 'wrong-signature',
        }),
      ).toBe(false);
    });
  });

  describe('createPayout', () => {
    it('returns a structured FAILED result instead of throwing when no bank code mapping exists', async () => {
      const service = buildService(env);

      const result = await service.createPayout({
        referenceId: 'WDW-1',
        amount: 100000,
        bankName: 'Totally Unknown Bank',
        accountNumber: '1234567890',
        accountHolder: 'Test Affiliate',
        description: 'Test payout',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.payoutId).toBeNull();
      expect(result.responseCode).toBe('BANK_CODE_MISSING');
      expect(result.responseDesc).toContain('Totally Unknown Bank');
    });
  });

  describe('createInvoice', () => {
    afterEach(() => jest.restoreAllMocks());

    it('sends expired as WIB yyyyMMddHHmmss, whatever the server TZ', async () => {
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            rc: '00',
            data: {
              'payment-request': { id: 1, partnerReff: 'TRX-1' },
              'payment-url': 'https://pay.example/1',
            },
          }),
      } as Response);

      await buildService(env).createInvoice({
        externalId: 'TRX-1',
        amount: 10000,
        description: 'Top-up',
        // 23:30 UTC = 06:30 WIB the next day.
        expiresAt: new Date('2026-11-21T23:30:00Z'),
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string) as {
        expired: string;
      };
      expect(body.expired).toBe('20261122063000');
    });
  });
});
