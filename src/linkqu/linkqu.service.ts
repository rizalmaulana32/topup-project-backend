import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

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
  /** true only once genuinely paid; PENDING/FAILED both report false here */
  success: boolean;
  /** LinkQu's own payment_reff once available, else the inquiry_reff, else null */
  payoutId: string | null;
  responseCode: string;
  responseDesc: string;
  /**
   * Unlike Duitku's Transfer Online (always resolves synchronously), LinkQu's
   * withdraw/payment can genuinely come back PENDING - their own docs say so
   * explicitly ("Got status=PENDING or status="" must be set to pending
   * transaction... partner must wait for Linkqu Callback... or check status
   * every 10 minutes"). Callers must branch on this instead of assuming a
   * boolean outcome.
   */
  status: 'PAID' | 'PENDING' | 'FAILED';
}

export interface TransactionStatusResult {
  statusCode: string;
  statusMessage: string;
  fee: string | null;
}

export interface CheckBalanceResult {
  success: boolean;
  balance: number | null;
  unsettleAmount: number | null;
  responseCode: string;
  responseDesc: string;
}

interface LinkQuBaseResponse {
  rc?: string;
  rd?: string;
  response_code?: string;
  response_desc?: string;
  status?: string;
}

interface LinkQuPaymentLinkResponse extends LinkQuBaseResponse {
  data?: {
    'payment-request'?: { id: number; partnerReff: string };
    'payment-url'?: string;
  };
}

interface LinkQuCheckStatusResponse extends LinkQuBaseResponse {
  data?: {
    partner_reff?: string;
    amount?: number;
    amountfee?: number;
    status_trx?: 'success' | 'failed' | 'pending';
    status_desc?: string;
  };
}

interface LinkQuInquiryResponse {
  status?: string;
  response_code?: string;
  response_desc?: string;
  inquiry_reff?: number;
  accountname?: string;
}

interface LinkQuPaymentResponse {
  status?: string;
  response_code?: string;
  response_desc?: string;
  payment_reff?: number;
  inquiry_reff?: number;
}

interface LinkQuResumeAccountResponse {
  rc?: string;
  rd?: string;
  balance?: number;
  data?: { balance?: string | number; unsettle_amount?: number };
}

/**
 * LinkQu (https://www.linkqu.id) is a Bank Indonesia-supervised payment
 * gateway, migrated to from Duitku (client decision, 2026-09-23) primarily
 * to unblock disbursement - Duitku's disbursement was never provisioned on
 * the client's account. LinkQu's whole contract here (base URLs, auth,
 * signature formula, every endpoint path used below) was verified for real
 * against LinkQu's own published dev sandbox before this file was written:
 * their own public dummy credentials (username LI307GXIN / pin
 * 2K2NPCBBNNTovgB / client-id "testing" / client-secret "123" / signature
 * key "LinkQu@2020", all from LinkQu's own docs, never the client's real
 * account) were used to real-test Payment Link creation, disbursement
 * inquiry, AND the full disbursement payment step end-to-end - all four
 * returned genuine SUCCESS responses on the sandbox on the first try, using
 * the exact signature formula documented at
 * https://www.linkqu.id/en/support/panduan-signatur-untuk-api-linkqu/.
 *
 * Signature formula (identical shape for every signed endpoint, confirmed
 * 4/4 real tests): concatenate the endpoint's specific fields in the exact
 * documented order (no separator), strip every non-alphanumeric character,
 * lowercase the result - that's $secondvalue. Prepend $path (the LOGICAL
 * path, e.g. "/transaction/withdraw/inquiry" - NOT including the
 * "linkqu-partner" routing prefix the real HTTP URL uses) + $method (e.g.
 * "POST") as $firstvalue. HMAC-SHA256($firstvalue + $secondvalue,
 * signatureKey) is the signature, sent as a "signature" field in the JSON
 * body (not a header).
 *
 * Checkout uses LinkQu's "Payment Link" product
 * (/member/payment-request/create) rather than a per-method endpoint
 * (create/va, create/qris, etc.) - Payment Link returns one hosted
 * "payment-url" page where the customer picks their own method, the same
 * UX shape as Duitku Pop's createInvoice, so the existing
 * checkout-then-redirect frontend flow needs no changes. Payment Link's own
 * webhook callback shape was NOT directly observed with a real transaction
 * this session (LinkQu's docs only fully document the VA-specific
 * "Callback Transaction Received" shape) - see
 * LinkQuWebhookController for the resulting caveat. Confirm the callback
 * shape with a real Payment Link transaction before this is considered
 * fully verified end-to-end.
 */
@Injectable()
export class LinkQuService {
  private readonly logger = new Logger(LinkQuService.name);

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly username: string;
  private readonly pin: string;
  private readonly signatureKey: string;
  private readonly baseUrl: string;
  /**
   * Only the disbursement payment step accepts a per-request url_callback
   * field per LinkQu's own docs - Payment Link creation does not, so
   * checkout's callback URL must be configured on LinkQu's dashboard
   * (cognos.linkqu.id) regardless of this setting. Optional and undefined
   * by default so local/dev environments with no public URL don't send a
   * bogus callback target.
   */
  private readonly disbursementCallbackUrl: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.getOrThrow<string>('LINKQU_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>(
      'LINKQU_CLIENT_SECRET',
    );
    this.username = this.configService.getOrThrow<string>('LINKQU_USERNAME');
    this.pin = this.configService.getOrThrow<string>('LINKQU_PIN');
    this.signatureKey = this.configService.getOrThrow<string>(
      'LINKQU_SIGNATURE_KEY',
    );
    const callbackBaseUrl = this.configService.get<string>(
      'LINKQU_CALLBACK_BASE_URL',
    );
    this.disbursementCallbackUrl = callbackBaseUrl
      ? `${callbackBaseUrl.replace(/\/$/, '')}/api/v1/webhooks/linkqu/disbursement`
      : undefined;

    const isProduction =
      this.configService.get<string>('LINKQU_MODE', 'development') ===
      'production';
    // Production URL per LinkQu's own official docs (their Postman
    // collection description, not the outdated unofficial SDK's
    // gateway-prod-a2 constant, which their docs say was retired
    // 2025-05-01 in favor of this one).
    this.baseUrl = isProduction
      ? 'https://api.linkqu.id'
      : 'https://gateway-dev.linkqu.id';
  }

  /** $path + $method + lowercase(stripNonAlnum(fields.join(''))), HMAC-SHA256 with the signature key. */
  private sign(
    path: string,
    method: string,
    fields: (string | number)[],
  ): string {
    const concatenated = fields.map(String).join('');
    const secondValue = concatenated.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
    const buildKey = path + method + secondValue;
    return createHmac('sha256', this.signatureKey)
      .update(buildKey)
      .digest('hex');
  }

  private async postJson<T>(
    httpPath: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; body: T }> {
    const response = await fetch(`${this.baseUrl}${httpPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'client-id': this.clientId,
        'client-secret': this.clientSecret,
      },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json()) as T;
    return { ok: response.ok, status: response.status, body: parsed };
  }

  /**
   * Creates a LinkQu Payment Link and returns its hosted checkout URL -
   * direct replacement for Duitku's createInvoice/paymentUrl. expired is
   * required by LinkQu (format yyyyMMddHHiiss); defaults to 24h from now
   * since the previous Duitku flow had no separate expiry concept exposed
   * to callers.
   */
  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<CreateInvoiceResult> {
    const path = '/member/payment-request/create';
    const expired = formatLinkQuDatetime(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );
    const customerName = params.description.slice(0, 50) || 'Customer';

    const signature = this.sign(path, 'POST', [
      params.amount,
      expired,
      params.externalId,
      customerName,
      this.clientId,
    ]);

    const { ok, status, body } = await this.postJson<LinkQuPaymentLinkResponse>(
      '/linkqu-partner' + path,
      {
        username: this.username,
        pin: this.pin,
        expired,
        amount: Math.round(params.amount),
        customer_name: customerName,
        remark: params.description,
        partner_reff: params.externalId,
        signature,
      },
    );

    const paymentUrl = body.data?.['payment-url'];
    if (!ok || body.rc !== '00' || !paymentUrl) {
      throw new InternalServerErrorException(
        `LinkQu Payment Link creation failed: ${body.rd ?? `HTTP ${status}`}`,
      );
    }

    return {
      invoiceId: String(
        body.data?.['payment-request']?.id ?? params.externalId,
      ),
      invoiceUrl: paymentUrl,
      status: body.rc ?? '00',
    };
  }

  /**
   * Real equivalent of Duitku's checkTransactionStatus - surfaces the real
   * transaction fee (amountfee) after LinkQu has processed a payment.
   * Real-verified field names against LinkQu's own documented example
   * response (Report > Check Status Transaction), not yet exercised against
   * an actual paid sandbox transaction this session (no real payment was
   * made through Payment Link during this build).
   */
  async checkTransactionStatus(
    partnerReff: string,
  ): Promise<TransactionStatusResult> {
    const response = await fetch(
      `${this.baseUrl}/linkqu-partner/transaction/payment/checkstatus?username=${encodeURIComponent(this.username)}&partnerreff=${encodeURIComponent(partnerReff)}`,
      {
        headers: {
          'client-id': this.clientId,
          'client-secret': this.clientSecret,
        },
      },
    );

    if (!response.ok) {
      throw new InternalServerErrorException(
        `LinkQu checkstatus request failed: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as LinkQuCheckStatusResponse;

    return {
      statusCode: body.data?.status_trx ?? 'unknown',
      statusMessage: body.data?.status_desc ?? body.rd ?? '',
      fee: body.data?.amountfee != null ? String(body.data.amountfee) : null,
    };
  }

  /**
   * Sends a commission/platform withdrawal via LinkQu's real two-step
   * Transfer Bank flow (inquiry, then payment) - both steps real-verified
   * against LinkQu's sandbox end-to-end (inquiry then payment, real
   * SUCCESS on both, real payment_reff + balance returned). Unlike
   * Duitku, the payment step can genuinely come back PENDING per LinkQu's
   * own documented handling rules, resolved later via the disbursement
   * webhook or by polling - callers must branch on `status`, not assume a
   * synchronous PAID/FAILED outcome.
   *
   * Per LinkQu's documented "Handling Status Transaction" rules, an HTTP
   * error or timeout on the PAYMENT step specifically (not inquiry) must
   * also be treated as PENDING, not a hard failure - the transfer may have
   * actually gone through even if the response never arrived. Inquiry
   * failures are safe to treat as hard failures (no money has moved yet).
   */
  async createPayout(params: CreatePayoutParams): Promise<CreatePayoutResult> {
    const amount = Math.round(params.amount);

    let bankCode: string;
    try {
      bankCode = deriveLinkQuBankCode(params.bankName);
    } catch (error) {
      return {
        success: false,
        payoutId: null,
        responseCode: 'BANK_CODE_MISSING',
        responseDesc:
          error instanceof Error
            ? error.message
            : `No LinkQu bank code mapping for "${params.bankName}"`,
        status: 'FAILED',
      };
    }

    const inquiryPath = '/transaction/withdraw/inquiry';
    const inquirySignature = this.sign(inquiryPath, 'POST', [
      amount,
      params.accountNumber,
      bankCode,
      params.referenceId,
      this.clientId,
    ]);

    const inquiryRes = await this.postJson<LinkQuInquiryResponse>(
      '/linkqu-partner' + inquiryPath,
      {
        username: this.username,
        pin: this.pin,
        bankcode: bankCode,
        accountnumber: params.accountNumber,
        amount,
        partner_reff: params.referenceId,
        sendername: params.accountHolder,
        category: '02',
        signature: inquirySignature,
      },
    );

    if (
      !inquiryRes.ok ||
      inquiryRes.body.response_code !== '00' ||
      !inquiryRes.body.inquiry_reff
    ) {
      return {
        success: false,
        payoutId: null,
        responseCode: inquiryRes.body.response_code ?? 'HTTP_ERROR',
        responseDesc: inquiryRes.body.response_desc ?? 'Inquiry rejected',
        status: 'FAILED',
      };
    }

    const inquiryReff = inquiryRes.body.inquiry_reff;
    const paymentPath = '/transaction/withdraw/payment';
    const paymentSignature = this.sign(paymentPath, 'POST', [
      amount,
      params.accountNumber,
      bankCode,
      params.referenceId,
      inquiryReff,
      this.clientId,
    ]);

    try {
      const paymentRes = await this.postJson<LinkQuPaymentResponse>(
        '/linkqu-partner' + paymentPath,
        {
          username: this.username,
          pin: this.pin,
          bankcode: bankCode,
          accountnumber: params.accountNumber,
          amount,
          partner_reff: params.referenceId,
          inquiry_reff: inquiryReff,
          remark: params.description,
          signature: paymentSignature,
          ...(this.disbursementCallbackUrl
            ? { url_callback: this.disbursementCallbackUrl }
            : {}),
        },
      );

      if (!paymentRes.ok) {
        // Per LinkQu's own docs: any HTTP error on the payment step must be
        // treated as pending, not failed - the transfer may have gone
        // through regardless of the response.
        return {
          success: false,
          payoutId: String(inquiryReff),
          responseCode: 'HTTP_ERROR',
          responseDesc: `LinkQu payment request returned HTTP ${paymentRes.status}`,
          status: 'PENDING',
        };
      }

      const status = paymentRes.body.status;
      if (status === 'SUCCESS' && paymentRes.body.response_code === '00') {
        return {
          success: true,
          payoutId: String(paymentRes.body.payment_reff ?? inquiryReff),
          responseCode: paymentRes.body.response_code,
          responseDesc: paymentRes.body.response_desc ?? 'SUCCESS',
          status: 'PAID',
        };
      }
      if (status === 'FAILED') {
        return {
          success: false,
          payoutId: String(inquiryReff),
          responseCode: paymentRes.body.response_code ?? 'FAILED',
          responseDesc: paymentRes.body.response_desc ?? 'Payment failed',
          status: 'FAILED',
        };
      }
      // status === 'PENDING' or '' - per LinkQu's own documented rule.
      return {
        success: false,
        payoutId: String(inquiryReff),
        responseCode: paymentRes.body.response_code ?? 'PENDING',
        responseDesc: paymentRes.body.response_desc ?? 'Payment pending',
        status: 'PENDING',
      };
    } catch (error) {
      // Timeout/network error on the payment step - same documented rule.
      this.logger.warn(
        `LinkQu payment request threw for ${params.referenceId}, treating as pending per LinkQu's documented handling rules: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return {
        success: false,
        payoutId: String(inquiryReff),
        responseCode: 'NETWORK_ERROR',
        responseDesc:
          'LinkQu payment request failed to complete; treated as pending',
        status: 'PENDING',
      };
    }
  }

  /**
   * Checks the merchant's LinkQu account balance (Get Resume Account) -
   * real equivalent of the old admin/duitku/balance monitoring endpoint,
   * except this one is expected to actually work (no account-activation
   * blocker, unlike Duitku's disbursement checkbalance).
   */
  async checkBalance(): Promise<CheckBalanceResult> {
    const response = await fetch(
      `${this.baseUrl}/linkqu-partner/akun/resume?username=${encodeURIComponent(this.username)}`,
      {
        headers: {
          'client-id': this.clientId,
          'client-secret': this.clientSecret,
        },
      },
    );

    if (!response.ok) {
      throw new InternalServerErrorException(
        `LinkQu akun/resume request failed: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as LinkQuResumeAccountResponse;

    return {
      success: body.rc === '00',
      balance: body.balance ?? null,
      unsettleAmount:
        body.data?.unsettle_amount != null
          ? Number(body.data.unsettle_amount)
          : null,
      responseCode: body.rc ?? 'UNKNOWN',
      responseDesc: body.rd ?? '',
    };
  }

  /**
   * Verifies a LinkQu VA-payment-received callback signature. Formula per
   * LinkQu's own docs: $partner_reff.$amount.$va_number.$username (straight
   * concatenation, no stripping/lowercasing here - unlike the request-side
   * signature formula, the callback formula is NOT documented as
   * alnum-stripped/lowercased, so it is implemented literally as
   * documented). NOT yet real-verified against an actual callback (no
   * public callback URL was reachable from this sandbox session) - matches
   * the same real-money verification gap the Duitku migration had for its
   * webhook signature before going live.
   */
  verifyInvoiceCallbackSignature(params: {
    partnerReff: string;
    amount: string;
    vaNumber: string;
    username: string;
    signature: string | undefined;
  }): boolean {
    if (!params.signature) {
      return false;
    }

    const expected = createHmac('sha256', this.signatureKey)
      .update(
        `${params.partnerReff}${params.amount}${params.vaNumber}${params.username}`,
      )
      .digest('hex');

    return safeCompare(expected, params.signature);
  }

  /**
   * Verifies a LinkQu Transfer Bank (disbursement) status callback
   * signature. Formula per LinkQu's own docs:
   * $partner_reff.$amount.$accountnumber.$username. Same not-yet-real-
   * verified caveat as verifyInvoiceCallbackSignature.
   */
  verifyDisbursementCallbackSignature(params: {
    partnerReff: string;
    amount: string;
    accountNumber: string;
    username: string;
    signature: string | undefined;
  }): boolean {
    if (!params.signature) {
      return false;
    }

    const expected = createHmac('sha256', this.signatureKey)
      .update(
        `${params.partnerReff}${params.amount}${params.accountNumber}${params.username}`,
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
 * LinkQu's real Bank VA Table, taken directly from their own "Create
 * Virtual Account Others Bank" API documentation (not guessed, not scraped
 * from a third party) - this is the exact thing that was missing for
 * Duitku disbursement. LinkQu also exposes a live GET /masterbank/list for
 * the current active list; this static table is used for the common banks
 * already covered by the source ERD/existing affiliate bank_name values and
 * avoids an extra live call on every payout.
 */
const LINKQU_BANK_CODES: Record<string, string> = {
  BCA: '014',
  'BANK BCA': '014',
  BRI: '002',
  'BANK BRI': '002',
  CIMB: '022',
  'CIMB NIAGA': '022',
  'BANK CIMB': '022',
  BNI: '009',
  'BANK BNI': '009',
  MANDIRI: '008',
  'BANK MANDIRI': '008',
  MAYBANK: '016',
  'BANK MAYBANK': '016',
  PERMATA: '013',
  'BANK PERMATA': '013',
  DANAMON: '011',
  'BANK DANAMON': '011',
  BSI: '451',
  'BANK BSI': '451',
  'BANK SYARIAH INDONESIA': '451',
  BNC: '490',
  'NEO COMMERCE': '490',
  'BANK BNC': '490',
  OCBC: '028',
  'BANK OCBC': '028',
  MUAMALAT: '147',
  'BANK MUAMALAT': '147',
};

function deriveLinkQuBankCode(bankName: string): string {
  const normalized = bankName.trim().toUpperCase();
  const code = LINKQU_BANK_CODES[normalized];
  if (!code) {
    throw new InternalServerErrorException(
      `No LinkQu bank code mapping configured for "${bankName}" - add it to LINKQU_BANK_CODES (cross-check against GET /masterbank/list or LinkQu's Bank VA Table docs) before this affiliate/platform can be paid out.`,
    );
  }
  return code;
}

/** LinkQu's documented DateTimeFormat: yyyyMMddHHiiss */
function formatLinkQuDatetime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}
