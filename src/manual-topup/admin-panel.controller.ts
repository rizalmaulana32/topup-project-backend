import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { UserRole } from '../users/entities/user.entity';
import { CreateManualTopupDto } from './dto/create-manual-topup.dto';
import { ListManualTopupsDto } from './dto/list-manual-topups.dto';
import { ListTransferHistoryDto } from './dto/list-transfer-history.dto';
import {
  toAdminOverview,
  toManualTopupResponse,
  toSendResponse,
} from './manual-topup.controller';
import { ManualTopupService } from './manual-topup.service';

type AdminRequest = Request & { user: AuthenticatedUser };

/**
 * Endpoints for a logged-in admin-role account (manual coin senders). The
 * admin is always taken from the access token - nothing here takes an admin
 * id, and every manual top-up lookup is scoped to the caller's own. The
 * superadmin equivalents live under /admin.
 */
@ApiTags('admin-panel')
@ApiBearerAuth()
@Controller('admin-panel')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPanelController {
  constructor(private readonly manualTopupService: ManualTopupService) {}

  @Get('me')
  @ApiOperation({
    summary:
      'Own profile, referral code, coin_limit (remaining coin that can be sent), committed_coin (still to be sent by unfinished schedules) and transfer summary',
  })
  async me(@Req() request: AdminRequest) {
    const id = await this.manualTopupService.findAdminIdByUserIdOrFail(
      request.user.id,
    );
    const detail = await this.manualTopupService.getAdminDetail(id);
    return { success: true, data: toAdminOverview(detail) };
  }

  @Post('manual-topups')
  @ApiOperation({
    summary:
      'Send coin to a MomoLive ID - once (total_amount only) or as a schedule (amount_per_send + interval_minutes). Rejected if total_amount exceeds the remaining coin_limit.',
  })
  async createManualTopup(
    @Body() dto: CreateManualTopupDto,
    @Req() request: AdminRequest,
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
  @ApiOperation({ summary: 'Own manual top-ups/schedules, newest first' })
  async listManualTopups(
    @Query() query: ListManualTopupsDto,
    @Req() request: AdminRequest,
  ) {
    const result = await this.manualTopupService.findAll({
      status: query.status,
      createdBy: request.user.id,
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
  @ApiOperation({ summary: 'Per-send history of one own manual top-up' })
  async listManualTopupSends(
    @Param('id') id: string,
    @Req() request: AdminRequest,
  ) {
    const sends = await this.manualTopupService.findSendsForManualTopup(
      id,
      request.user.id,
    );
    return { success: true, data: sends.map(toSendResponse) };
  }

  @Post('manual-topups/:id/pause')
  @ApiOperation({ summary: 'Pause one own active schedule' })
  async pause(@Param('id') id: string, @Req() request: AdminRequest) {
    const manualTopup = await this.manualTopupService.pause(
      id,
      request.user.id,
    );
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }

  @Post('manual-topups/:id/resume')
  @ApiOperation({ summary: 'Resume one own paused schedule' })
  async resume(@Param('id') id: string, @Req() request: AdminRequest) {
    const manualTopup = await this.manualTopupService.resume(
      id,
      request.user.id,
    );
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }

  @Post('manual-topups/:id/cancel')
  @ApiOperation({
    summary: 'Cancel one own unfinished schedule',
  })
  async cancel(@Param('id') id: string, @Req() request: AdminRequest) {
    const manualTopup = await this.manualTopupService.cancel(
      id,
      request.user.id,
    );
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }

  @Get('transfers')
  @ApiOperation({
    summary:
      'Full coin transfer history: every individual send across all own manual top-ups, newest first, filterable by status (success/failed)',
  })
  async listTransfers(
    @Query() query: ListTransferHistoryDto,
    @Req() request: AdminRequest,
  ) {
    const result = await this.manualTopupService.findSendsForUser(
      request.user.id,
      {
        status: query.status,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    );
    return {
      success: true,
      data: {
        items: result.items.map(({ send, manualTopup }) => ({
          ...toSendResponse(send),
          manual_topup_id: send.manualTopupId,
          momo_user_id: manualTopup?.momoUserId ?? null,
          customer_name: manualTopup?.customerName ?? null,
        })),
        total: result.total,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    };
  }
}
