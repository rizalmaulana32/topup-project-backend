import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { LinkQuService } from '../../linkqu/linkqu.service';
import { TopupService } from '../topup.service';

/**
 * LinkQu sends callbacks as a JSON body (not form-urlencoded like Duitku),
 * with the signature carried as one of the body fields - the raw body is
 * read directly here instead of going through a class-validator DTO, same
 * reasoning as the old Duitku/Xendit webhooks.
 *
 * This handles the VA "Callback Transaction Received" shape, the only one
 * LinkQu's docs fully document with an exact field list, formula, and
 * example. Checkout uses Payment Link, which wraps VA/QRIS/e-wallet
 * depending on what the customer picks - LinkQu's docs did not separately
 * document Payment Link's own callback shape, so it is assumed here to
 * reuse (or be compatible with) the VA shape. This has NOT been confirmed
 * against a real Payment Link transaction; verify with a real test payment
 * before relying on this in production.
 *
 * Excluded from Swagger: LinkQu calls this, not a person using the API.
 */
@ApiExcludeController()
@Controller('webhooks/linkqu')
export class LinkQuWebhookController {
  private readonly logger = new Logger(LinkQuWebhookController.name);

  constructor(
    private readonly linkQuService: LinkQuService,
    private readonly topupService: TopupService,
  ) {}

  @Post('payment')
  @HttpCode(HttpStatus.OK)
  async handlePaymentCallback(@Body() body: Record<string, any>) {
    const partnerReff =
      typeof body?.partner_reff === 'string' ? body.partner_reff : undefined;
    const amount =
      typeof body?.amount === 'number'
        ? String(body.amount)
        : typeof body?.amount === 'string'
          ? body.amount
          : undefined;
    const vaNumber =
      typeof body?.va_number === 'string' ? body.va_number : undefined;
    const username =
      typeof body?.username === 'string' ? body.username : undefined;
    const status = typeof body?.status === 'string' ? body.status : undefined;
    const signature =
      typeof body?.signature === 'string' ? body.signature : undefined;

    if (!partnerReff || !amount || !vaNumber || !username || !status) {
      this.logger.warn(
        `LinkQu payment callback missing required fields: ${JSON.stringify(body)}`,
      );
      return { response: 'OK' };
    }

    if (
      !this.linkQuService.verifyInvoiceCallbackSignature({
        partnerReff,
        amount,
        vaNumber,
        username,
        signature,
      })
    ) {
      throw new UnauthorizedException('Invalid LinkQu callback signature');
    }

    if (status === 'SUCCESS') {
      await this.topupService.handleInvoicePaid(partnerReff);
    } else {
      await this.topupService.handleInvoiceFailed(partnerReff);
    }

    return { response: 'OK' };
  }
}
