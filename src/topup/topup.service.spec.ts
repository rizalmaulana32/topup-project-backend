import { NotFoundException } from '@nestjs/common';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { ProductsService } from '../products/products.service';
import { TransactionsService } from '../transactions/transactions.service';
import { XenditService } from '../xendit/xendit.service';
import { TopupService } from './topup.service';
import { ProductStatus } from '../products/entities/product.entity';
import { PaymentStatus } from '../transactions/entities/transaction.entity';

describe('TopupService', () => {
  // Kept as separate jest.Mock handles (rather than reading them off
  // `provider`) so assertions like expect(checkIdMock) don't trip
  // @typescript-eslint/unbound-method, which flags bare references to
  // interface methods.
  let checkIdMock: jest.Mock;
  let injectCoinMock: jest.Mock;
  let provider: jest.Mocked<ProviderTopUpPort>;
  let productsService: jest.Mocked<
    Pick<ProductsService, 'findActiveByIdOrFail'>
  >;
  let transactionsService: jest.Mocked<
    Pick<
      TransactionsService,
      | 'createPending'
      | 'attachXenditInvoice'
      | 'findByExternalId'
      | 'markPaid'
      | 'markProviderResult'
    >
  >;
  let xenditService: jest.Mocked<Pick<XenditService, 'createInvoice'>>;
  let creditCommissionMock: jest.Mock;
  let affiliatesService: jest.Mocked<
    Pick<AffiliatesService, 'creditCommissionForTransaction'>
  >;
  let service: TopupService;

  const product = {
    id: '1',
    name: '120 Diamonds',
    providerCode: 'ml_120',
    basePrice: '15000',
    sellingPrice: '20000',
    status: ProductStatus.ACTIVE,
    createdAt: new Date(),
  };

  beforeEach(() => {
    checkIdMock = jest.fn();
    injectCoinMock = jest.fn();
    provider = {
      checkId: checkIdMock,
      injectCoin: injectCoinMock,
    };
    productsService = { findActiveByIdOrFail: jest.fn() };
    transactionsService = {
      createPending: jest.fn(),
      attachXenditInvoice: jest.fn(),
      findByExternalId: jest.fn(),
      markPaid: jest.fn(),
      markProviderResult: jest.fn(),
    };
    xenditService = { createInvoice: jest.fn() };
    creditCommissionMock = jest.fn();
    affiliatesService = {
      creditCommissionForTransaction: creditCommissionMock,
    };

    service = new TopupService(
      provider,
      productsService as unknown as ProductsService,
      transactionsService as unknown as TransactionsService,
      xenditService as unknown as XenditService,
      affiliatesService as unknown as AffiliatesService,
    );
  });

  describe('checkId', () => {
    it('delegates to the provider and echoes the request identifiers', async () => {
      checkIdMock.mockResolvedValue({ username: 'Player_1' });

      const result = await service.checkId({
        game_code: 'mobile_legends',
        user_id: '1',
        zone_id: '99',
      });

      expect(checkIdMock).toHaveBeenCalledWith('mobile_legends', '1', '99');
      expect(result).toEqual({
        username: 'Player_1',
        user_id: '1',
        zone_id: '99',
      });
    });
  });

  describe('checkout', () => {
    it('creates a pending transaction, requests a Xendit invoice, and attaches it', async () => {
      productsService.findActiveByIdOrFail.mockResolvedValue(product);
      transactionsService.createPending.mockResolvedValue({
        id: 'TRX-20260805-0001',
      } as any);
      xenditService.createInvoice.mockResolvedValue({
        invoiceId: 'xnd-inv-1',
        invoiceUrl: 'https://checkout.xendit.co/web/xnd-inv-1',
        status: 'PENDING',
      });

      const result = await service.checkout({
        product_id: '1',
        target_user_id: '1',
        target_zone_id: '99',
        affiliate_code: 'AFF123',
      });

      expect(transactionsService.createPending).toHaveBeenCalledWith({
        product,
        targetUserId: '1',
        targetZoneId: '99',
        referralCode: 'AFF123',
      });
      expect(xenditService.createInvoice).toHaveBeenCalledWith({
        externalId: 'TRX-20260805-0001',
        amount: 20000,
        description: 'Top-up 120 Diamonds for 1',
      });
      expect(transactionsService.attachXenditInvoice).toHaveBeenCalledWith(
        'TRX-20260805-0001',
        'xnd-inv-1',
      );
      expect(result).toEqual({
        transaction_id: 'TRX-20260805-0001',
        xendit_invoice_id: 'xnd-inv-1',
        invoice_url: 'https://checkout.xendit.co/web/xnd-inv-1',
      });
    });
  });

  describe('handleInvoicePaid', () => {
    it('marks the transaction paid and injects coin via the provider (no referral code, no commission credit)', async () => {
      const transaction = {
        id: 'TRX-20260805-0001',
        paymentStatus: PaymentStatus.PENDING,
        targetUserId: '1',
        targetZoneId: '99',
        referralCode: null,
        grossAmount: '20000.00',
        product,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );
      injectCoinMock.mockResolvedValue({
        success: true,
        response: '{"mock":true}',
      });

      await service.handleInvoicePaid('TRX-20260805-0001');

      expect(transactionsService.markPaid).toHaveBeenCalledWith(
        'TRX-20260805-0001',
      );
      expect(injectCoinMock).toHaveBeenCalledWith({
        productProviderCode: 'ml_120',
        targetUserId: '1',
        targetZoneId: '99',
      });
      expect(transactionsService.markProviderResult).toHaveBeenCalledWith(
        'TRX-20260805-0001',
        { success: true, response: '{"mock":true}' },
      );
      expect(creditCommissionMock).not.toHaveBeenCalled();
    });

    it('credits commission when the transaction has a referral code and injection succeeded', async () => {
      const transaction = {
        id: 'TRX-20260805-0003',
        paymentStatus: PaymentStatus.PENDING,
        targetUserId: '1',
        targetZoneId: '99',
        referralCode: 'AFF-ABC123',
        grossAmount: '20000.00',
        product,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );
      injectCoinMock.mockResolvedValue({
        success: true,
        response: '{"mock":true}',
      });

      await service.handleInvoicePaid('TRX-20260805-0003');

      expect(creditCommissionMock).toHaveBeenCalledWith({
        referralCode: 'AFF-ABC123',
        transactionId: 'TRX-20260805-0003',
        grossAmount: '20000.00',
      });
    });

    it('does not credit commission when injection failed, even with a referral code', async () => {
      const transaction = {
        id: 'TRX-20260805-0004',
        paymentStatus: PaymentStatus.PENDING,
        targetUserId: '1',
        targetZoneId: '99',
        referralCode: 'AFF-ABC123',
        grossAmount: '20000.00',
        product,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );
      injectCoinMock.mockResolvedValue({
        success: false,
        response: '{"error":"provider down"}',
      });

      await service.handleInvoicePaid('TRX-20260805-0004');

      expect(creditCommissionMock).not.toHaveBeenCalled();
    });

    it('is idempotent: a second callback for an already-paid transaction is ignored', async () => {
      const transaction = {
        id: 'TRX-20260805-0001',
        paymentStatus: PaymentStatus.PAID,
        targetUserId: '1',
        targetZoneId: '99',
        product,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );

      await service.handleInvoicePaid('TRX-20260805-0001');

      expect(transactionsService.markPaid).not.toHaveBeenCalled();
      expect(injectCoinMock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the transaction does not exist', async () => {
      transactionsService.findByExternalId.mockResolvedValue(null);

      await expect(service.handleInvoicePaid('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('records a failed provider result when injection fails', async () => {
      const transaction = {
        id: 'TRX-20260805-0002',
        paymentStatus: PaymentStatus.PENDING,
        targetUserId: '1',
        targetZoneId: null,
        product,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );
      injectCoinMock.mockResolvedValue({
        success: false,
        response: '{"error":"provider down"}',
      });

      await service.handleInvoicePaid('TRX-20260805-0002');

      expect(transactionsService.markProviderResult).toHaveBeenCalledWith(
        'TRX-20260805-0002',
        { success: false, response: '{"error":"provider down"}' },
      );
    });
  });
});
