import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { XenditService } from '../../xendit/xendit.service';
import { TopupService } from '../topup.service';

/**
 * Xendit callback payloads use snake_case (external_id, status, ...), not
 * the SDK's camelCase model types, so the raw body is read directly here
 * instead of going through a class-validator DTO.
 */
@Controller('webhooks/xendit')
export class XenditWebhookController {
  private readonly logger = new Logger(XenditWebhookController.name);

  constructor(
    private readonly xenditService: XenditService,
    private readonly topupService: TopupService,
  ) {}

  @Post('invoice')
  @HttpCode(HttpStatus.OK)
  async handleInvoiceCallback(
    @Headers('x-callback-token') callbackToken: string | undefined,
    @Body() body: Record<string, any>,
  ) {
    if (!this.xenditService.verifyCallbackToken(callbackToken)) {
      throw new UnauthorizedException('Invalid x-callback-token');
    }

    const externalId =
      typeof body?.external_id === 'string' ? body.external_id : undefined;
    const status = typeof body?.status === 'string' ? body.status : undefined;

    if (!externalId || !status) {
      this.logger.warn(
        `Xendit invoice callback missing external_id/status: ${JSON.stringify(body)}`,
      );
      return { success: true };
    }

    if (status === 'PAID' || status === 'SETTLED') {
      await this.topupService.handleInvoicePaid(externalId);
    } else {
      this.logger.log(
        `Xendit invoice callback for ${externalId} with status ${status} — no action taken.`,
      );
    }

    return { success: true };
  }
}
