import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { UserRole } from '../users/entities/user.entity';
import { ListTransferHistoryDto } from './dto/list-transfer-history.dto';
import { toTransferResponse } from './manual-topup.controller';
import { ManualTopupService } from './manual-topup.service';

type AuthedRequest = Request & { user: AuthenticatedUser };

/**
 * Manual transaction history for the affiliate and super-affiliate portals:
 * sends of manual top-ups made under the caller's own affiliate code
 * (affiliate) or any downline affiliate's code (super affiliate). Lives here
 * because ManualTopupModule already depends on both affiliate modules.
 */
@ApiTags('manual-history')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ManualHistoryController {
  constructor(private readonly manualTopupService: ManualTopupService) {}

  @Get('affiliate/manual-transactions')
  @Roles(UserRole.AFFILIATOR)
  @ApiOperation({
    summary:
      'Manual top-up sends made with your affiliate code, newest first, filterable by status',
  })
  affiliate(@Query() query: ListTransferHistoryDto, @Req() req: AuthedRequest) {
    return this.list(query, req.user.id, UserRole.AFFILIATOR);
  }

  @Get('super-affiliate/manual-transactions')
  @Roles(UserRole.SUPER_AFFILIATE)
  @ApiOperation({
    summary:
      "Manual top-up sends made with any downline affiliate's code, newest first, filterable by status",
  })
  superAffiliate(
    @Query() query: ListTransferHistoryDto,
    @Req() req: AuthedRequest,
  ) {
    return this.list(query, req.user.id, UserRole.SUPER_AFFILIATE);
  }

  private async list(
    query: ListTransferHistoryDto,
    userId: string,
    role: UserRole.AFFILIATOR | UserRole.SUPER_AFFILIATE,
  ) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const referralCodes = await this.manualTopupService.referralCodesForUser(
      userId,
      role,
    );
    const result = await this.manualTopupService.findSends(
      { referralCodes },
      { status: query.status, limit, offset },
    );
    return {
      success: true,
      data: {
        // Raw provider payload and the sending admin's user id stay internal.
        items: result.items.map((item) => {
          const row: Partial<ReturnType<typeof toTransferResponse>> =
            toTransferResponse(item);
          delete row.provider_response;
          delete row.created_by;
          return row;
        }),
        total: result.total,
        limit,
        offset,
      },
    };
  }
}
