import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { PlatformService } from '../platform/platform.service';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import { TransactionsService } from '../transactions/transactions.service';
import { LinkQuService } from '../linkqu/linkqu.service';
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
  let getBalanceMock: jest.Mock;
  let provider: jest.Mocked<ProviderTopUpPort>;
  let productsService: jest.Mocked<
    Pick<ProductsService, 'findActiveByIdOrFail'>
  >;
  let transactionsService: jest.Mocked<
    Pick<
      TransactionsService,
      | 'createPending'
      | 'createPendingCustomAmount'
      | 'attachLinkQuReference'
      | 'findByExternalId'
      | 'markPaid'
      | 'markExpired'
      | 'markFailed'
      | 'markProviderResult'
      | 'setProviderFee'
    >
  >;
  let linkQuService: jest.Mocked<
    Pick<LinkQuService, 'createInvoice' | 'checkTransactionStatus'>
  >;
  let creditCommissionMock: jest.Mock;
  let affiliatesService: jest.Mocked<
    Pick<AffiliatesService, 'creditCommissionForTransaction'>
  >;
  let creditRevenueMock: jest.Mock;
  let platformService: jest.Mocked<
    Pick<PlatformService, 'creditRevenueForTransaction'>
  >;
  let settingsService: jest.Mocked<Pick<SettingsService, 'get'>>;
  let service: TopupService;

  const product = {
    id: '1',
    name: '120 Diamonds',
    providerCode: 'ml_120',
    basePrice: '15000',
    sellingPrice: '20000',
    coinAmount: '120',
    bonusCoin: '0',
    flag: null,
    status: ProductStatus.ACTIVE,
    createdAt: new Date(),
  };

  beforeEach(() => {
    checkIdMock = jest.fn();
    injectCoinMock = jest.fn();
    getBalanceMock = jest.fn();
    provider = {
      checkId: checkIdMock,
      injectCoin: injectCoinMock,
      getBalance: getBalanceMock,
    };
    productsService = { findActiveByIdOrFail: jest.fn() };
    transactionsService = {
      createPending: jest.fn(),
      createPendingCustomAmount: jest.fn(),
      attachLinkQuReference: jest.fn(),
      findByExternalId: jest.fn(),
      markPaid: jest.fn().mockResolvedValue(true),
      markExpired: jest.fn(),
      markFailed: jest.fn(),
      markProviderResult: jest.fn(),
      setProviderFee: jest.fn(),
    };
    linkQuService = {
      createInvoice: jest.fn(),
      checkTransactionStatus: jest.fn(),
    };
    creditCommissionMock = jest.fn().mockResolvedValue('0.00');
    affiliatesService = {
      creditCommissionForTransaction: creditCommissionMock,
    };
    creditRevenueMock = jest.fn();
    platformService = {
      creditRevenueForTransaction: creditRevenueMock,
    };
    settingsService = {
      get: jest.fn().mockResolvedValue({ customAmountMarginRate: '0' }),
    };

    service = new TopupService(
      provider,
      productsService as unknown as ProductsService,
      transactionsService as unknown as TransactionsService,
      linkQuService as unknown as LinkQuService,
      affiliatesService as unknown as AffiliatesService,
      platformService as unknown as PlatformService,
      settingsService as unknown as SettingsService,
    );
  });

  describe('checkId', () => {
    it('delegates to the provider and echoes the request identifiers, including the avatar', async () => {
      checkIdMock.mockResolvedValue({
        username: 'Player_1',
        avatarUrl: 'https://example.com/avatar.png',
      });

      const result = await service.checkId({
        game_code: 'mobile_legends',
        user_id: '1',
        zone_id: '99',
      });

      expect(checkIdMock).toHaveBeenCalledWith('mobile_legends', '1', '99');
      expect(result).toEqual({
        username: 'Player_1',
        avatar_url: 'https://example.com/avatar.png',
        user_id: '1',
        zone_id: '99',
      });
    });
  });

  describe('getTransactionStatus', () => {
    it('includes the LinkQu fee for a transaction with a linkqu_reference', async () => {
      transactionsService.findByExternalId.mockResolvedValue({
        id: 'TRX-20260805-0001',
        paymentStatus: PaymentStatus.PAID,
        providerStatus: null,
        linkQuReference: 'DS3460326ABC',
        grossAmount: '10000.00',
        product: null,
        createdAt: new Date(),
        paidAt: new Date(),
        completedAt: new Date(),
      } as any);
      linkQuService.checkTransactionStatus.mockResolvedValue({
        statusCode: 'success',
        statusMessage: 'SUCCESS',
        fee: '5000.00',
      });

      const result = await service.getTransactionStatus('TRX-20260805-0001');

      expect(linkQuService.checkTransactionStatus).toHaveBeenCalledWith(
        'TRX-20260805-0001',
      );
      expect(result.admin_fee).toBe('5000.00');
    });

    it('does not call LinkQu and returns a null fee for a transaction with no linkqu_reference', async () => {
      transactionsService.findByExternalId.mockResolvedValue({
        id: 'TRX-20260805-0002',
        paymentStatus: PaymentStatus.PENDING,
        providerStatus: null,
        linkQuReference: null,
        grossAmount: '10000.00',
        product: null,
        createdAt: new Date(),
        paidAt: null,
        completedAt: null,
      } as any);

      const result = await service.getTransactionStatus('TRX-20260805-0002');

      expect(linkQuService.checkTransactionStatus).not.toHaveBeenCalled();
      expect(result.admin_fee).toBeNull();
    });

    it('degrades gracefully to a null fee if the LinkQu fee lookup fails', async () => {
      transactionsService.findByExternalId.mockResolvedValue({
        id: 'TRX-20260805-0003',
        paymentStatus: PaymentStatus.PAID,
        providerStatus: null,
        linkQuReference: 'DS3460326DEF',
        grossAmount: '10000.00',
        product: null,
        createdAt: new Date(),
        paidAt: new Date(),
        completedAt: new Date(),
      } as any);
      linkQuService.checkTransactionStatus.mockRejectedValue(
        new Error('LinkQu checkstatus request failed: HTTP 500'),
      );

      const result = await service.getTransactionStatus('TRX-20260805-0003');

      expect(result.admin_fee).toBeNull();
      expect(result.transaction_id).toBe('TRX-20260805-0003');
    });
  });

  describe('checkout', () => {
    it('creates a pending transaction, requests a LinkQu payment link, and attaches it', async () => {
      productsService.findActiveByIdOrFail.mockResolvedValue(product);
      transactionsService.createPending.mockResolvedValue({
        id: 'TRX-20260805-0001',
      } as any);
      linkQuService.createInvoice.mockResolvedValue({
        invoiceId: '715',
        invoiceUrl:
          'https://cognos.linkqu.id/pay/0945572d-116b-4fc8-aa05-c43caa358491',
        status: '00',
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
      expect(linkQuService.createInvoice).toHaveBeenCalledWith({
        externalId: 'TRX-20260805-0001',
        amount: 20000,
        description: 'Top-up 120 Diamonds for 1',
      });
      expect(transactionsService.attachLinkQuReference).toHaveBeenCalledWith(
        'TRX-20260805-0001',
        '715',
      );
      expect(result).toEqual({
        transaction_id: 'TRX-20260805-0001',
        linkqu_reference: '715',
        invoice_url:
          'https://cognos.linkqu.id/pay/0945572d-116b-4fc8-aa05-c43caa358491',
      });
    });
  });

  describe('estimateCustomAmount', () => {
    it('derives coin_amount/bonus_coin from a given amount', async () => {
      const result = await service.estimateCustomAmount({ amount: 500000 });

      expect(result).toEqual({
        amount: 500000,
        coin_amount: 505000,
        bonus_coin: 5000,
      });
    });

    it('treats `coin` as an alias for `amount` - same forward calculation, not a reverse target', async () => {
      const result = await service.estimateCustomAmount({ coin: 370000 });

      // 370000 is itself the nominal (coin and rupiah are the same input
      // by design) - it qualifies for the 350k tier -> +3500 bonus on top.
      expect(result).toEqual({
        amount: 370000,
        coin_amount: 373500,
        bonus_coin: 3500,
      });
    });

    it('reads the margin rate from settings, same as checkout', async () => {
      settingsService.get.mockResolvedValue({
        customAmountMarginRate: '10',
      } as any);

      const result = await service.estimateCustomAmount({ amount: 25000 });

      // full value = 25000 (no bonus); 10% cut -> floor(25000*0.9) = 22500
      expect(result).toEqual({
        amount: 25000,
        coin_amount: 22500,
        bonus_coin: 0,
      });
    });

    it('rejects when neither amount nor coin is provided', async () => {
      await expect(service.estimateCustomAmount({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when both amount and coin are provided', async () => {
      await expect(
        service.estimateCustomAmount({ amount: 25000, coin: 25000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('checkoutCustomAmount', () => {
    it('pays out 1:1 (no bonus, no cut) below the lowest published tier, creates a pending transaction, and requests a LinkQu payment link for the full nominal amount', async () => {
      transactionsService.createPendingCustomAmount.mockResolvedValue({
        id: 'TRX-20260805-0020',
      } as any);
      linkQuService.createInvoice.mockResolvedValue({
        invoiceId: '800',
        invoiceUrl: 'https://cognos.linkqu.id/pay/custom-amount-test',
        status: '00',
      });

      const result = await service.checkoutCustomAmount({
        amount: 25000,
        target_user_id: '1',
        target_zone_id: '99',
        affiliate_code: 'AFF123',
      });

      expect(
        transactionsService.createPendingCustomAmount,
      ).toHaveBeenCalledWith({
        grossAmount: '25000',
        coinAmount: '25000',
        costBasis: '25000',
        targetUserId: '1',
        targetZoneId: '99',
        referralCode: 'AFF123',
      });
      expect(linkQuService.createInvoice).toHaveBeenCalledWith({
        externalId: 'TRX-20260805-0020',
        amount: 25000,
        description: 'Top-up 25000 coin for 1',
      });
      expect(result).toEqual({
        transaction_id: 'TRX-20260805-0020',
        coin_amount: 25000,
        bonus_coin: 0,
        linkqu_reference: '800',
        invoice_url: 'https://cognos.linkqu.id/pay/custom-amount-test',
      });
    });

    it('applies the published bonus tier for a qualifying amount', async () => {
      transactionsService.createPendingCustomAmount.mockResolvedValue({
        id: 'TRX-20260805-0025',
      } as any);
      linkQuService.createInvoice.mockResolvedValue({
        invoiceId: '802',
        invoiceUrl: 'https://cognos.linkqu.id/pay/custom-amount-bonus',
        status: '00',
      });

      await service.checkoutCustomAmount({
        amount: 500000,
        target_user_id: '1',
      });

      // 500k tier -> +5,000 bonus
      expect(
        transactionsService.createPendingCustomAmount,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ coinAmount: '505000', costBasis: '505000' }),
      );
    });

    it('reads the margin rate from settings on every call, so an admin update takes effect without a redeploy', async () => {
      settingsService.get.mockResolvedValue({
        customAmountMarginRate: '20',
      } as any);
      transactionsService.createPendingCustomAmount.mockResolvedValue({
        id: 'TRX-20260805-0030',
      } as any);
      linkQuService.createInvoice.mockResolvedValue({
        invoiceId: '801',
        invoiceUrl: 'https://cognos.linkqu.id/pay/custom-amount-test-2',
        status: '00',
      });

      await service.checkoutCustomAmount({
        amount: 10000,
        target_user_id: '1',
      });

      // full value = 10000 (no bonus); 20% cut -> floor(10000*0.8) = 8000
      expect(
        transactionsService.createPendingCustomAmount,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ coinAmount: '8000', costBasis: '8000' }),
      );
    });
  });

  describe('handleInvoicePaid', () => {
    it('uses coinAmount/costBasis directly for a custom-amount transaction with no linked product', async () => {
      const transaction = {
        id: 'TRX-20260805-0021',
        paymentStatus: PaymentStatus.PENDING,
        targetUserId: '1',
        targetZoneId: '99',
        referralCode: null,
        grossAmount: '25000.00',
        product: null,
        coinAmount: '225',
        costBasis: '22500',
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );
      injectCoinMock.mockResolvedValue({
        success: true,
        response: '{"mock":true}',
      });
      linkQuService.checkTransactionStatus.mockResolvedValue({
        statusCode: 'success',
        statusMessage: 'SUCCESS',
        fee: '500.00',
      });

      await service.handleInvoicePaid('TRX-20260805-0021');

      expect(injectCoinMock).toHaveBeenCalledWith({
        productProviderCode: 'custom-amount',
        targetUserId: '1',
        targetZoneId: '99',
        coin: 225,
      });
      expect(creditRevenueMock).toHaveBeenCalledWith({
        transactionId: 'TRX-20260805-0021',
        grossAmount: '25000.00',
        baseCost: '22500',
        commissionPaid: '0.00',
        providerFee: '500.00',
      });
    });

    it('throws BadRequestException when a transaction has neither a product nor custom-amount pricing', async () => {
      const transaction = {
        id: 'TRX-20260805-0022',
        paymentStatus: PaymentStatus.PENDING,
        targetUserId: '1',
        targetZoneId: '99',
        referralCode: null,
        grossAmount: '25000.00',
        product: null,
        coinAmount: null,
        costBasis: null,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );

      await expect(
        service.handleInvoicePaid('TRX-20260805-0022'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('handleInvoicePaid (product-based)', () => {
    it('marks the transaction paid, injects coin, and credits platform revenue (no referral code, no commission credit)', async () => {
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
      linkQuService.checkTransactionStatus.mockResolvedValue({
        statusCode: 'success',
        statusMessage: 'SUCCESS',
        fee: '1000.00',
      });

      await service.handleInvoicePaid('TRX-20260805-0001');

      expect(transactionsService.markPaid).toHaveBeenCalledWith(
        'TRX-20260805-0001',
      );
      expect(injectCoinMock).toHaveBeenCalledWith({
        productProviderCode: 'ml_120',
        targetUserId: '1',
        targetZoneId: '99',
        coin: 120,
      });
      expect(transactionsService.markProviderResult).toHaveBeenCalledWith(
        'TRX-20260805-0001',
        { success: true, response: '{"mock":true}' },
      );
      expect(creditCommissionMock).not.toHaveBeenCalled();
      expect(transactionsService.setProviderFee).toHaveBeenCalledWith(
        'TRX-20260805-0001',
        '1000.00',
      );
      expect(creditRevenueMock).toHaveBeenCalledWith({
        transactionId: 'TRX-20260805-0001',
        grossAmount: '20000.00',
        baseCost: '15000',
        commissionPaid: '0.00',
        providerFee: '1000.00',
      });
    });

    it('credits platform revenue with fee=0 if the LinkQu fee lookup fails, without blocking the coin injection already recorded', async () => {
      const transaction = {
        id: 'TRX-20260805-0010',
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
      linkQuService.checkTransactionStatus.mockRejectedValue(
        new Error('LinkQu checkstatus request failed: HTTP 500'),
      );

      await service.handleInvoicePaid('TRX-20260805-0010');

      expect(transactionsService.setProviderFee).not.toHaveBeenCalled();
      expect(creditRevenueMock).toHaveBeenCalledWith({
        transactionId: 'TRX-20260805-0010',
        grossAmount: '20000.00',
        baseCost: '15000',
        commissionPaid: '0.00',
        providerFee: '0.00',
      });
    });

    it('credits commission and platform revenue when the transaction has a referral code and injection succeeded', async () => {
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
      creditCommissionMock.mockResolvedValue('2000.00');
      linkQuService.checkTransactionStatus.mockResolvedValue({
        statusCode: 'success',
        statusMessage: 'SUCCESS',
        fee: '1000.00',
      });

      await service.handleInvoicePaid('TRX-20260805-0003');

      expect(creditCommissionMock).toHaveBeenCalledWith({
        referralCode: 'AFF-ABC123',
        transactionId: 'TRX-20260805-0003',
        grossAmount: '20000.00',
      });
      expect(creditRevenueMock).toHaveBeenCalledWith({
        transactionId: 'TRX-20260805-0003',
        grossAmount: '20000.00',
        baseCost: '15000',
        commissionPaid: '2000.00',
        providerFee: '1000.00',
      });
    });

    it('does not credit commission or platform revenue when injection failed, even with a referral code', async () => {
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
      expect(creditRevenueMock).not.toHaveBeenCalled();
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
      // The real guard is the atomic conditional UPDATE, not a prior read -
      // markPaid itself reports "no row transitioned" when already paid.
      transactionsService.markPaid.mockResolvedValue(false);

      await service.handleInvoicePaid('TRX-20260805-0001');

      expect(injectCoinMock).not.toHaveBeenCalled();
    });

    it('is race-safe: two concurrent callbacks for the same pending transaction only inject coin once', async () => {
      const transaction = {
        id: 'TRX-20260805-0011',
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
      // Simulates the DB-level reality: only the first conditional UPDATE
      // actually transitions PENDING -> PAID and returns true; a
      // concurrent second call finds 0 rows matched and gets false.
      transactionsService.markPaid
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      injectCoinMock.mockResolvedValue({
        success: true,
        response: '{"mock":true}',
      });
      linkQuService.checkTransactionStatus.mockResolvedValue({
        statusCode: 'success',
        statusMessage: 'SUCCESS',
        fee: '1000.00',
      });

      await Promise.all([
        service.handleInvoicePaid('TRX-20260805-0011'),
        service.handleInvoicePaid('TRX-20260805-0011'),
      ]);

      expect(injectCoinMock).toHaveBeenCalledTimes(1);
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

  describe('handleInvoiceExpired', () => {
    it('marks a pending transaction as expired', async () => {
      const transaction = {
        id: 'TRX-20260805-0005',
        paymentStatus: PaymentStatus.PENDING,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );

      await service.handleInvoiceExpired('TRX-20260805-0005');

      expect(transactionsService.markExpired).toHaveBeenCalledWith(
        'TRX-20260805-0005',
      );
    });

    it('does not downgrade an already-paid transaction', async () => {
      const transaction = {
        id: 'TRX-20260805-0006',
        paymentStatus: PaymentStatus.PAID,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );

      await service.handleInvoiceExpired('TRX-20260805-0006');

      expect(transactionsService.markExpired).not.toHaveBeenCalled();
    });

    it('is idempotent for a transaction already marked expired', async () => {
      const transaction = {
        id: 'TRX-20260805-0007',
        paymentStatus: PaymentStatus.EXPIRED,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );

      await service.handleInvoiceExpired('TRX-20260805-0007');

      expect(transactionsService.markExpired).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the transaction does not exist', async () => {
      transactionsService.findByExternalId.mockResolvedValue(null);

      await expect(
        service.handleInvoiceExpired('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('handleInvoiceFailed', () => {
    it('marks a pending transaction as failed', async () => {
      const transaction = {
        id: 'TRX-20260805-0008',
        paymentStatus: PaymentStatus.PENDING,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );

      await service.handleInvoiceFailed('TRX-20260805-0008');

      expect(transactionsService.markFailed).toHaveBeenCalledWith(
        'TRX-20260805-0008',
      );
    });

    it('does not downgrade an already-paid transaction', async () => {
      const transaction = {
        id: 'TRX-20260805-0009',
        paymentStatus: PaymentStatus.PAID,
      };
      transactionsService.findByExternalId.mockResolvedValue(
        transaction as any,
      );

      await service.handleInvoiceFailed('TRX-20260805-0009');

      expect(transactionsService.markFailed).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the transaction does not exist', async () => {
      transactionsService.findByExternalId.mockResolvedValue(null);

      await expect(
        service.handleInvoiceFailed('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
