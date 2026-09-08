import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
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
import { AffiliatesService } from './affiliates.service';
import { RegisterAffiliateDto } from './dto/register-affiliate.dto';
import { UpdateBankDetailsDto } from './dto/update-bank-details.dto';
import { WithdrawDto } from './dto/withdraw.dto';

@ApiTags('affiliate')
@Controller('affiliate')
export class AffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Sign up as an affiliate (starts pending approval)',
  })
  async register(@Body() dto: RegisterAffiliateDto) {
    const data = await this.affiliatesService.register(dto);
    return { success: true, data };
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AFFILIATOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Referral stats, commission balance, and commission history',
  })
  async dashboard(@Req() request: Request & { user: AuthenticatedUser }) {
    const data = await this.affiliatesService.getDashboard(request.user.id);
    return { success: true, data };
  }

  @Patch('bank-details')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AFFILIATOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add or update your own payout bank details',
  })
  async updateBankDetails(
    @Body() dto: UpdateBankDetailsDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const profile = await this.affiliatesService.updateBankDetails(
      request.user.id,
      {
        bankName: dto.bank_name,
        accountNumber: dto.account_number,
        accountHolder: dto.account_holder,
      },
    );
    return {
      success: true,
      data: {
        bank_name: profile.bankName,
        account_number: profile.accountNumber,
        account_holder: profile.accountHolder,
      },
    };
  }

  @Post('withdraw')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AFFILIATOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request a commission payout' })
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
