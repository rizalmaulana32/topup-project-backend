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
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { toJakartaTime, toXlsxFile } from '../common/utils/xlsx.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { UserRole } from '../users/entities/user.entity';
import { AdjustCoinLimitDto } from './dto/adjust-coin-limit.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { CreateManualTopupDto } from './dto/create-manual-topup.dto';
import { ListManualTopupsDto } from './dto/list-manual-topups.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AdminProfile } from './entities/admin-profile.entity';
import { ManualTopupStatus } from './entities/manual-topup.entity';
import {
  ManualTopupSend,
  ManualTopupSendStatus,
} from './entities/manual-topup-send.entity';
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
      referralCode: dto.referral_code,
      createdBy: request.user.id,
    });
    return {
      success: true,
      data: {
        profile_id: profile.id,
        user_id: profile.userId,
        coin_limit: profile.coinLimit,
        referral_code: profile.referralCode,
      },
    };
  }

  @Get('manual-admins')
  @ApiOperation({
    summary: 'List manual-send admin accounts and their coin budgets',
  })
  async listAdmins() {
    const profiles = await this.manualTopupService.findAllAdmins();
    return {
      success: true,
      data: profiles.map((profile) => ({
        ...toAdminResponse(profile),
        affiliate_count: profile.affiliateCount,
      })),
    };
  }

  @Get('manual-admins/:id')
  @ApiOperation({
    summary:
      'Admin detail: profile, coin limit, linked affiliates, and the full manual coin transfer history (every manual top-up with each send). Works for deleted admins too.',
  })
  @ApiParam({
    name: 'id',
    description: 'The admin PROFILE ID from GET /admin/manual-admins',
  })
  async getAdmin(@Param('id') id: string) {
    const detail = await this.manualTopupService.getAdminDetail(id);
    return { success: true, data: toAdminDetailResponse(detail) };
  }

  @Get('manual-admins/:id/export')
  @ApiOperation({
    summary:
      "Download one admin's successful coin sends (manual transfer history, one row per send, newest first) as an .xlsx file. Failed sends are left out. Built in memory per request, nothing is stored on the server. Works for deleted admins too.",
  })
  @ApiParam({
    name: 'id',
    description: 'The admin PROFILE ID from GET /admin/manual-admins',
  })
  async exportAdminTransfers(@Param('id') id: string): Promise<StreamableFile> {
    const detail = await this.manualTopupService.getAdminDetail(id);
    const topupById = new Map(detail.manualTopups.map((m) => [m.id, m]));
    return toXlsxFile(
      `admin-${detail.profile.id}-transfers`,
      ADMIN_TRANSFER_EXPORT_COLUMNS,
      detail.sends
        // Only successful sends are exported (client request, 2026-11-07).
        .filter((send) => send.status === ManualTopupSendStatus.SUCCESS)
        .reverse()
        .map((send) => {
          const manualTopup = topupById.get(send.manualTopupId);
          return {
            id: send.id,
            sent_at: toJakartaTime(send.sentAt),
            manual_topup_id: send.manualTopupId,
            momo_user_id: manualTopup?.momoUserId ?? null,
            customer_name: manualTopup?.customerName ?? null,
            amount: Number(send.amount),
            status: send.status,
            admin_name: detail.profile.user.name,
            admin_email: detail.profile.user.email,
          };
        }),
    );
  }

  @Patch('manual-admins/:id')
  @ApiOperation({
    summary:
      "Update an admin's name, email, password and/or referral_code - only the fields sent are changed",
  })
  @ApiParam({
    name: 'id',
    description: 'The admin PROFILE ID from GET /admin/manual-admins',
  })
  async updateAdmin(@Param('id') id: string, @Body() dto: UpdateAdminDto) {
    const profile = await this.manualTopupService.updateAdmin(id, {
      name: dto.name,
      email: dto.email,
      password: dto.password,
      referralCode: dto.referral_code,
    });
    return { success: true, data: toAdminResponse(profile) };
  }

  @Delete('manual-admins/:id')
  @ApiOperation({
    summary:
      'Delete an admin (soft delete): deactivates the account, frees the email for reuse and cancels their unfinished manual top-up schedules. Affiliates linked to the admin keep the link.',
  })
  @ApiParam({
    name: 'id',
    description: 'The admin PROFILE ID from GET /admin/manual-admins',
  })
  async deleteAdmin(@Param('id') id: string) {
    await this.manualTopupService.deleteAdmin(id);
    return { success: true };
  }

  @Patch('manual-admins/:id/coin-limit')
  @ApiOperation({
    summary:
      "Top up or deduct an admin's coin budget - amount is added to the current limit, pass a negative number to deduct",
  })
  @ApiParam({
    name: 'id',
    description: 'The admin PROFILE ID from GET /admin/manual-admins',
  })
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

  @Get('manual-topups/export')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      "Download the completed manual top-ups as an .xlsx file (an admin-role caller only gets their own, a superadmin gets everyone's). status is always completed; limit/offset are ignored (max 10000 rows, newest first). Built in memory per request, nothing is stored on the server.",
  })
  async exportManualTopups(
    @Req() request: Request & { user: AuthenticatedUser },
  ): Promise<StreamableFile> {
    const isAdminRole = request.user.role === UserRole.ADMIN;
    const result = await this.manualTopupService.findAll({
      // Only successful (completed) top-ups are exported (client request, 2026-11-07).
      status: ManualTopupStatus.COMPLETED,
      createdBy: isAdminRole ? request.user.id : undefined,
      limit: 10000,
      offset: 0,
    });
    return toXlsxFile(
      'manual-topups',
      MANUAL_TOPUP_EXPORT_COLUMNS,
      result.items.map((manualTopup) => ({
        id: manualTopup.id,
        created_at: toJakartaTime(manualTopup.createdAt),
        momo_user_id: manualTopup.momoUserId,
        customer_name: manualTopup.customerName,
        total_amount: Number(manualTopup.totalAmount),
        amount_per_send: Number(manualTopup.amountPerSend),
        amount_sent: Number(manualTopup.amountSent),
        interval_minutes: manualTopup.intervalMinutes,
        status: manualTopup.status,
        created_by: manualTopup.createdBy,
      })),
    );
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
  @ApiOperation({
    summary:
      'Per-installment send history for one manual top-up (an admin-role caller can only open their own)',
  })
  async listManualTopupSends(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const sends = await this.manualTopupService.findSendsForManualTopup(
      id,
      ownerFilter(request.user),
    );
    return {
      success: true,
      data: sends.map(toSendResponse),
    };
  }

  @Post('manual-topups/:id/cancel')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Cancel an active/paused manual top-up schedule before it completes',
  })
  async cancelManualTopup(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const manualTopup = await this.manualTopupService.cancel(
      id,
      ownerFilter(request.user),
    );
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }

  @Post('manual-topups/:id/pause')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Manually pause an active manual top-up schedule (stops the scheduler from sending further installments until resumed)',
  })
  async pauseManualTopup(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const manualTopup = await this.manualTopupService.pause(
      id,
      ownerFilter(request.user),
    );
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }

  @Post('manual-topups/:id/resume')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Resume a paused schedule - whether it was paused manually or auto-paused for insufficient coin limit (top up the budget first in that case)',
  })
  async resumeManualTopup(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const manualTopup = await this.manualTopupService.resume(
      id,
      ownerFilter(request.user),
    );
    return { success: true, data: toManualTopupResponse(manualTopup) };
  }
}

export function toManualTopupResponse(manualTopup: {
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

export function toAdminResponse(profile: AdminProfile) {
  return {
    profile_id: profile.id,
    user_id: profile.userId,
    name: profile.user.name,
    email: profile.user.email,
    referral_code: profile.referralCode,
    coin_limit: profile.coinLimit,
    total_coin_sent: profile.totalCoinSent,
    created_by: profile.createdBy,
    created_at: profile.createdAt,
  };
}

export function toSendResponse(send: ManualTopupSend) {
  return {
    id: send.id,
    amount: send.amount,
    status: send.status,
    provider_response: send.providerResponse,
    sent_at: send.sentAt,
  };
}

/** Admin-role callers may only touch their own manual top-ups; superadmins see everyone's. */
function ownerFilter(user: AuthenticatedUser): string | undefined {
  return user.role === UserRole.ADMIN ? user.id : undefined;
}

type AdminDetail = Awaited<ReturnType<ManualTopupService['getAdminDetail']>>;

/** Profile, coin limit and transfer summary - shared by the superadmin detail view and /admin-panel/me. */
export function toAdminOverview(detail: AdminDetail) {
  const { profile, manualTopups, sends, committedCoin } = detail;
  const successful = sends.filter(
    (send) => send.status === ManualTopupSendStatus.SUCCESS,
  );
  return {
    ...toAdminResponse(profile),
    status: profile.user.status,
    deleted_at: profile.deletedAt,
    /** Coin the unfinished (active/paused) schedules still need to send - informational; it is not reserved out of coin_limit. */
    committed_coin: committedCoin.toFixed(2),
    summary: {
      manual_topup_count: manualTopups.length,
      send_count: sends.length,
      successful_send_count: successful.length,
      failed_send_count: sends.length - successful.length,
      total_coin_sent_successfully: successful
        .reduce((sum, send) => sum + Number(send.amount), 0)
        .toFixed(2),
    },
  };
}

export function toAdminDetailResponse(detail: AdminDetail) {
  const sendsByTopup = new Map<string, ManualTopupSend[]>();
  for (const send of detail.sends) {
    const list = sendsByTopup.get(send.manualTopupId) ?? [];
    list.push(send);
    sendsByTopup.set(send.manualTopupId, list);
  }
  return {
    ...toAdminOverview(detail),
    affiliates: detail.affiliates.map((affiliate) => ({
      profile_id: affiliate.id,
      name: affiliate.user.name,
      email: affiliate.user.email,
      status: affiliate.user.status,
      affiliate_code: affiliate.affiliateCode,
      created_at: affiliate.createdAt,
    })),
    manual_topups: detail.manualTopups.map((manualTopup) => ({
      ...toManualTopupResponse(manualTopup),
      sends: (sendsByTopup.get(manualTopup.id) ?? []).map(toSendResponse),
    })),
  };
}

const MANUAL_TOPUP_EXPORT_COLUMNS: [string, string][] = [
  ['id', 'Manual Top-up ID'],
  ['created_at', 'Created At (WIB)'],
  ['momo_user_id', 'Momo User ID'],
  ['customer_name', 'Customer Name'],
  ['total_amount', 'Total Amount'],
  ['amount_per_send', 'Amount per Send'],
  ['amount_sent', 'Amount Sent'],
  ['interval_minutes', 'Interval (minutes)'],
  ['status', 'Status'],
  ['created_by', 'Created By (user ID)'],
];

const ADMIN_TRANSFER_EXPORT_COLUMNS: [string, string][] = [
  ['id', 'Send ID'],
  ['sent_at', 'Sent At (WIB)'],
  ['manual_topup_id', 'Manual Top-up ID'],
  ['momo_user_id', 'Momo User ID'],
  ['customer_name', 'Customer Name'],
  ['amount', 'Amount'],
  ['status', 'Status'],
  ['admin_name', 'Admin Name'],
  ['admin_email', 'Admin Email'],
];
