import { DataSource, Repository } from 'typeorm';
import { CoinSendGuard } from './coin-send-guard.service';
import { CoinSend } from './entities/coin-send.entity';
import type { ProviderTopUpPort } from './provider-top-up.port';

describe('CoinSendGuard audit columns', () => {
  const setup = (inject: ProviderTopUpPort['injectCoin']) => {
    const save = jest.fn((row: Partial<CoinSend>) => ({ ...row, id: '7' }));
    const manager = {
      query: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn((_entity: unknown, row: Partial<CoinSend>) => row),
      save,
    };
    const update = jest.fn();
    const guard = new CoinSendGuard(
      { update } as unknown as Repository<CoinSend>,
      {
        transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
      } as unknown as DataSource,
    );
    const port = guard.wrap({
      injectCoin: inject,
    } as unknown as ProviderTopUpPort);
    return { port, save, update };
  };

  it('stores admin id, reason, provider response and balance after', async () => {
    const { port, save, update } = setup(
      jest.fn().mockResolvedValue({
        success: true,
        response: '{"surplus_coin":950}',
        balanceAfter: 950,
      }),
    );
    await port.injectCoin({
      productProviderCode: 'ADMIN_MANUAL_TRANSFER',
      targetUserId: 'u1',
      coin: 50,
      adminId: '3',
      reason: 'kompensasi',
      refId: 'TRX-1',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: '3',
        reason: 'kompensasi',
        refId: 'TRX-1',
      }),
    );
    expect(update).toHaveBeenCalledWith('7', {
      status: 'success',
      providerResponse: '{"surplus_coin":950}',
      balanceAfter: '950.00',
    });
  });

  it('stores the error message when the provider call throws', async () => {
    const { port, save, update } = setup(
      jest.fn().mockRejectedValue(new Error('timeout')),
    );
    await expect(
      port.injectCoin({
        productProviderCode: 'custom-amount',
        targetUserId: 'u1',
        coin: 50,
      }),
    ).rejects.toThrow('timeout');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: null, reason: null }),
    );
    expect(update).toHaveBeenCalledWith('7', {
      status: 'unknown',
      providerResponse: 'timeout',
    });
  });
});
