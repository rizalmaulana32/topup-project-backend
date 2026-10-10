import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckIdDto } from './dto/check-id.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutCustomAmountDto } from './dto/checkout-custom-amount.dto';
import { EstimateCustomAmountDto } from './dto/estimate-custom-amount.dto';
import { TopupService } from './topup.service';

@ApiTags('topup')
@Controller('topup')
export class TopupController {
  constructor(private readonly topupService: TopupService) {}

  @Get('products')
  @ApiOperation({ summary: 'List active coin packages customers can buy' })
  async listProducts() {
    const data = await this.topupService.listActiveProducts();
    return { success: true, data };
  }

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

  @Post('checkout')
  @ApiOperation({
    summary: 'Start a purchase and get a LinkQu payment link to pay',
  })
  async checkout(@Body() dto: CheckoutDto) {
    const data = await this.topupService.checkout(dto);
    return { success: true, data };
  }

  @Get('estimate')
  @ApiOperation({
    summary:
      "Calculator for the adjustable-amount checkout form: pass exactly one of `amount` or `coin` (both are aliases for the same nominal rupiah paid - coin and rupiah are the same number by design, there is no reverse/target calculation). Returns amount, coin_amount (base + bonus tier, if the nominal qualifies), and bonus_coin. Uses the exact same formula checkout-custom charges, so this preview never drifts out of sync.",
  })
  async estimateCustomAmount(@Query() dto: EstimateCustomAmountDto) {
    const data = await this.topupService.estimateCustomAmount(dto);
    return { success: true, data };
  }

  @Post('checkout-custom')
  @ApiOperation({
    summary:
      "Start a purchase with a customer-typed rupiah nominal (`amount`) instead of a fixed product (minimum Rp 10,000) - never send coin directly, the backend computes it. Coin payout = amount (1:1) plus the published bonus tier for amounts >= Rp 350,000 (see custom-amount-pricing.util.ts), minus the admin-configured custom_amount_margin_rate (0% by default). Response includes coin_amount (final total) and bonus_coin (the tier bonus alone, for display) separately.",
  })
  async checkoutCustomAmount(@Body() dto: CheckoutCustomAmountDto) {
    const data = await this.topupService.checkoutCustomAmount(dto);
    return { success: true, data };
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: "Check a transaction's current status" })
  async getTransactionStatus(@Param('id') id: string) {
    const data = await this.topupService.getTransactionStatus(id);
    return { success: true, data };
  }
}
