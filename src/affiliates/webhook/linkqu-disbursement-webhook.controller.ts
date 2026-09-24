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
import { AffiliatesService } from '../affiliates.service';
import { PlatformService } from '../../platform/platform.service';

/**
 * LinkQu's "Callback Status Transfer Bank" - genuinely reachable, unlike
 * Duitku's disbursement callback (which this app never actually received,
 * since Duitku's Transfer Online product has no callback at all). Routes to
 * either an affiliate commission withdrawal or a platform withdrawal by
 * partner_reff prefix (WDW- vs PWD-, per generateOrderId's existing
 * convention), since both share the same LinkQu account and callback URL.
 *
 * Excluded from Swagger: LinkQu calls this, not a person using the API.
 */
@ApiExcludeController()
@Controller('webhooks/linkqu')
export class LinkQuDisbursementWebhookController {
  private readonly logger = new Logger(
    LinkQuDisbursementWebhookController.name,
  );

  constructor(
    private readonly linkQuService: LinkQuService,
    private readonly affiliatesService: AffiliatesService,
    private readonly platformService: PlatformService,
  ) {}

  @Post('disbursement')
  @HttpCode(HttpStatus.OK)
  async handleDisbursementCallback(@Body() body: Record<string, any>) {
    const partnerReff =
      typeof body?.partner_reff === 'string' ? body.partner_reff : undefined;
    const amount =
      typeof body?.amount === 'number'
        ? String(body.amount)
        : typeof body?.amount === 'string'
          ? body.amount
          : undefined;
    const accountNumber =
      typeof body?.accountnumber === 'string' ? body.accountnumber : undefined;
    const username =
      typeof body?.username === 'string' ? body.username : undefined;
    const status = typeof body?.status === 'string' ? body.status : undefined;
    const signature =
      typeof body?.signature === 'string' ? body.signature : undefined;

    if (!partnerReff || !amount || !accountNumber || !username || !status) {
      this.logger.warn(
        `LinkQu disbursement callback missing required fields: ${JSON.stringify(body)}`,
      );
      return { response: 'OK' };
    }

    if (
      !this.linkQuService.verifyDisbursementCallbackSignature({
        partnerReff,
        amount,
        accountNumber,
        username,
        signature,
      })
    ) {
      throw new UnauthorizedException('Invalid LinkQu callback signature');
    }

    if (partnerReff.startsWith('PWD')) {
      await this.platformService.handleDisbursementCallback(
        partnerReff,
        status,
      );
    } else {
      await this.affiliatesService.handleDisbursementCallback(
        partnerReff,
        status,
      );
    }

    return { response: 'OK' };
  }
}
