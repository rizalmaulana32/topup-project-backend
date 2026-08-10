import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Xendit } from 'xendit-node';

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

@Injectable()
export class XenditService {
  private readonly client: Xendit;
  private readonly callbackToken: string;

  constructor(private readonly configService: ConfigService) {
    this.client = new Xendit({
      secretKey: this.configService.getOrThrow<string>('XENDIT_SECRET_KEY'),
    });
    this.callbackToken = this.configService.getOrThrow<string>(
      'XENDIT_CALLBACK_TOKEN',
    );
  }

  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<CreateInvoiceResult> {
    const invoice = await this.client.Invoice.createInvoice({
      data: {
        externalId: params.externalId,
        amount: params.amount,
        description: params.description,
        payerEmail: params.payerEmail,
      },
    });

    return {
      invoiceId: invoice.id ?? params.externalId,
      invoiceUrl: invoice.invoiceUrl,
      status: invoice.status,
    };
  }

  /**
   * Sends a commission withdrawal to Xendit's Payout (Disbursement) API.
   * `channelCode` is derived from the affiliate's free-text `bank_name` as
   * `ID_<BANK_NAME uppercased>` (e.g. "BCA" -> "ID_BCA") since no bank
   * picker/validation against Xendit's channel list was in scope for this
   * slice — the founder should confirm this convention matches Xendit's
   * actual channel codes before using it with real affiliate bank names.
   */
  async createPayout(params: CreatePayoutParams): Promise<CreatePayoutResult> {
    const channelCode = `ID_${params.bankName.trim().toUpperCase().replace(/\s+/g, '_')}`;

    const payout = await this.client.Payout.createPayout({
      idempotencyKey: params.referenceId,
      data: {
        referenceId: params.referenceId,
        channelCode,
        channelProperties: {
          accountHolderName: params.accountHolder,
          accountNumber: params.accountNumber,
        },
        amount: params.amount,
        description: params.description,
        currency: 'IDR',
      },
    });

    return {
      payoutId: payout.id,
      status: payout.status,
    };
  }

  /**
   * Verifies the `x-callback-token` header Xendit sends with every
   * webhook callback. Xendit does not use a computed signature hash (unlike
   * the source document's Midtrans SHA-512 formula) — it is a direct
   * constant-time comparison against the token configured in the Xendit
   * dashboard.
   */
  verifyCallbackToken(receivedToken: string | undefined): boolean {
    if (!receivedToken) {
      return false;
    }

    const expected = Buffer.from(this.callbackToken);
    const received = Buffer.from(receivedToken);

    if (expected.length !== received.length) {
      return false;
    }

    return timingSafeEqual(expected, received);
  }
}
