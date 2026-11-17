import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UpdateBankDetailsDto } from '../affiliates/dto/update-bank-details.dto';
import { WithdrawDto } from '../affiliates/dto/withdraw.dto';
import { WithdrawalMethod } from '../affiliates/entities/commission-withdrawal.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { UserRole } from '../users/entities/user.entity';
import { ListCommissionsDto } from './dto/list-commissions.dto';
import {
  ListDownlineDto,
  ListOwnWithdrawalsDto,
} from './dto/list-downline.dto';
import { WITHDRAWAL_STATUS_FILTERS } from '../affiliates/withdrawal.util';
import { SuperAffiliatesService } from './super-affiliates.service';

type AuthedRequest = Request & { user: AuthenticatedUser };

@ApiTags('super-affiliate')
@ApiBearerAuth()
@Controller('super-affiliate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_AFFILIATE)
export class SuperAffiliatesController {
  constructor(private readonly service: SuperAffiliatesService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Profile, referral code, balance, commission rule, this month volume, downline_count',
  })
  async dashboard(@Req() req: AuthedRequest) {
    return {
      success: true,
      data: await this.service.getDashboard(req.user.id),
    };
  }

  @Get('affiliates')
  @ApiOperation({
    summary:
      'Downline affiliates with this month volume each. With limit: { items, total, limit, offset } and optional search (name, email, code, affiliator ID); without limit: the old plain array.',
  })
  async affiliates(@Query() query: ListDownlineDto, @Req() req: AuthedRequest) {
    if (query.limit === undefined) {
      return {
        success: true,
        data: await this.service.getOwnDownline(req.user.id),
      };
    }
    return {
      success: true,
      data: await this.service.getOwnDownlinePage(req.user.id, {
        search: query.search,
        limit: query.limit,
        offset: query.offset ?? 0,
      }),
    };
  }

  @Get('commissions')
  async commissions(
    @Query() query: ListCommissionsDto,
    @Req() req: AuthedRequest,
  ) {
    return {
      success: true,
      data: await this.service.getOwnCommissions(req.user.id, {
        dateFrom: query.date_from,
        dateTo: query.date_to,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      }),
    };
  }

  @Patch('bank-details')
  async updateBankDetails(
    @Body() dto: UpdateBankDetailsDto,
    @Req() req: AuthedRequest,
  ) {
    return {
      success: true,
      data: await this.service.updateOwnBankDetails(req.user.id, {
        bankName: dto.bank_name,
        accountNumber: dto.account_number,
        accountHolder: dto.account_holder,
        phoneNumber: dto.phone_number,
      }),
    };
  }

  @Post('withdrawals')
  @ApiOperation({
    summary:
      'Request a payout - same rules as affiliate withdrawals (minimum, admin fee, Momo ID check)',
  })
  async withdraw(@Body() dto: WithdrawDto, @Req() req: AuthedRequest) {
    const withdrawal = await this.service.requestWithdrawal(
      req.user.id,
      dto.amount,
      {
        method: dto.method ?? WithdrawalMethod.BANK,
        momoUserId: dto.momo_user_id,
      },
    );
    return {
      success: true,
      data: {
        withdrawal_id: withdrawal.id,
        method: withdrawal.method,
        momo_user_id: withdrawal.momoUserId,
        amount: withdrawal.amount,
        admin_fee: withdrawal.adminFee,
        net_amount: withdrawal.netAmount,
        status: withdrawal.status,
        message:
          'Pengajuan penarikan berhasil dibuat. Menunggu konfirmasi Superadmin.',
      },
    };
  }

  @Get('withdrawals')
  @ApiOperation({
    summary:
      'Own payout requests. With limit: { items, total, limit, offset } and optional status (pending, processing, success, failed) and method; without limit: the old plain array.',
  })
  async withdrawals(
    @Query() query: ListOwnWithdrawalsDto,
    @Req() req: AuthedRequest,
  ) {
    if (query.limit === undefined) {
      return {
        success: true,
        data: await this.service.getOwnWithdrawals(req.user.id),
      };
    }
    return {
      success: true,
      data: await this.service.getOwnWithdrawalsPage(req.user.id, {
        statuses: query.status
          ? WITHDRAWAL_STATUS_FILTERS[query.status]
          : undefined,
        method: query.method,
        limit: query.limit,
        offset: query.offset ?? 0,
      }),
    };
  }
}
