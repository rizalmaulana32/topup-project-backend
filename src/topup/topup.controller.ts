import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckIdDto } from './dto/check-id.dto';
import { CheckoutDto } from './dto/checkout.dto';
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

  @Post('check-id')
  @ApiOperation({ summary: 'Validate a target game/user ID before checkout' })
  async checkId(@Body() dto: CheckIdDto) {
    const data = await this.topupService.checkId(dto);
    return { success: true, data };
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Start a purchase and get a Duitku invoice to pay',
  })
  async checkout(@Body() dto: CheckoutDto) {
    const data = await this.topupService.checkout(dto);
    return { success: true, data };
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: "Check a transaction's current status" })
  async getTransactionStatus(@Param('id') id: string) {
    const data = await this.topupService.getTransactionStatus(id);
    return { success: true, data };
  }
}
