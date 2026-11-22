import { Repository } from 'typeorm';
import { PaymentStatus, Transaction } from './entities/transaction.entity';
import { TransactionsService } from './transactions.service';

describe('TransactionsService.markPaid', () => {
  it('accepts a pending or already-expired transaction (last-second payment), nothing else', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const service = new TransactionsService({
      update,
    } as unknown as Repository<Transaction>);

    await expect(service.markPaid('TRX-1')).resolves.toBe(true);

    const where = update.mock.calls[0][0] as {
      paymentStatus: { value: PaymentStatus[] };
    };
    expect(where.paymentStatus.value).toEqual([
      PaymentStatus.PENDING,
      PaymentStatus.EXPIRED,
    ]);
  });
});
