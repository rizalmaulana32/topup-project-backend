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
import { AffiliatesService } from '../affiliates.service';

/**
 * Duitku's disbursement callback field names (specifically whether it
 * echoes back our own custRefNumber, as assumed here, versus only its own
 * disburseId) were not clearly confirmed from what's available without a
 * real, disbursement-activated Duitku account - this needs verification
 * once one exists, same as the createPayout/signature details in
 * DuitkuService.
 *
 * Excluded from Swagger: Duitku calls this, not a person using the API.
 */
@ApiExcludeController()
@Controller('webhooks/duitku')
export class DuitkuDisbursementWebhookController {
  private readonly logger = new Logger(
    DuitkuDisbursementWebhookController.name,
  );

  constructor(
    private readonly duitkuService: DuitkuService,
    private readonly affiliatesService: AffiliatesService,
  ) {}

  @Post('disbursement')
  @HttpCode(HttpStatus.OK)
  async handleDisbursementCallback(@Body() body: Record<string, any>) {
    const referenceId =
      typeof body?.custRefNumber === 'string' ? body.custRefNumber : undefined;
    const amount = typeof body?.amount === 'string' ? body.amount : undefined;
    const statusCode =
      typeof body?.statusCode === 'string' ? body.statusCode : undefined;
    const signature =
      typeof body?.signature === 'string' ? body.signature : undefined;

    if (!referenceId || !amount || !statusCode) {
      this.logger.warn(
        `Duitku disbursement callback missing custRefNumber/amount/statusCode: ${JSON.stringify(body)}`,
      );
      return { success: true };
    }

    if (
      !this.duitkuService.verifyDisbursementCallbackSignature({
        referenceId,
        amount,
        signature,
      })
    ) {
      throw new UnauthorizedException('Invalid Duitku callback signature');
    }

    await this.affiliatesService.handleDisbursementCallback(
      referenceId,
      statusCode,
    );

    return { success: true };
  }
}
