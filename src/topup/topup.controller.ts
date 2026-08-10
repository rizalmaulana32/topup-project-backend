import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CheckIdDto } from './dto/check-id.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { TopupService } from './topup.service';

@Controller('topup')
export class TopupController {
  constructor(private readonly topupService: TopupService) {}

  @Get('products')
  async listProducts() {
    const data = await this.topupService.listActiveProducts();
    return { success: true, data };
  }

  @Post('check-id')
  async checkId(@Body() dto: CheckIdDto) {
    const data = await this.topupService.checkId(dto);
    return { success: true, data };
  }

  @Post('checkout')
  async checkout(@Body() dto: CheckoutDto) {
    const data = await this.topupService.checkout(dto);
    return { success: true, data };
  }

  @Get('transactions/:id')
  async getTransactionStatus(@Param('id') id: string) {
    const data = await this.topupService.getTransactionStatus(id);
    return { success: true, data };
  }
}
