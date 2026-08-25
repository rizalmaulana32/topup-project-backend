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
import { DuitkuService } from '../../duitku/duitku.service';
import { TopupService } from '../topup.service';

/**
 * Duitku sends its invoice callback as application/x-www-form-urlencoded
 * (not JSON like Xendit did), with the signature carried as one of the
 * body fields rather than a header - the raw body is read directly here
 * instead of going through a class-validator DTO, same reasoning as the
 * old Xendit webhook.
 *
 * Excluded from Swagger: Duitku calls this, not a person using the API.
 */
@ApiExcludeController()
@Controller('webhooks/duitku')
export class DuitkuWebhookController {
  private readonly logger = new Logger(DuitkuWebhookController.name);

  constructor(
    private readonly duitkuService: DuitkuService,
    private readonly topupService: TopupService,
  ) {}

  @Post('invoice')
  @HttpCode(HttpStatus.OK)
  async handleInvoiceCallback(@Body() body: Record<string, any>) {
    const merchantOrderId =
      typeof body?.merchantOrderId === 'string'
        ? body.merchantOrderId
        : undefined;
    const amount = typeof body?.amount === 'string' ? body.amount : undefined;
    const resultCode =
      typeof body?.resultCode === 'string' ? body.resultCode : undefined;
    const signature =
      typeof body?.signature === 'string' ? body.signature : undefined;

    if (!merchantOrderId || !amount || !resultCode) {
      this.logger.warn(
        `Duitku invoice callback missing merchantOrderId/amount/resultCode: ${JSON.stringify(body)}`,
      );
      return { success: true };
    }

    if (
      !this.duitkuService.verifyInvoiceCallbackSignature({
        merchantOrderId,
        amount,
        signature,
      })
    ) {
      throw new UnauthorizedException('Invalid Duitku callback signature');
    }

    if (resultCode === '00') {
      await this.topupService.handleInvoicePaid(merchantOrderId);
    } else {
      // '01' (failed) and '02' (canceled) both land here - Duitku has no
      // separate "expired" push, see TopupService.handleInvoiceExpired.
      await this.topupService.handleInvoiceFailed(merchantOrderId);
    }

    return { success: true };
  }
}
