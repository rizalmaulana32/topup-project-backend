import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

export interface CreateInvoiceParams {
  externalId: string;
  amount: number;
  description: string;
  payerEmail?: string;
}

export interface CreateInvoiceResult {
  invoiceId: string;
  invoiceUrl: string;
  status: string;
}

export interface CreatePayoutParams {
  referenceId: string;
  amount: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  description: string;
}

export interface CreatePayoutResult {
  payoutId: string;
  status: string;
}

interface DuitkuCreateInvoiceResponse {
  merchantCode: string;
  reference: string;
  paymentUrl: string;
  statusCode: string;
  statusMessage: string;
}

interface DuitkuDisbursementResponse {
  disburseId?: string;
  reference?: string;
  statusCode: string;
  statusDesc?: string;
  statusMessage?: string;
}

/**
 * Duitku Pop ("createInvoice") is the hosted-checkout-page product — the
 * closest equivalent to Xendit's Invoice API (customer picks a payment
 * method on a Duitku-hosted page after redirect, rather than the merchant
 * choosing a channel upfront like Duitku's plain V2 API requires).
 *
 * Reference: https://docs.duitku.com/pop/en/ (payment) and
 * https://docs.duitku.com/disbursement/en/ (payout). Duitku's own docs site
 * blocks automated fetches, so these were confirmed via a read-only proxy
 * and Duitku's official Laravel library rather than the primary source —
 * worth re-verifying field-for-field against the real merchant dashboard
 * docs once real credentials exist, especially the disbursement flow,
 * which is documented less consistently than the payment gateway.
 */
@Injectable()
export class DuitkuService {
  private readonly merchantCode: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly disbursementBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.merchantCode = this.configService.getOrThrow<string>(
      'DUITKU_MERCHANT_CODE',
    );
    this.apiKey = this.configService.getOrThrow<string>('DUITKU_API_KEY');

    const isProduction =
      this.configService.get<string>('DUITKU_ENV', 'sandbox') === 'production';
    this.baseUrl = isProduction
      ? 'https://api-prod.duitku.com/api/merchant'
      : 'https://api-sandbox.duitku.com/api/merchant';
    this.disbursementBaseUrl = isProduction
      ? 'https://passport.duitku.com/webapi/api/disbursement'
      : 'https://sandbox.duitku.com/webapi/api/disbursement';
  }

  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<CreateInvoiceResult> {
    const timestamp = Date.now();
    const signature = createHmac('sha256', this.apiKey)
      .update(`${this.merchantCode}${timestamp}`)
      .digest('hex');

    const response = await fetch(`${this.baseUrl}/createInvoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-duitku-timestamp': String(timestamp),
        'x-duitku-signature': signature,
        'x-duitku-merchantcode': this.merchantCode,
      },
      body: JSON.stringify({
        paymentAmount: Math.round(params.amount),
        merchantOrderId: params.externalId,
        productDetails: params.description,
        email: params.payerEmail ?? 'customer@example.com',
        callbackUrl: this.configService.getOrThrow<string>(
          'DUITKU_CALLBACK_URL',
        ),
        returnUrl: this.configService.getOrThrow<string>('DUITKU_RETURN_URL'),
      }),
    });

    const body = (await response.json()) as DuitkuCreateInvoiceResponse;

    if (!response.ok || body.statusCode !== '00') {
      throw new InternalServerErrorException(
        `Duitku createInvoice failed: ${body.statusMessage ?? response.statusText}`,
      );
    }

    return {
      invoiceId: body.reference,
      invoiceUrl: body.paymentUrl,
      status: body.statusCode,
    };
  }

  /**
   * Verifies a Duitku invoice callback's signature. Duitku sends the
   * callback as application/x-www-form-urlencoded (not JSON like Xendit),
   * and instead of a static token, it's an HMAC-SHA256 computed over
   * merchantCode + amount + merchantOrderId using the API key.
   */
  verifyInvoiceCallbackSignature(params: {
    merchantOrderId: string;
    amount: string;
    signature: string | undefined;
  }): boolean {
    if (!params.signature) {
      return false;
    }

    const expected = createHmac('sha256', this.apiKey)
      .update(`${this.merchantCode}${params.amount}${params.merchantOrderId}`)
      .digest('hex');

    return safeCompare(expected, params.signature);
  }

  /**
   * Sends a commission withdrawal via Duitku's Disbursement API (Transfer
   * Online). Requires the disbursement feature to be activated on the
   * Duitku merchant account — unlike invoice creation, this has not been
   * exercised against a real account and should be treated as unverified
   * until it has been.
   */
  async createPayout(params: CreatePayoutParams): Promise<CreatePayoutResult> {
    const timestamp = Date.now();
    const amount = Math.round(params.amount);
    const signature = createHash('sha256')
      .update(
        `${this.merchantCode}${amount}${params.referenceId}${this.apiKey}`,
      )
      .digest('hex');

    const response = await fetch(`${this.disbursementBaseUrl}/inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode: this.merchantCode,
        custRefNumber: params.referenceId,
        bankAccount: params.accountNumber,
        bankCode: deriveDuitkuBankCode(params.bankName),
        amountTransfer: amount,
        senderName: params.accountHolder,
        purpose: params.description,
        timestamp,
        signature,
      }),
    });

    const body = (await response.json()) as DuitkuDisbursementResponse;

    if (!response.ok || body.statusCode !== '00') {
      throw new InternalServerErrorException(
        `Duitku disbursement failed: ${body.statusDesc ?? body.statusMessage ?? response.statusText}`,
      );
    }

    return {
      payoutId: body.disburseId ?? body.reference ?? params.referenceId,
      status: body.statusCode,
    };
  }

  /**
   * Verifies a Duitku disbursement callback. The exact signature formula
   * for disbursement callbacks specifically (as opposed to the create-payout
   * request) was not clearly documented in what's available without a real
   * account — this mirrors the create-payout signature scheme as a
   * best-effort default. Re-verify against the real merchant dashboard
   * once disbursement is activated.
   */
  verifyDisbursementCallbackSignature(params: {
    referenceId: string;
    amount: string;
    signature: string | undefined;
  }): boolean {
    if (!params.signature) {
      return false;
    }

    const expected = createHash('sha256')
      .update(
        `${this.merchantCode}${params.amount}${params.referenceId}${this.apiKey}`,
      )
      .digest('hex');

    return safeCompare(expected, params.signature);
  }
}

function safeCompare(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Duitku identifies destination banks by its own numeric/alpha bank codes
 * (e.g. from its ~140-bank list), not the free-text bank_name affiliates
 * enter at registration - unlike Xendit's ID_<BANK_NAME> convention, there
 * is no simple derivable pattern here. This placeholder needs a real
 * bank-name -> Duitku bank-code lookup table before disbursement can work;
 * flagged clearly rather than guessed at.
 */
function deriveDuitkuBankCode(bankName: string): string {
  throw new InternalServerErrorException(
    `No Duitku bank code mapping configured for "${bankName}" - Duitku uses its own bank code list (unlike Xendit's derivable ID_<BANK> convention), which needs to be sourced from Duitku's real getBankList/documentation and mapped explicitly before disbursement can work.`,
  );
}
