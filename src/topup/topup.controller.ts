import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientIpThrottlerGuard } from '../common/client-ip-throttler.guard';
import { CheckIdDto } from './dto/check-id.dto';
import { CheckoutCustomAmountDto } from './dto/checkout-custom-amount.dto';
import { EstimateCustomAmountDto } from './dto/estimate-custom-amount.dto';
import { TopupService } from './topup.service';

@ApiTags('topup')
@Controller('topup')
export class TopupController {
  constructor(private readonly topupService: TopupService) {}

  @Get('affiliate-code/:code')
  @ApiOperation({
    summary:
      'Check whether an affiliate/referral code is currently valid (exists and the affiliate is active) - use before checkout to validate a customer-entered code',
  })
  async validateAffiliateCode(@Param('code') code: string) {
    const data = await this.topupService.validateAffiliateCode(code);
    return { success: true, data };
  }

  @Post('check-id')
  @ApiOperation({ summary: 'Validate a target game/user ID before checkout' })
  async checkId(@Body() dto: CheckIdDto) {
    const data = await this.topupService.checkId(dto);
    return { success: true, data };
  }

  @Get('config')
  @ApiOperation({
    summary:
      'Public top-up page config (no auth): whether the 0.7% extra coin is currently on, its rate, and the minimum custom amount - for banners/validation before the customer types a nominal. Use /topup/estimate for actual coin numbers.',
  })
  async getConfig() {
    const data = await this.topupService.getPublicConfig();
    return { success: true, data };
  }

  @Get('manual-qris')
  @ApiOperation({
    summary:
      'Public manual QRIS image (no auth). 404 when hidden (manual_qris_enabled off) or not uploaded - use manual_qris_url from /topup/config.',
  })
  @Header('X-Content-Type-Options', 'nosniff')
  async getManualQris(): Promise<StreamableFile> {
    const qris = await this.topupService.getPublicManualQris();
    if (!qris) {
      throw new NotFoundException('Manual QRIS is not available');
    }
    return new StreamableFile(qris.image, { type: qris.mimeType });
  }

  @Get('estimate')
  @ApiOperation({
    summary:
      'Calculator for the adjustable-amount checkout form: pass exactly one of `amount` or `coin` (both are aliases for the same nominal rupiah paid - coin and rupiah are the same number by design, there is no reverse/target calculation). Returns amount, coin_amount (base + the matching active bonus tier % from /admin/bonus-tiers, floored, + 0.7% extra coin when custom_amount_extra_coin_enabled is on - off by default), bonus_coin and extra_coin. Uses the exact same formula checkout-custom charges, so this preview never drifts out of sync.',
  })
  async estimateCustomAmount(@Query() dto: EstimateCustomAmountDto) {
    const data = await this.topupService.estimateCustomAmount(dto);
    return { success: true, data };
  }

  @Post('checkout-custom')
  @ApiOperation({
    summary:
      'Start a purchase with a customer-typed rupiah nominal (`amount`, minimum Rp 10,000) - the only checkout since fixed products were removed - never send coin directly, the backend computes it. Coin payout = amount (1:1) plus the matching active bonus tier % (managed via /admin/bonus-tiers, floored to a whole coin) plus an extra 0.7% of the amount only when custom_amount_extra_coin_enabled is on (off by default; see custom-amount-pricing.util.ts), minus the admin-configured custom_amount_margin_rate (0% by default). Response includes coin_amount (final total, what gets sent once LinkQu confirms payment), bonus_coin (tier bonus) and extra_coin (the 0.7%) separately.',
  })
  async checkoutCustomAmount(@Body() dto: CheckoutCustomAmountDto) {
    const data = await this.topupService.checkoutCustomAmount(dto);
    return { success: true, data };
  }

  @Get('transactions/:id')
  // Polled every 5s by the status page: never serve it from a cache.
  @Header('Cache-Control', 'no-store')
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary:
      "Check a transaction's current status (public, polled by the status page; 60/min per client IP). expired_at = invoice deadline; pending flips to expired within ~1 min after it.",
  })
  async getTransactionStatus(@Param('id') id: string) {
    const data = await this.topupService.getTransactionStatus(id);
    return { success: true, data };
  }
}
