import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdjustCommissionBalanceDto } from '../admin/dto/adjust-commission-balance.dto';
import { ProcessWithdrawalDto } from '../admin/dto/process-withdrawal.dto';
import { ResetAffiliatePasswordDto } from '../admin/dto/reset-affiliate-password.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { UserRole } from '../users/entities/user.entity';
import { CreateSuperAffiliateDto } from './dto/create-super-affiliate.dto';
import { ListSuperAffiliateWithdrawalsDto } from './dto/list-super-affiliate-withdrawals.dto';
import { UpdateSuperAffiliateDto } from './dto/update-super-affiliate.dto';
import { SuperAffiliatesService } from './super-affiliates.service';

type AuthedRequest = Request & { user: AuthenticatedUser };

/** Superadmin "Kelola Super Affiliate" endpoints. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class SuperAffiliatesAdminController {
  constructor(private readonly service: SuperAffiliatesService) {}

  @Post('super-affiliates')
  @ApiOperation({ summary: 'Create a super affiliate (active immediately)' })
  async create(
    @Body() dto: CreateSuperAffiliateDto,
    @Req() req: AuthedRequest,
  ) {
    const profile = await this.service.create(
      {
        name: dto.name,
        email: dto.email,
        password: dto.password,
        phoneNumber: dto.phone_number,
        bankName: dto.bank_name,
        accountNumber: dto.account_number,
        accountHolder: dto.account_holder,
        referralCode: dto.referral_code,
        commissionRate: dto.commission_rate,
        thresholdMode: dto.threshold_mode,
        thresholdAmount: dto.threshold_amount,
      },
      req.user.id,
    );
    return { success: true, data: await this.service.getDetail(profile.id) };
  }

  @Get('super-affiliates')
  @ApiOperation({
    summary: 'List super affiliates with downline_count and balances',
  })
  async list() {
    return { success: true, data: await this.service.findAll() };
  }

  @Get('super-affiliates/:id')
  @ApiOperation({
    summary:
      'Super affiliate detail with downline affiliates, commission logs and withdrawals',
  })
  async detail(@Param('id') id: string) {
    return { success: true, data: await this.service.getDetail(id) };
  }

  @Patch('super-affiliates/:id')
  @ApiOperation({
    summary:
      'Edit name, referral_code, commission rule or status (rule changes apply to future transactions only)',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateSuperAffiliateDto) {
    await this.service.update(id, {
      name: dto.name,
      referralCode: dto.referral_code,
      commissionRate: dto.commission_rate,
      thresholdMode: dto.threshold_mode,
      thresholdAmount: dto.threshold_amount,
      status: dto.status,
    });
    return { success: true, data: await this.service.getDetail(id) };
  }

  @Patch('super-affiliates/:id/commission-balance')
  @ApiOperation({
    summary:
      "Manually add to or deduct from a super affiliate's commission balance - amount is added, pass a negative number to deduct",
  })
  async adjustCommissionBalance(
    @Param('id') id: string,
    @Body() dto: AdjustCommissionBalanceDto,
  ) {
    await this.service.adjustCommissionBalance(id, dto.amount, dto.reason);
    return { success: true, data: await this.service.getDetail(id) };
  }

  @Delete('super-affiliates/:id')
  @ApiOperation({
    summary:
      'Soft-delete; downline affiliates stay linked but no new SA commission is earned',
  })
  async remove(@Param('id') id: string) {
    await this.service.softDelete(id);
    return { success: true };
  }

  @Post('super-affiliates/:id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetAffiliatePasswordDto,
  ) {
    await this.service.resetPassword(id, dto.new_password);
    return { success: true };
  }

  @Get('super-affiliate-withdrawals')
  async listWithdrawals(@Query() query: ListSuperAffiliateWithdrawalsDto) {
    const data = await this.service.findAllWithdrawals({
      status: query.status,
      method: query.method,
      superAffiliateId: query.super_affiliate_id,
      search: query.search,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return { success: true, data };
  }

  @Post('super-affiliate-withdrawals/:id/approve')
  @ApiOperation({ summary: 'pending -> approved; nothing is sent yet' })
  async approveWithdrawal(@Param('id') id: string, @Req() req: AuthedRequest) {
    return {
      success: true,
      data: await this.service.approveWithdrawal(id, req.user.id),
    };
  }

  @Post('super-affiliate-withdrawals/:id/process')
  @ApiOperation({
    summary:
      'approved -> paid. bank: after the manual transfer. momo_coin: sends the coins now.',
  })
  async processWithdrawal(
    @Param('id') id: string,
    @Body() dto: ProcessWithdrawalDto,
    @Req() req: AuthedRequest,
  ) {
    return {
      success: true,
      data: await this.service.markWithdrawalProcessed(
        id,
        req.user.id,
        dto.notes,
      ),
    };
  }

  @Post('super-affiliate-withdrawals/:id/reject')
  @ApiOperation({
    summary: 'pending -> rejected; the locked amount is refunded',
  })
  async rejectWithdrawal(@Param('id') id: string, @Req() req: AuthedRequest) {
    return {
      success: true,
      data: await this.service.rejectWithdrawal(id, req.user.id),
    };
  }
}
