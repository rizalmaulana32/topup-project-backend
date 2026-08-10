import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import { TransactionsService } from '../transactions/transactions.service';
import { UserRole } from '../users/entities/user.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { ListAffiliatesDto } from './dto/list-affiliates.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { ListWithdrawalsDto } from './dto/list-withdrawals.dto';
import { UpdateCommissionRateDto } from './dto/update-commission-rate.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class AdminController {
  constructor(
    private readonly affiliatesService: AffiliatesService,
    private readonly settingsService: SettingsService,
    private readonly productsService: ProductsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Get('affiliates')
  async listAffiliates(@Query() query: ListAffiliatesDto) {
    const result = await this.affiliatesService.findAllProfiles({
      status: query.status,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      success: true,
      data: {
        items: result.items.map((profile) => ({
          profile_id: profile.id,
          user_id: profile.userId,
          name: profile.user.name,
          email: profile.user.email,
          status: profile.user.status,
          affiliate_code: profile.affiliateCode,
          commission_rate: profile.commissionRate,
          commission_balance: profile.commissionBalance,
          created_at: profile.createdAt,
        })),
        total: result.total,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    };
  }

  @Post('affiliates/:id/approve')
  async approveAffiliate(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const profile = await this.affiliatesService.approve(id, request.user.id);
    return {
      success: true,
      data: {
        profile_id: profile.id,
        affiliate_code: profile.affiliateCode,
        approved_at: profile.approvedAt,
      },
    };
  }

  @Post('affiliates/:id/reject')
  async rejectAffiliate(@Param('id') id: string) {
    await this.affiliatesService.reject(id);
    return { success: true };
  }

  @Patch('affiliates/:id/commission-rate')
  async updateAffiliateCommissionRate(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionRateDto,
  ) {
    const profile = await this.affiliatesService.updateCommissionRate(
      id,
      dto.commission_rate,
    );
    return {
      success: true,
      data: {
        profile_id: profile.id,
        commission_rate: profile.commissionRate,
      },
    };
  }

  @Get('settings')
  async getSettings() {
    const settings = await this.settingsService.get();
    return {
      success: true,
      data: {
        global_commission_rate: settings.globalCommissionRate,
        minimum_withdrawal_amount: settings.minimumWithdrawalAmount,
      },
    };
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    const settings = await this.settingsService.update({
      globalCommissionRate: dto.global_commission_rate,
      minimumWithdrawalAmount: dto.minimum_withdrawal_amount,
    });
    return {
      success: true,
      data: {
        global_commission_rate: settings.globalCommissionRate,
        minimum_withdrawal_amount: settings.minimumWithdrawalAmount,
      },
    };
  }

  @Get('products')
  async listProducts() {
    const products = await this.productsService.findAll();
    return { success: true, data: products };
  }

  @Post('products')
  async createProduct(@Body() dto: CreateProductDto) {
    const product = await this.productsService.create({
      name: dto.name,
      providerCode: dto.provider_code,
      basePrice: dto.base_price,
      sellingPrice: dto.selling_price,
    });
    return { success: true, data: product };
  }

  @Patch('products/:id')
  async updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    const product = await this.productsService.update(id, {
      name: dto.name,
      providerCode: dto.provider_code,
      basePrice: dto.base_price,
      sellingPrice: dto.selling_price,
      status: dto.status,
    });
    return { success: true, data: product };
  }

  @Get('withdrawals')
  async listWithdrawals(@Query() query: ListWithdrawalsDto) {
    const result = await this.affiliatesService.findAllWithdrawals({
      status: query.status,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      success: true,
      data: {
        items: result.items,
        total: result.total,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    };
  }

  @Post('withdrawals/:id/approve')
  async approveWithdrawal(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const withdrawal = await this.affiliatesService.approveWithdrawal(
      id,
      request.user.id,
    );
    return {
      success: true,
      data: {
        withdrawal_id: withdrawal.id,
        status: withdrawal.status,
        xendit_disbursement_id: withdrawal.xenditDisbursementId,
      },
    };
  }

  @Get('transactions')
  async listTransactions(@Query() query: ListTransactionsDto) {
    const result = await this.transactionsService.findAll({
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      success: true,
      data: {
        items: result.items,
        total: result.total,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    };
  }
}
