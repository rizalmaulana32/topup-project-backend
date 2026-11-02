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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { UserRole } from '../users/entities/user.entity';
import { AdjustCoinLimitDto } from './dto/adjust-coin-limit.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { CreateManualTopupDto } from './dto/create-manual-topup.dto';
import { ListManualTopupsDto } from './dto/list-manual-topups.dto';
import { ManualTopupService } from './manual-topup.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class ManualTopupController {
  constructor(private readonly manualTopupService: ManualTopupService) {}

  @Post('manual-admins')
  @ApiOperation({
    summary:
      'Create a manual-send-only admin account (role=admin) with an initial coin budget',
  })
  async createAdmin(
    @Body() dto: CreateAdminDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const profile = await this.manualTopupService.createAdmin({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      coinLimit: dto.coin_limit,
      createdBy: request.user.id,
    });
    return {
      success: true,
      data: {
        profile_id: profile.id,
        user_id: profile.userId,
        coin_limit: profile.coinLimit,
      },
    };
  }

  @Get('manual-admins')
  @ApiOperation({ summary: 'List manual-send admin accounts and their coin budgets' })
  async listAdmins() {
    const profiles = await this.manualTopupService.findAllAdmins();
    return {
      success: true,
      data: profiles.map((profile) => ({
        profile_id: profile.id,
        user_id: profile.userId,
        name: profile.user.name,
        email: profile.user.email,
        coin_limit: profile.coinLimit,
        total_coin_sent: profile.totalCoinSent,
        created_by: profile.createdBy,
        created_at: profile.createdAt,
      })),
    };
  }

  @Patch('manual-admins/:id/coin-limit')
  @ApiOperation({
    summary:
      "Top up or deduct an admin's coin budget - amount is added to the current limit, pass a negative number to deduct",
  })
  @ApiParam({ name: 'id', description: 'The admin PROFILE ID from GET /admin/manual-admins' })
  async adjustCoinLimit(
    @Param('id') id: string,
    @Body() dto: AdjustCoinLimitDto,
  ) {
    const profile = await this.manualTopupService.adjustCoinLimit(
      id,
      dto.amount,
    );
    return {
      success: true,
      data: { profile_id: profile.id, coin_limit: profile.coinLimit },
    };
  }

  @Post('manual-topups')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Send coin directly to a MomoLive ID with no payment gateway involved - either once now (total_installments=1) or as a repeating schedule (total_installments>1 + interval_days, first installment sent immediately, the rest via the hourly scheduler)',
  })
  async createManualTopup(
    @Body() dto: CreateManualTopupDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const manualTopup = await this.manualTopupService.createManualTopup({
      momoUserId: dto.momo_user_id,
      customerName: dto.customer_name,
      totalAmount: dto.total_amount,
      amountPerSend: dto.amount_per_send,
      intervalMinutes: dto.interval_minutes,
      createdBy: request.user.id,
    });
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }

  @Get('manual-topups')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      "List manual top-ups/schedules. An admin-role caller only ever sees their own - a superadmin sees everyone's.",
  })
  async listManualTopups(
    @Query() query: ListManualTopupsDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const isAdminRole = request.user.role === UserRole.ADMIN;
    const result = await this.manualTopupService.findAll({
      status: query.status,
      createdBy: isAdminRole ? request.user.id : undefined,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      success: true,
      data: {
        items: result.items.map(toManualTopupResponse),
        total: result.total,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    };
  }

  @Get('manual-topups/:id/sends')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Per-installment send history for one manual top-up' })
  async listManualTopupSends(@Param('id') id: string) {
    const sends = await this.manualTopupService.findSendsForManualTopup(id);
    return {
      success: true,
      data: sends.map((send) => ({
        id: send.id,
        amount: send.amount,
        status: send.status,
        provider_response: send.providerResponse,
        sent_at: send.sentAt,
      })),
    };
  }

  @Post('manual-topups/:id/cancel')
  @ApiOperation({ summary: 'Cancel an active/paused manual top-up schedule before it completes' })
  async cancelManualTopup(@Param('id') id: string) {
    const manualTopup = await this.manualTopupService.cancel(id);
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }

  @Post('manual-topups/:id/resume')
  @ApiOperation({
    summary:
      "Resume a schedule that was auto-paused for insufficient coin limit - call after topping up the creator's budget",
  })
  async resumeManualTopup(@Param('id') id: string) {
    const manualTopup = await this.manualTopupService.resume(id);
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }
}

function toManualTopupResponse(manualTopup: {
  id: string;
  momoUserId: string;
  customerName: string | null;
  totalAmount: string;
  amountPerSend: string;
  amountSent: string;
  intervalMinutes: number | null;
  status: string;
  nextRunAt: Date | null;
  createdBy: string;
  createdAt: Date;
}) {
  return {
    id: manualTopup.id,
    momo_user_id: manualTopup.momoUserId,
    customer_name: manualTopup.customerName,
    total_amount: manualTopup.totalAmount,
    amount_per_send: manualTopup.amountPerSend,
    amount_sent: manualTopup.amountSent,
    interval_minutes: manualTopup.intervalMinutes,
    status: manualTopup.status,
    next_run_at: manualTopup.nextRunAt,
    created_by: manualTopup.createdBy,
    created_at: manualTopup.createdAt,
  };
}
