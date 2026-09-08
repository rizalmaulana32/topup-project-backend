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
  success: boolean;
  payoutId: string | null;
  responseCode: string;
  responseDesc: string;
}

interface DuitkuCreateInvoiceResponse {
  merchantCode: string;
  reference: string;
  paymentUrl: string;
  statusCode: string;
  statusMessage: string;
}

interface DuitkuTransactionStatusResponse {
  merchantOrderId: string;
  reference?: string;
  amount?: string;
  fee?: string;
  statusCode: string;
  statusMessage: string;
}

export interface TransactionStatusResult {
  statusCode: string;
  statusMessage: string;
  fee: string | null;
}

interface DuitkuPaymentMethodResponse {
  paymentFee: {
    paymentMethod: string;
    paymentName: string;
    paymentImage: string;
    totalFee: string;
  }[];
  responseCode: string;
  responseMessage: string;
}

export interface PaymentMethodFee {
  paymentMethod: string;
  paymentName: string;
  paymentImage: string;
  totalFee: string;
}

interface DuitkuInquiryResponse {
  accountName?: string;
  custRefNumber?: string;
  disburseId?: string;
  responseCode: string;
  responseDesc?: string;
}

interface DuitkuTransferResponse {
  responseCode: string;
  responseDesc?: string;
}

interface DuitkuCheckBalanceResponse {
  balance?: number;
  effectiveBalance?: number;
  responseCode: string;
  responseDesc?: string;
}

export interface CheckBalanceResult {
  success: boolean;
  balance: number | null;
  effectiveBalance: number | null;
  responseCode: string;
  responseDesc: string;
}

/**
 * Duitku Pop ("createInvoice") is the hosted-checkout-page product — the
 * closest equivalent to Xendit's Invoice API (customer picks a payment
 * method on a Duitku-hosted page after redirect, rather than the merchant
 * choosing a channel upfront like Duitku's plain V2 API requires).
 *
 * createInvoice is real-verified: called against the real sandbox API with
 * real merchant credentials on 2026-08-26 and got back a genuine HTTP 200,
 * statusCode "00", a real reference and paymentUrl — every field name and
 * the signature formula matched on the first try.
 *
 * Disbursement (Transfer Online) is a real two-step flow per Duitku's docs
 * (via a read-only proxy — their docs site blocks automated fetches
 * directly): POST /inquiry validates the destination account and returns a
 * disburseId + accountName, then a *separate* POST /transfer (needing that
 * disburseId/accountName, plus a merchant userId + email inquiry doesn't
 * need) actually moves the funds — each step has its own signature
 * formula, and unlike Xendit's Payout, Transfer Online has NO callback at
 * all (only a different product, "Clearing", does) — the transfer
 * response IS the final result, which is why createPayout resolves
 * synchronously rather than returning something to wait on.
 *
 * As of 2026-08-26 this account's disbursement feature is not yet
 * provisioned: both /inquiry and /transfer return the identical
 * `{responseCode: "-120", responseDesc: "User not found"}` regardless of
 * what's sent — confirmed with a deliberately invalid signature that
 * still got the same response instead of a signature error, meaning the
 * request never reaches per-field validation. This is consistent with the
 * dashboard's "Akun Duitku Anda belum aktif" banner. Nothing about the
 * transfer step (field names, userId/email requirement, signature order)
 * can be verified further until disbursement is actually activated on a
 * real account.
 */
@Injectable()
export class DuitkuService {
  private readonly merchantCode: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly disbursementInquiryUrl: string;
  private readonly disbursementTransferUrl: string;
  private readonly disbursementCheckBalanceUrl: string;
  private readonly paymentMethodUrl: string;

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

    // Inquiry uses the same path in both environments (confirmed by a real
    // sandbox call); transfer has a distinct sandbox-only path suffix per
    // Duitku's docs - the two steps are not symmetric.
    this.disbursementInquiryUrl = isProduction
      ? 'https://passport.duitku.com/webapi/api/disbursement/inquiry'
      : 'https://sandbox.duitku.com/webapi/api/disbursement/inquiry';
    this.disbursementTransferUrl = isProduction
      ? 'https://passport.duitku.com/webapi/api/disbursement/transfer'
      : 'https://sandbox.duitku.com/webapi/api/disbursement/transfersandbox';
    // Production path is unverified (mirrors inquiry's prod/sandbox host
    // split, since checkbalance and inquiry share the same host in
    // sandbox) - only the sandbox call has actually been tested.
    this.disbursementCheckBalanceUrl = isProduction
      ? 'https://passport.duitku.com/webapi/api/disbursement/checkbalance'
      : 'https://sandbox.duitku.com/webapi/api/disbursement/checkbalance';
    // Same "webapi" host family as disbursement, not the createInvoice
    // host - confirmed for real against the sandbox on 2026-08-31.
    this.paymentMethodUrl = isProduction
      ? 'https://passport.duitku.com/webapi/api/merchant/paymentmethod/getpaymentmethod'
      : 'https://sandbox.duitku.com/webapi/api/merchant/paymentmethod/getpaymentmethod';
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
   * Checks a transaction's real-time status directly with Duitku, mainly
   * to surface `fee` (Duitku's own transaction fee, e.g. a flat VA fee) -
   * something createInvoice's response never includes and only becomes
   * known once Duitku has actually processed the payment. Real-verified
   * against the sandbox on 2026-08-31 against a real paid transaction:
   * returned a genuine fee ("5000.00" on a 10000 transaction). Per
   * Duitku's official PHP SDK (duitku-php's Pop::transactionStatus, not
   * the createInvoice signature scheme): MD5, not SHA256, over
   * merchantCode + merchantOrderId + apiKey.
   */
  async checkTransactionStatus(
    merchantOrderId: string,
  ): Promise<TransactionStatusResult> {
    const signature = createHash('md5')
      .update(`${this.merchantCode}${merchantOrderId}${this.apiKey}`)
      .digest('hex');

    const response = await fetch(`${this.baseUrl}/transactionStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode: this.merchantCode,
        merchantOrderId,
        signature,
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Duitku transactionStatus request failed: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as DuitkuTransactionStatusResponse;

    return {
      statusCode: body.statusCode,
      statusMessage: body.statusMessage,
      fee: body.fee ?? null,
    };
  }

  /**
   * Lists every payment method available for a given amount, each with its
   * own fee - the actual answer to "what's the admin fee" *before*
   * checkout, since it varies per channel (VA vs QRIS vs e-wallet) and
   * checkTransactionStatus only knows the fee after a payment already
   * happened. Real-verified against the sandbox on 2026-08-31: real HTTP
   * 200, responseCode "00", the exact documented field names, on the
   * first try. One real caveat found the same way: every totalFee in
   * sandbox comes back "0" regardless of amount or channel - Duitku's
   * sandbox doesn't simulate real fee variation (checkTransactionStatus's
   * real "5000.00" fee on an actually-paid sandbox transaction confirms
   * fees are real on this account, just not previewable pre-checkout in
   * sandbox). Real, varying fees should appear once production
   * credentials are used.
   */
  async getPaymentMethods(amount: number): Promise<PaymentMethodFee[]> {
    const datetime = formatDuitkuDatetime(new Date());
    const signature = createHash('sha256')
      .update(`${this.merchantCode}${amount}${datetime}${this.apiKey}`)
      .digest('hex');

    const response = await fetch(this.paymentMethodUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode: this.merchantCode,
        amount,
        datetime,
        signature,
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Duitku getPaymentMethod request failed: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as DuitkuPaymentMethodResponse;

    if (body.responseCode !== '00') {
      throw new InternalServerErrorException(
        `Duitku getPaymentMethod failed: ${body.responseMessage} (code ${body.responseCode})`,
      );
    }

    return body.paymentFee;
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
   * Online) and resolves synchronously with the final outcome - there is
   * no callback to wait on for this product (see class doc). Returns a
   * structured failure instead of throwing for an expected business
   * outcome (bad account, insufficient funds, inquiry rejected, missing
   * bank-code mapping) so the caller can refund the withdrawal
   * immediately; still throws for a genuine connectivity/infrastructure
   * error, since that's not a result the caller should record as a final
   * disbursement outcome.
   *
   * Real production bug found 2026-09-08: deriveDuitkuBankCode's
   * deliberate throw for the still-missing bank-code mapping was
   * uncaught here, surfacing as a raw, unexplained 500 the moment a real
   * client actually tried to approve a real withdrawal - instead of the
   * same graceful FAILED-with-refund outcome every other Duitku rejection
   * already gets. This doesn't make disbursement work (still blocked on
   * the missing mapping, itself blocked on Duitku's account activation),
   * it just makes the failure behave like every other expected one.
   */
  async createPayout(params: CreatePayoutParams): Promise<CreatePayoutResult> {
    const amount = Math.round(params.amount);

    let bankCode: string;
    try {
      bankCode = deriveDuitkuBankCode(params.bankName);
    } catch (error) {
      return {
        success: false,
        payoutId: null,
        responseCode: 'BANK_CODE_MISSING',
        responseDesc:
          error instanceof Error
            ? error.message
            : `No Duitku bank code mapping for "${params.bankName}"`,
      };
    }

    const inquiry = await this.inquireDisbursement({
      referenceId: params.referenceId,
      amount,
      bankCode,
      accountNumber: params.accountNumber,
      senderName: params.accountHolder,
      purpose: params.description,
    });

    if (!inquiry.success) {
      return {
        success: false,
        payoutId: null,
        responseCode: inquiry.responseCode,
        responseDesc: inquiry.responseDesc,
      };
    }

    return this.transferDisbursement({
      disburseId: inquiry.disburseId,
      accountName: inquiry.accountName,
      custRefNumber: inquiry.custRefNumber,
      amount,
      bankCode,
      accountNumber: params.accountNumber,
      purpose: params.description,
    });
  }

  private async inquireDisbursement(params: {
    referenceId: string;
    amount: number;
    bankCode: string;
    accountNumber: string;
    senderName: string;
    purpose: string;
  }): Promise<
    | {
        success: true;
        disburseId: string;
        accountName: string;
        custRefNumber: string;
      }
    | { success: false; responseCode: string; responseDesc: string }
  > {
    const timestamp = Date.now();
    const signature = createHash('sha256')
      .update(
        `${this.merchantCode}${params.amount}${params.referenceId}${this.apiKey}`,
      )
      .digest('hex');

    const response = await fetch(this.disbursementInquiryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode: this.merchantCode,
        custRefNumber: params.referenceId,
        bankAccount: params.accountNumber,
        bankCode: params.bankCode,
        amountTransfer: params.amount,
        senderName: params.senderName,
        purpose: params.purpose,
        timestamp,
        signature,
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Duitku disbursement inquiry request failed: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as DuitkuInquiryResponse;

    if (body.responseCode !== '00' || !body.disburseId) {
      return {
        success: false,
        responseCode: body.responseCode,
        responseDesc: body.responseDesc ?? 'Inquiry rejected',
      };
    }

    return {
      success: true,
      disburseId: body.disburseId,
      accountName: body.accountName ?? '',
      custRefNumber: body.custRefNumber ?? params.referenceId,
    };
  }

  private async transferDisbursement(params: {
    disburseId: string;
    accountName: string;
    custRefNumber: string;
    amount: number;
    bankCode: string;
    accountNumber: string;
    purpose: string;
  }): Promise<CreatePayoutResult> {
    const timestamp = Date.now();
    const userId = this.configService.getOrThrow<string>('DUITKU_USER_ID');
    const email = this.configService.getOrThrow<string>('DUITKU_EMAIL');

    const signature = createHash('sha256')
      .update(
        `${email}${timestamp}${params.bankCode}${params.accountNumber}${params.accountName}${params.custRefNumber}${params.amount}${params.purpose}${params.disburseId}${this.apiKey}`,
      )
      .digest('hex');

    const response = await fetch(this.disbursementTransferUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        disburseId: params.disburseId,
        userId,
        email,
        bankCode: params.bankCode,
        bankAccount: params.accountNumber,
        amountTransfer: params.amount,
        accountName: params.accountName,
        custRefNumber: params.custRefNumber,
        purpose: params.purpose,
        timestamp,
        signature,
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Duitku disbursement transfer request failed: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as DuitkuTransferResponse;

    return {
      success: body.responseCode === '00',
      payoutId: params.disburseId,
      responseCode: body.responseCode,
      responseDesc: body.responseDesc ?? '',
    };
  }

  /**
   * Checks the merchant's disbursement balance. Real-verified against the
   * sandbox on 2026-08-26: the request is accepted and parsed correctly
   * (real balance/effectiveBalance/userId/email fields come back), but
   * this account's disbursement feature isn't provisioned, so it always
   * returns `{responseCode: "-120", responseDesc: "User not allowed"}`
   * with a balance of 0 - same root blocker as createPayout's inquiry and
   * transfer steps. Will start returning a real balance once disbursement
   * is activated; nothing else about this endpoint needs to change.
   *
   * Unlike transferDisbursement (a real money-moving call that must fail
   * loudly if DUITKU_USER_ID/DUITKU_EMAIL are missing), this falls back to
   * placeholders when they're not set - the client hasn't located the real
   * values yet, and Duitku rejects every checkbalance call identically
   * regardless of what userId/email is sent while disbursement isn't
   * provisioned (verified with a deliberately fake email), so a missing
   * config here shouldn't crash a read-only monitoring endpoint.
   */
  async checkBalance(): Promise<CheckBalanceResult> {
    const timestamp = Date.now();
    const userId = this.configService.get<string>('DUITKU_USER_ID', 'unknown');
    const email = this.configService.get<string>(
      'DUITKU_EMAIL',
      'unknown@example.com',
    );

    const signature = createHash('sha256')
      .update(`${email}${timestamp}${this.apiKey}`)
      .digest('hex');

    const response = await fetch(this.disbursementCheckBalanceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, email, timestamp, signature }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Duitku disbursement checkbalance request failed: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as DuitkuCheckBalanceResponse;

    return {
      success: body.responseCode === '00',
      balance: body.balance ?? null,
      effectiveBalance: body.effectiveBalance ?? null,
      responseCode: body.responseCode,
      responseDesc: body.responseDesc ?? '',
    };
  }

  /**
   * Verifies a Duitku disbursement callback signature. Not used by the
   * Transfer Online flow this app currently uses (it has no callback at
   * all - createPayout resolves synchronously); kept for the "Clearing"
   * disbursement product, which does have a documented callback, in case
   * this app ever needs it. The exact signature formula shown here is a
   * best-effort default, not yet confirmed against a real account.
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

/**
 * "Y-m-d H:i:s" per Duitku's official PHP SDK (PHP's date() default
 * timezone), used only for getPaymentMethod's signature. Real-verified
 * against the sandbox on 2026-08-31 using this exact UTC-based format.
 */
function formatDuitkuDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
