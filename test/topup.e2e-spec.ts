import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  Product,
  ProductStatus,
} from '../src/products/entities/product.entity';
import {
  PaymentStatus,
  ProviderStatus,
  Transaction,
} from '../src/transactions/entities/transaction.entity';
import { DuitkuService } from '../src/duitku/duitku.service';

/**
 * Exercises the full customer top-up purchase flow (check-id -> checkout ->
 * Duitku invoice callback -> mock coin injection) against a real Postgres
 * database (via TypeOrmModule, see development/backend/docker-compose.yml).
 * DuitkuService is overridden with a deterministic double because this
 * environment has no real Duitku credentials; the mock Provider Top-Up
 * service is left as the real implementation since it is already
 * deterministic and is the boundary this slice is meant to validate.
 */
const TEST_SIGNATURE = 'e2e-test-signature';

class FakeDuitkuService {
  createInvoice(params: { externalId: string }) {
    return Promise.resolve({
      invoiceId: `fake-reference-${params.externalId}`,
      invoiceUrl: `https://app-sandbox.duitku.com/checkout/fake-reference-${params.externalId}`,
      status: '00',
    });
  }

  verifyInvoiceCallbackSignature(params: {
    signature: string | undefined;
  }): boolean {
    return params.signature === TEST_SIGNATURE;
  }
}

describe('Topup (e2e)', () => {
  let app: INestApplication<App>;
  let productRepository: Repository<Product>;
  let transactionRepository: Repository<Transaction>;
  let testProduct: Product;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DuitkuService)
      .useClass(FakeDuitkuService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    productRepository = moduleFixture.get(getRepositoryToken(Product));
    transactionRepository = moduleFixture.get(getRepositoryToken(Transaction));

    await transactionRepository.query(
      'TRUNCATE TABLE transactions, platform_withdrawals, platform_revenue_logs, platform_settings, products RESTART IDENTITY CASCADE',
    );

    testProduct = await productRepository.save(
      productRepository.create({
        name: '120 Diamonds (e2e)',
        providerCode: 'ml_120_e2e',
        basePrice: '15000',
        sellingPrice: '20000',
        coinAmount: '120',
        status: ProductStatus.ACTIVE,
      }),
    );
  });

  afterAll(async () => {
    await transactionRepository.query(
      'TRUNCATE TABLE transactions, platform_withdrawals, platform_revenue_logs, platform_settings, products RESTART IDENTITY CASCADE',
    );
    await app.close();
  });

  it('validates the target id via check-id', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/topup/check-id')
      .send({
        game_code: 'mobile_legends',
        user_id: '12345678',
        zone_id: '1234',
      })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      data: {
        username: 'Player_12345678#1234',
        avatar_url: null,
        user_id: '12345678',
        zone_id: '1234',
      },
    });
  });

  it('lists active products publicly, without exposing cost price', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/topup/products')
      .expect(200);

    const body = response.body as {
      success: boolean;
      data: {
        id: string;
        name: string;
        selling_price: string;
        coin_amount: string;
        bonus_coin: string;
        flag: string | null;
      }[];
    };
    expect(body.success).toBe(true);
    const listed = body.data.find((p) => p.id === testProduct.id);
    expect(listed).toEqual({
      id: testProduct.id,
      name: '120 Diamonds (e2e)',
      selling_price: '20000.00',
      coin_amount: '120.00',
      bonus_coin: '0.00',
      flag: null,
    });
    expect(listed).not.toHaveProperty('base_price');
    expect(listed).not.toHaveProperty('basePrice');
  });

  it('returns 404 for an unknown transaction status lookup', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/topup/transactions/TRX-doesnotexist')
      .expect(404);
  });

  it('rejects checkout for an unknown product', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/topup/checkout')
      .send({ product_id: '999999', target_user_id: '12345678' })
      .expect(404);
  });

  it('runs the full checkout -> Duitku callback -> coin injection path', async () => {
    const checkoutResponse = await request(app.getHttpServer())
      .post('/api/v1/topup/checkout')
      .send({
        product_id: testProduct.id,
        target_user_id: '12345678',
        target_zone_id: '1234',
      })
      .expect(201);

    const body = checkoutResponse.body as {
      success: boolean;
      data: {
        transaction_id: string;
        duitku_reference: string;
        invoice_url: string;
      };
    };
    const { transaction_id, duitku_reference, invoice_url } = body.data;
    expect(transaction_id).toMatch(/^TRX-\d{8}-\d{4}$/);
    expect(duitku_reference).toBe(`fake-reference-${transaction_id}`);
    expect(invoice_url).toContain(transaction_id);

    const pendingTransaction = await transactionRepository.findOne({
      where: { id: transaction_id },
    });
    expect(pendingTransaction?.paymentStatus).toBe(PaymentStatus.PENDING);

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/duitku/invoice')
      .type('form')
      .send({
        merchantOrderId: transaction_id,
        amount: '20000',
        resultCode: '00',
        reference: duitku_reference,
        signature: TEST_SIGNATURE,
      })
      .expect(200)
      .expect({ success: true });

    const paidTransaction = await transactionRepository.findOne({
      where: { id: transaction_id },
    });
    expect(paidTransaction?.paymentStatus).toBe(PaymentStatus.PAID);
    expect(paidTransaction?.providerStatus).toBe(ProviderStatus.SUCCESS);
    expect(paidTransaction?.paidAt).not.toBeNull();
    expect(paidTransaction?.completedAt).not.toBeNull();

    const statusResponse = await request(app.getHttpServer())
      .get(`/api/v1/topup/transactions/${transaction_id}`)
      .expect(200);
    const statusBody = statusResponse.body as {
      success: boolean;
      data: {
        transaction_id: string;
        payment_status: string;
        provider_status: string;
        product_name: string;
      };
    };
    expect(statusBody.data).toEqual(
      expect.objectContaining({
        transaction_id,
        payment_status: PaymentStatus.PAID,
        provider_status: ProviderStatus.SUCCESS,
        product_name: '120 Diamonds (e2e)',
      }),
    );
  });

  it('marks a transaction failed on a non-success Duitku callback resultCode', async () => {
    const checkoutResponse = await request(app.getHttpServer())
      .post('/api/v1/topup/checkout')
      .send({
        product_id: testProduct.id,
        target_user_id: '11223344',
        target_zone_id: '5566',
      })
      .expect(201);

    const body = checkoutResponse.body as {
      data: { transaction_id: string; duitku_reference: string };
    };
    const { transaction_id, duitku_reference } = body.data;

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/duitku/invoice')
      .type('form')
      .send({
        merchantOrderId: transaction_id,
        amount: '20000',
        resultCode: '01',
        reference: duitku_reference,
        signature: TEST_SIGNATURE,
      })
      .expect(200)
      .expect({ success: true });

    const failedTransaction = await transactionRepository.findOne({
      where: { id: transaction_id },
    });
    expect(failedTransaction?.paymentStatus).toBe(PaymentStatus.FAILED);
  });

  it('rejects a Duitku callback with an invalid signature', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/duitku/invoice')
      .type('form')
      .send({
        merchantOrderId: 'TRX-doesnotmatter',
        amount: '20000',
        resultCode: '00',
        signature: 'wrong-signature',
      })
      .expect(401);
  });
});
