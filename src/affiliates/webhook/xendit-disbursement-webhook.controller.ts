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
import { AffiliatesService } from '../affiliates.service';

/**
 * Xendit payout callback payloads use snake_case (reference_id, status,
 * ...), read directly from the raw body rather than a class-validator DTO
 * — same pattern as the invoice webhook.
 */
@Controller('webhooks/xendit')
export class XenditDisbursementWebhookController {
  private readonly logger = new Logger(
    XenditDisbursementWebhookController.name,
  );

  constructor(
    private readonly xenditService: XenditService,
    private readonly affiliatesService: AffiliatesService,
  ) {}

  @Post('disbursement')
  @HttpCode(HttpStatus.OK)
  async handleDisbursementCallback(
    @Headers('x-callback-token') callbackToken: string | undefined,
    @Body() body: Record<string, any>,
  ) {
    if (!this.xenditService.verifyCallbackToken(callbackToken)) {
      throw new UnauthorizedException('Invalid x-callback-token');
    }

    const referenceId =
      typeof body?.reference_id === 'string' ? body.reference_id : undefined;
    const status = typeof body?.status === 'string' ? body.status : undefined;

    if (!referenceId || !status) {
      this.logger.warn(
        `Xendit disbursement callback missing reference_id/status: ${JSON.stringify(body)}`,
      );
      return { success: true };
    }

    await this.affiliatesService.handleDisbursementCallback(
      referenceId,
      status,
    );

    return { success: true };
  }
}
