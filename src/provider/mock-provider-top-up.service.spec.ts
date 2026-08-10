import { MockProviderTopUpService } from './mock-provider-top-up.service';

describe('MockProviderTopUpService', () => {
  let service: MockProviderTopUpService;

  beforeEach(() => {
    service = new MockProviderTopUpService();
  });

  describe('checkId', () => {
    it('resolves a username for a non-empty target user id', async () => {
      const result = await service.checkId(
        'mobile_legends',
        '12345678',
        '1234',
      );

      expect(result.username).toBe('Player_12345678#1234');
    });

    it('omits the zone suffix when no zone id is given', async () => {
      const result = await service.checkId('mobile_legends', '12345678');

      expect(result.username).toBe('Player_12345678');
    });

    it('rejects an empty target user id', async () => {
      await expect(service.checkId('mobile_legends', '   ')).rejects.toThrow(
        'targetUserId is required',
      );
    });
  });

  describe('injectCoin', () => {
    it('always reports success with a serialized response payload', async () => {
      const result = await service.injectCoin({
        productProviderCode: 'ml_120',
        targetUserId: '12345678',
        targetZoneId: '1234',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.response) as Record<string, unknown>;
      expect(parsed.providerCode).toBe('ml_120');
      expect(parsed.targetUserId).toBe('12345678');
    });
  });
});
