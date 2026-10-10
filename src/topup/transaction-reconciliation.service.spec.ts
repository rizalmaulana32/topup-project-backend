import { LinkQuService } from '../linkqu/linkqu.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TopupService } from './topup.service';
import { TransactionReconciliationService } from './transaction-reconciliation.service';

describe('TransactionReconciliationService', () => {
  let transactionsService: jest.Mocked<
    Pick<TransactionsService, 'findPendingWithLinkQuReference'>
  >;
  let linkQuService: jest.Mocked<Pick<LinkQuService, 'checkTransactionStatus'>>;
  let handleInvoicePaidMock: jest.Mock;
  let handleInvoiceExpiredMock: jest.Mock;
  let topupService: jest.Mocked<
    Pick<TopupService, 'handleInvoicePaid' | 'handleInvoiceExpired'>
  >;
  let service: TransactionReconciliationService;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    transactionsService = { findPendingWithLinkQuReference: jest.fn() };
    linkQuService = { checkTransactionStatus: jest.fn() };
    handleInvoicePaidMock = jest.fn();
    handleInvoiceExpiredMock = jest.fn();
    topupService = {
      handleInvoicePaid: handleInvoicePaidMock,
      handleInvoiceExpired: handleInvoiceExpiredMock,
    };

    service = new TransactionReconciliationService(
      transactionsService as unknown as TransactionsService,
      linkQuService as unknown as LinkQuService,
      topupService as unknown as TopupService,
    );
  });

  it('does nothing when there are no pending transactions', async () => {
    transactionsService.findPendingWithLinkQuReference.mockResolvedValue([]);

    await service.reconcilePendingTransactions();

    expect(linkQuService.checkTransactionStatus).not.toHaveBeenCalled();
  });

  it('completes a transaction that LinkQu shows as paid but is still pending here (the lost-webhook case)', async () => {
    transactionsService.findPendingWithLinkQuReference.mockResolvedValue([
      { id: 'TRX-1', createdAt: oneHourAgo } as any,
    ]);
    linkQuService.checkTransactionStatus.mockResolvedValue({
      statusCode: 'success',
      statusMessage: 'APPROVE/SUCCESS',
      fee: '4000',
    });

    await service.reconcilePendingTransactions();

    expect(handleInvoicePaidMock).toHaveBeenCalledWith('TRX-1');
    expect(handleInvoiceExpiredMock).not.toHaveBeenCalled();
  });

  it('leaves a recent, still-genuinely-unpaid transaction alone', async () => {
    transactionsService.findPendingWithLinkQuReference.mockResolvedValue([
      { id: 'TRX-2', createdAt: oneHourAgo } as any,
    ]);
    linkQuService.checkTransactionStatus.mockResolvedValue({
      statusCode: 'unknown',
      statusMessage: 'Transaksi tidak ditemukan',
      fee: null,
    });

    await service.reconcilePendingTransactions();

    expect(handleInvoicePaidMock).not.toHaveBeenCalled();
    expect(handleInvoiceExpiredMock).not.toHaveBeenCalled();
  });

  it('expires a transaction past the 24h invoice window that is still unpaid on LinkQu', async () => {
    transactionsService.findPendingWithLinkQuReference.mockResolvedValue([
      { id: 'TRX-3', createdAt: twoDaysAgo } as any,
    ]);
    linkQuService.checkTransactionStatus.mockResolvedValue({
      statusCode: 'unknown',
      statusMessage: 'Transaksi tidak ditemukan',
      fee: null,
    });

    await service.reconcilePendingTransactions();

    expect(handleInvoicePaidMock).not.toHaveBeenCalled();
    expect(handleInvoiceExpiredMock).toHaveBeenCalledWith('TRX-3');
  });

  it('continues checking the rest of the batch if one transaction check throws', async () => {
    transactionsService.findPendingWithLinkQuReference.mockResolvedValue([
      { id: 'TRX-4', createdAt: oneHourAgo } as any,
      { id: 'TRX-5', createdAt: oneHourAgo } as any,
    ]);
    linkQuService.checkTransactionStatus
      .mockRejectedValueOnce(new Error('LinkQu is briefly unreachable'))
      .mockResolvedValueOnce({
        statusCode: 'success',
        statusMessage: 'APPROVE/SUCCESS',
        fee: '0',
      });

    await service.reconcilePendingTransactions();

    expect(handleInvoicePaidMock).toHaveBeenCalledTimes(1);
    expect(handleInvoicePaidMock).toHaveBeenCalledWith('TRX-5');
  });

  it('does not crash the sweep if completing a paid transaction itself throws', async () => {
    transactionsService.findPendingWithLinkQuReference.mockResolvedValue([
      { id: 'TRX-6', createdAt: oneHourAgo } as any,
      { id: 'TRX-7', createdAt: oneHourAgo } as any,
    ]);
    linkQuService.checkTransactionStatus.mockResolvedValue({
      statusCode: 'success',
      statusMessage: 'APPROVE/SUCCESS',
      fee: '0',
    });
    handleInvoicePaidMock
      .mockRejectedValueOnce(new Error('coin injection failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.reconcilePendingTransactions(),
    ).resolves.toBeUndefined();

    expect(handleInvoicePaidMock).toHaveBeenCalledTimes(2);
  });
});
