import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { UserRole } from '../users/entities/user.entity';
import { AffiliatesService } from './affiliates.service';
import { RegisterAffiliateDto } from './dto/register-affiliate.dto';
import { WithdrawDto } from './dto/withdraw.dto';

@Controller('affiliate')
export class AffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  @Post('register')
  async register(@Body() dto: RegisterAffiliateDto) {
    const data = await this.affiliatesService.register(dto);
    return { success: true, data };
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AFFILIATOR)
  async dashboard(@Req() request: Request & { user: AuthenticatedUser }) {
    const data = await this.affiliatesService.getDashboard(request.user.id);
    return { success: true, data };
  }

  @Post('withdraw')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AFFILIATOR)
  async withdraw(
    @Body() dto: WithdrawDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const withdrawal = await this.affiliatesService.requestWithdrawal(
      request.user.id,
      dto.amount,
    );
    return {
      success: true,
      data: {
        withdrawal_id: withdrawal.id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        message:
          'Pengajuan penarikan berhasil dibuat. Menunggu konfirmasi Superadmin.',
      },
    };
  }
}
