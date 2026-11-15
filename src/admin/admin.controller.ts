import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { toJakartaTime, toXlsxFile } from '../common/utils/xlsx.util';
import {
  AffiliatesService,
  toLinkedAdmin,
  toLinkedSuperAffiliate,
} from '../affiliates/affiliates.service';
import {
  CommissionWithdrawal,
  WithdrawalMethod,
  WithdrawalStatus,
} from '../affiliates/entities/commission-withdrawal.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/types/jwt-payload';
import { BonusTiersService } from '../bonus-tiers/bonus-tiers.service';
import { BonusTier } from '../bonus-tiers/entities/bonus-tier.entity';
import { ContactService } from '../contact/contact.service';
import { LinkQuService } from '../linkqu/linkqu.service';
import { PlatformService } from '../platform/platform.service';
import { PROVIDER_TOP_UP_PORT } from '../provider/provider-top-up.port';
import type {
  CheckIdResult,
  ProviderTopUpPort,
} from '../provider/provider-top-up.port';
import { SettingsService } from '../settings/settings.service';
import { TopupService } from '../topup/topup.service';
import { PaymentStatus } from '../transactions/entities/transaction.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { UserRole } from '../users/entities/user.entity';
import { AdjustCommissionBalanceDto } from './dto/adjust-commission-balance.dto';
import { ApproveAffiliateDto } from './dto/approve-affiliate.dto';
import { CommissionSummaryDto } from './dto/commission-summary.dto';
import { CreateBonusTierDto } from './dto/create-bonus-tier.dto';
import { ListAffiliatesDto } from './dto/list-affiliates.dto';
import { ListContactMessagesDto } from './dto/list-contact-messages.dto';
import { ListPlatformWithdrawalsDto } from '../platform/dto/list-platform-withdrawals.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { ListWithdrawalsDto } from './dto/list-withdrawals.dto';
import { MoveUplineDto } from './dto/move-upline.dto';
import { PlatformWithdrawDto } from '../platform/dto/platform-withdraw.dto';
import { ProcessWithdrawalDto } from './dto/process-withdrawal.dto';
import { UpdateReferralCodeDto } from './dto/update-referral-code.dto';
import { ProviderCoinTransferDto } from './dto/provider-coin-transfer.dto';
import { ResetAffiliatePasswordDto } from './dto/reset-affiliate-password.dto';
import { SetTieredCommissionDto } from './dto/set-tiered-commission.dto';
import { UpdateCommissionRateDto } from './dto/update-commission-rate.dto';
import { UpdateBonusTierDto } from './dto/update-bonus-tier.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly affiliatesService: AffiliatesService,
    private readonly settingsService: SettingsService,
    private readonly transactionsService: TransactionsService,
    private readonly contactService: ContactService,
    @Inject(PROVIDER_TOP_UP_PORT)
    private readonly providerTopUp: ProviderTopUpPort,
    private readonly linkQuService: LinkQuService,
    private readonly platformService: PlatformService,
    private readonly topupService: TopupService,
    private readonly configService: ConfigService,
    private readonly bonusTiersService: BonusTiersService,
  ) {}

  @Get('affiliates')
  @ApiOperation({
    summary:
      'List affiliate registrations. Each item has period_stats - paid referred transactions, their gross amount and commission credited within date_from..date_to (YYYY-MM-DD, inclusive; e.g. periode 1 = 01-15, periode 2 = 16-end of month). Without dates, period_stats covers all time. With date_from and/or date_to, commission_balance is the commission earned in that range; the actual balance is always in current_commission_balance.',
  })
  async listAffiliates(@Query() query: ListAffiliatesDto) {
    if (query.date_from && query.date_to && query.date_from > query.date_to) {
      throw new BadRequestException('date_from must not be after date_to');
    }
    const result = await this.affiliatesService.findAllProfiles({
      status: query.status,
      adminProfileId: query.admin_profile_id,
      superAffiliateProfileId: query.super_affiliate_id,
      search: query.search,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    const hasPeriod = Boolean(query.date_from || query.date_to);
    const periodStats = await this.affiliatesService.getPeriodStats(
      result.items.map((profile) => profile.id),
      { dateFrom: query.date_from, dateTo: query.date_to },
    );
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
          admin: toLinkedAdmin(profile.adminProfile),
          super_affiliate: toLinkedSuperAffiliate(
            profile.superAffiliateProfile,
          ),
          phone_number: profile.phoneNumber,
          commission_rate: profile.commissionRate,
          // With a date range, commission_balance is the commission earned from
          // that range's transactions (client request); the real balance stays
          // available as current_commission_balance.
          commission_balance: hasPeriod
            ? (periodStats.get(profile.id)?.commission ?? '0.00')
            : profile.commissionBalance,
          current_commission_balance: profile.commissionBalance,
          period_stats: {
            transaction_count:
              periodStats.get(profile.id)?.transactionCount ?? 0,
            gross_amount: periodStats.get(profile.id)?.grossAmount ?? '0.00',
            commission: periodStats.get(profile.id)?.commission ?? '0.00',
          },
          created_at: profile.createdAt,
        })),
        period: {
          date_from: query.date_from ?? null,
          date_to: query.date_to ?? null,
        },
        total: result.total,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    };
  }

  @Get('affiliates/:id')
  @ApiOperation({
    summary:
      'Full detail on one affiliate - profile, bank/contact info, commission settings, referred-transaction and commission/withdrawal history',
  })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response.',
  })
  async getAffiliateDetail(@Param('id') id: string) {
    const data = await this.affiliatesService.getAdminAffiliateDetail(id);
    return { success: true, data };
  }

  @Post('affiliates/:id/approve')
  @ApiOperation({
    summary:
      "Approve an affiliate and generate their referral code - optionally pass referral_code to use a custom one instead of auto-generating (must be unique). Also usable to REACTIVATE a previously-rejected affiliate (keeps the affiliate's existing code unless referral_code overrides it).",
  })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response, listed side by side with user_id.',
  })
  async approveAffiliate(
    @Param('id') id: string,
    @Body() dto: ApproveAffiliateDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const profile = await this.affiliatesService.approve(
      id,
      request.user.id,
      dto.referral_code,
    );
    return {
      success: true,
      data: {
        profile_id: profile.id,
        affiliate_code: profile.affiliateCode,
        approved_at: profile.approvedAt,
      },
    };
  }

  @Patch('affiliates/:id/upline')
  @ApiOperation({
    summary:
      'Move an affiliate under another admin or super affiliate by its referral_code, or detach with referral_code: null. An affiliate has one upline only; only future transactions are affected.',
  })
  @ApiParam({
    name: 'id',
    description: 'The affiliate PROFILE ID (not user_id).',
  })
  async moveAffiliateUpline(
    @Param('id') id: string,
    @Body() dto: MoveUplineDto,
  ) {
    const profile = await this.affiliatesService.moveUpline(
      id,
      dto.referral_code,
    );
    return {
      success: true,
      data: {
        profile_id: profile.id,
        admin: toLinkedAdmin(profile.adminProfile),
        super_affiliate: toLinkedSuperAffiliate(profile.superAffiliateProfile),
      },
    };
  }

  @Patch('affiliates/:id/referral-code')
  @ApiOperation({
    summary:
      "Change an affiliate's referral code directly, without affecting approval status/date (unlike POST .../approve, which would overwrite approved_by/approved_at)",
  })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response, listed side by side with user_id.',
  })
  async updateAffiliateReferralCode(
    @Param('id') id: string,
    @Body() dto: UpdateReferralCodeDto,
  ) {
    const profile = await this.affiliatesService.updateReferralCode(
      id,
      dto.referral_code,
    );
    return {
      success: true,
      data: {
        profile_id: profile.id,
        affiliate_code: profile.affiliateCode,
      },
    };
  }

  @Post('affiliates/:id/reject')
  @ApiOperation({
    summary:
      'Reject a pending affiliate registration. Also usable to DEACTIVATE an already-approved/active affiliate at any time (sets status to inactive) - use POST .../approve on the same profile_id to reactivate them later.',
  })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response, listed side by side with user_id.',
  })
  async rejectAffiliate(@Param('id') id: string) {
    await this.affiliatesService.reject(id);
    return { success: true };
  }

  @Delete('affiliates/:id')
  @ApiOperation({
    summary:
      'Soft-delete an affiliate (hidden from listings and dashboard access, underlying user deactivated; not removed from the database - historical commission/withdrawal records referencing this affiliate remain intact and traceable)',
  })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response, listed side by side with user_id.',
  })
  async deleteAffiliate(@Param('id') id: string) {
    await this.affiliatesService.softDelete(id);
    return { success: true };
  }

  @Patch('affiliates/:id/commission-rate')
  @ApiOperation({ summary: "Override one affiliate's commission rate" })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response, listed side by side with user_id.',
  })
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

  @Patch('affiliates/:id/commission-balance')
  @ApiOperation({
    summary:
      "Manually add to or deduct from one affiliate's commission balance - amount is added, pass a negative number to deduct",
  })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response.',
  })
  async adjustAffiliateCommissionBalance(
    @Param('id') id: string,
    @Body() dto: AdjustCommissionBalanceDto,
  ) {
    const profile = await this.affiliatesService.adjustCommissionBalance(
      id,
      dto.amount,
      dto.reason,
    );
    return {
      success: true,
      data: {
        profile_id: profile.id,
        commission_balance: profile.commissionBalance,
        total_commission_earned: profile.totalCommissionEarned,
      },
    };
  }

  @Patch('affiliates/:id/tiered-commission')
  @ApiOperation({
    summary:
      'Switch an affiliate between flat commission_rate and the opt-in 1% below Rp 10jt / 5% above Rp 10jt monthly-volume tiers',
  })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response.',
  })
  async setAffiliateTieredCommission(
    @Param('id') id: string,
    @Body() dto: SetTieredCommissionDto,
  ) {
    const profile = await this.affiliatesService.setTieredCommissionEnabled(
      id,
      dto.enabled,
    );
    return {
      success: true,
      data: {
        profile_id: profile.id,
        tiered_commission_enabled: profile.tieredCommissionEnabled,
        current_period_month: profile.currentPeriodMonth,
        current_period_volume: profile.currentPeriodVolume,
      },
    };
  }

  @Post('affiliates/:id/reset-password')
  @ApiOperation({
    summary:
      "Reset a locked-out affiliate's password (no self-service forgot-password flow exists yet)",
  })
  @ApiParam({
    name: 'id',
    description:
      'The affiliate PROFILE ID (not user_id) - see profile_id in the GET /admin/affiliates response.',
  })
  async resetAffiliatePassword(
    @Param('id') id: string,
    @Body() dto: ResetAffiliatePasswordDto,
  ) {
    await this.affiliatesService.resetPassword(id, dto.new_password);
    return { success: true };
  }

  @Get('settings')
  @ApiOperation({
    summary: 'View global commission rate + minimum withdrawal amount',
  })
  async getSettings() {
    const settings = await this.settingsService.get();
    return {
      success: true,
      data: {
        global_commission_rate: settings.globalCommissionRate,
        minimum_withdrawal_amount: settings.minimumWithdrawalAmount,
        custom_amount_margin_rate: settings.customAmountMarginRate,
        custom_amount_extra_coin_enabled: settings.customAmountExtraCoinEnabled,
        customer_discount_rate: settings.customerDiscountRate,
        customer_discount_min_amount: settings.customerDiscountMinAmount,
        withdrawal_admin_fee: settings.withdrawalAdminFee,
        admin_bank_name: settings.adminBankName,
        admin_account_number: settings.adminAccountNumber,
        admin_account_holder: settings.adminAccountHolder,
        manual_qris_enabled: settings.manualQrisEnabled,
        has_manual_qris: settings.manualQrisMimeType !== null,
      },
    };
  }

  @Patch('settings')
  @ApiOperation({
    summary:
      'Update global commission rate / minimum withdrawal amount / admin payout bank details',
  })
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    const settings = await this.settingsService.update({
      globalCommissionRate: dto.global_commission_rate,
      minimumWithdrawalAmount: dto.minimum_withdrawal_amount,
      customAmountMarginRate: dto.custom_amount_margin_rate,
      customAmountExtraCoinEnabled: dto.custom_amount_extra_coin_enabled,
      customerDiscountRate: dto.customer_discount_rate,
      customerDiscountMinAmount: dto.customer_discount_min_amount,
      withdrawalAdminFee: dto.withdrawal_admin_fee,
      adminBankName: dto.admin_bank_name,
      adminAccountNumber: dto.admin_account_number,
      adminAccountHolder: dto.admin_account_holder,
      manualQrisEnabled: dto.manual_qris_enabled,
    });
    return {
      success: true,
      data: {
        global_commission_rate: settings.globalCommissionRate,
        minimum_withdrawal_amount: settings.minimumWithdrawalAmount,
        custom_amount_margin_rate: settings.customAmountMarginRate,
        custom_amount_extra_coin_enabled: settings.customAmountExtraCoinEnabled,
        customer_discount_rate: settings.customerDiscountRate,
        customer_discount_min_amount: settings.customerDiscountMinAmount,
        withdrawal_admin_fee: settings.withdrawalAdminFee,
        admin_bank_name: settings.adminBankName,
        admin_account_number: settings.adminAccountNumber,
        admin_account_holder: settings.adminAccountHolder,
        manual_qris_enabled: settings.manualQrisEnabled,
        has_manual_qris: settings.manualQrisMimeType !== null,
      },
    };
  }

  @Get('settings/manual-qris')
  @ApiOperation({
    summary:
      'Preview the uploaded manual QRIS image (served even while manual_qris_enabled is off). 404 if none uploaded.',
  })
  @Header('X-Content-Type-Options', 'nosniff')
  async getManualQris(): Promise<StreamableFile> {
    const qris = await this.settingsService.getManualQris();
    if (!qris) {
      throw new NotFoundException('No manual QRIS uploaded');
    }
    return new StreamableFile(qris.image, { type: qris.mimeType });
  }

  @Post('settings/manual-qris')
  @ApiOperation({
    summary:
      'Upload/replace the manual QRIS image (multipart field `file`, PNG/JPEG/WebP, max 2MB). Show/hide it with PATCH /admin/settings { manual_qris_enabled }.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  async uploadManualQris(@UploadedFile() file?: { buffer: Buffer }) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const settings = await this.settingsService.setManualQris(file.buffer);
    return {
      success: true,
      data: {
        manual_qris_enabled: settings.manualQrisEnabled,
        has_manual_qris: settings.manualQrisMimeType !== null,
      },
    };
  }

  @Delete('settings/manual-qris')
  @ApiOperation({
    summary:
      'Remove the manual QRIS image (also sets manual_qris_enabled to false)',
  })
  async deleteManualQris() {
    const settings = await this.settingsService.clearManualQris();
    return {
      success: true,
      data: {
        manual_qris_enabled: settings.manualQrisEnabled,
        has_manual_qris: settings.manualQrisMimeType !== null,
      },
    };
  }

  @Get('bonus-tiers')
  @ApiOperation({
    summary:
      'List custom-amount bonus tiers (min_amount inclusive, max_amount exclusive, null = no upper bound), ordered by min_amount',
  })
  async listBonusTiers() {
    const tiers = await this.bonusTiersService.findAll();
    return { success: true, data: tiers.map(toBonusTierResponse) };
  }

  @Post('bonus-tiers')
  @ApiOperation({
    summary:
      'Add a bonus tier: bonus = floor(amount x bonus_percent / 100) for min_amount <= amount < max_amount. Rejected with 400 if it overlaps any other tier, inactive ones included.',
  })
  async createBonusTier(@Body() dto: CreateBonusTierDto) {
    const tier = await this.bonusTiersService.create({
      minAmount: dto.min_amount,
      maxAmount: dto.max_amount,
      bonusPercent: dto.bonus_percent,
      isActive: dto.is_active,
    });
    return { success: true, data: toBonusTierResponse(tier) };
  }

  @Patch('bonus-tiers/:id')
  @ApiOperation({
    summary:
      'Edit a bonus tier (all fields optional; max_amount: null removes the upper bound)',
  })
  async updateBonusTier(
    @Param('id') id: string,
    @Body() dto: UpdateBonusTierDto,
  ) {
    const tier = await this.bonusTiersService.update(id, {
      minAmount: dto.min_amount,
      maxAmount: dto.max_amount,
      bonusPercent: dto.bonus_percent,
      isActive: dto.is_active,
    });
    return { success: true, data: toBonusTierResponse(tier) };
  }

  @Delete('bonus-tiers/:id')
  @ApiOperation({ summary: 'Delete a bonus tier' })
  async deleteBonusTier(@Param('id') id: string) {
    await this.bonusTiersService.remove(id);
    return { success: true };
  }

  @Get('commission-summary')
  @ApiOperation({
    summary:
      "Commission overview for one affiliate (affiliator_id = affiliate profile ID, required): commission balance, total commission ever earned, the month's periode 1 (1-15) and periode 2 (16-end) for `month` (YYYY-MM, default current), and an optional date_from..date_to range (YYYY-MM-DD, inclusive). Period figures count referral commission credits only.",
  })
  async commissionSummary(@Query() query: CommissionSummaryDto) {
    if (query.date_from && query.date_to && query.date_from > query.date_to) {
      throw new BadRequestException('date_from must not be after date_to');
    }
    const data = await this.affiliatesService.getCommissionSummary(
      query.affiliator_id,
      { month: query.month, dateFrom: query.date_from, dateTo: query.date_to },
    );
    return { success: true, data };
  }

  @Get('withdrawals/export')
  @ApiOperation({
    summary:
      'Download the successful (paid) commission withdrawals as an .xlsx file. Filters: method and search, as in GET /withdrawals; status is always paid, and limit/offset are ignored (max 10000 rows, newest first). Built in memory per request, nothing is stored on the server.',
  })
  async exportWithdrawals(
    @Query() query: ListWithdrawalsDto,
  ): Promise<StreamableFile> {
    const result = await this.affiliatesService.findAllWithdrawals({
      // Only successful withdrawals are exported (client request, 2026-11-07).
      status: WithdrawalStatus.PAID,
      method: query.method,
      search: query.search,
      limit: 10000,
      offset: 0,
    });
    return toXlsxFile(
      'withdrawals',
      WITHDRAWAL_EXPORT_COLUMNS,
      result.items.map((withdrawal) => {
        const item = toWithdrawalItem(withdrawal, result.momoUsers);
        return {
          ...item,
          amount: Number(item.amount),
          admin_fee: Number(item.admin_fee),
          net_amount: Number(item.net_amount),
          created_at: toJakartaTime(item.created_at),
          approved_at: toJakartaTime(item.approved_at),
          processed_at: toJakartaTime(item.processed_at),
        };
      }),
    );
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'List commission withdrawal requests' })
  async listWithdrawals(@Query() query: ListWithdrawalsDto) {
    const result = await this.affiliatesService.findAllWithdrawals({
      status: query.status,
      method: query.method,
      search: query.search,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      success: true,
      data: {
        items: result.items.map((withdrawal) =>
          toWithdrawalItem(withdrawal, result.momoUsers),
        ),
        total: result.total,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    };
  }

  @Post('withdrawals/:id/approve')
  @ApiOperation({
    summary:
      'Approve a withdrawal request (pending -> approved). Nothing is sent here; use /process afterward. Transfer the funds / send the Momo coins manually, then /process marks it paid.',
  })
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
        method: withdrawal.method,
        status: withdrawal.status,
        approved_by: withdrawal.approvedBy,
        approved_at: withdrawal.approvedAt,
        processed_at: withdrawal.processedAt,
      },
    };
  }

  @Post('withdrawals/:id/process')
  @ApiOperation({
    summary:
      'Mark an approved withdrawal as paid, once only (409 after). For both bank and momo_coin the admin pays out manually first (bank transfer / MomoLive); nothing is sent from here.',
  })
  async processWithdrawal(
    @Param('id') id: string,
    @Body() dto: ProcessWithdrawalDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const withdrawal = await this.affiliatesService.markWithdrawalProcessed(
      id,
      request.user.id,
      dto.notes,
    );
    return {
      success: true,
      data: {
        withdrawal_id: withdrawal.id,
        status: withdrawal.status,
        processed_by: withdrawal.processedBy,
        processed_at: withdrawal.processedAt,
        admin_notes: withdrawal.adminNotes,
      },
    };
  }

  @Post('withdrawals/:id/reject')
  @ApiOperation({
    summary:
      'Reject a withdrawal before it is sent to LinkQu and refund the locked balance',
  })
  async rejectWithdrawal(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const withdrawal = await this.affiliatesService.rejectWithdrawal(
      id,
      request.user.id,
    );
    return {
      success: true,
      data: {
        withdrawal_id: withdrawal.id,
        status: withdrawal.status,
      },
    };
  }

  @Get('transactions/totals')
  @ApiOperation({
    summary:
      "Two customer-paid totals for the superadmin dashboard (sum across all paid transactions) - frontend picks which to display. gross_total is the product/nominal price only; total_with_fee includes LinkQu's real admin fee, i.e. what customers actually paid out of pocket.",
  })
  async getTransactionTotals() {
    const data = await this.transactionsService.getPaidTotals();
    return {
      success: true,
      data: {
        gross_total: data.grossTotal,
        total_with_fee: data.totalWithFee,
      },
    };
  }

  @Get('transactions/export')
  @ApiOperation({
    summary:
      'Download the successful (paid) transactions as an .xlsx file. Filters: date_from/date_to, referral_code, amount_min/amount_max, as in GET /transactions; status is always paid, and limit/offset are ignored (max 10000 rows, newest first). Built in memory per request, nothing is stored on the server.',
  })
  async exportTransactions(
    @Query() query: ListTransactionsDto,
  ): Promise<StreamableFile> {
    const result = await this.transactionsService.findAll({
      // Only successful transactions are exported (client request, 2026-11-07).
      status: PaymentStatus.PAID,
      dateFrom: query.date_from,
      dateTo: query.date_to,
      referralCode: query.referral_code,
      amountMin: query.amount_min,
      amountMax: query.amount_max,
      limit: 10000,
      offset: 0,
    });
    const toNumber = (value: string | null) =>
      value === null ? null : Number(value);
    return toXlsxFile(
      'transactions',
      TRANSACTION_EXPORT_COLUMNS,
      result.items.map((t) => ({
        id: t.id,
        created_at: toJakartaTime(t.createdAt),
        paid_at: toJakartaTime(t.paidAt),
        completed_at: toJakartaTime(t.completedAt),
        product: t.product?.name ?? null,
        coin_amount: toNumber(t.coinAmount),
        target_user_id: t.targetUserId,
        referral_code: t.referralCode,
        gross_amount: toNumber(t.grossAmount),
        customer_discount_amount: toNumber(t.customerDiscountAmount),
        affiliate_commission: toNumber(t.affiliateCommission),
        provider_fee: toNumber(t.providerFee),
        cost_basis: toNumber(t.costBasis),
        payment_status: t.paymentStatus,
        provider_status: t.providerStatus,
        linkqu_reference: t.linkQuReference,
      })),
    );
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Monitor transactions' })
  async listTransactions(@Query() query: ListTransactionsDto) {
    const result = await this.transactionsService.findAll({
      status: query.status,
      dateFrom: query.date_from,
      dateTo: query.date_to,
      referralCode: query.referral_code,
      amountMin: query.amount_min,
      amountMax: query.amount_max,
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

  @Post('transactions/:id/simulate-paid')
  @ApiOperation({
    summary:
      'Testing-only: mark a pending transaction as paid and run the real coin-injection/commission/revenue pipeline, without a real LinkQu payment. Disabled unless ALLOW_PAYMENT_SIMULATION=true is set on the server.',
  })
  @ApiParam({
    name: 'id',
    description: 'The transaction ID, e.g. TRX-20261002-6498',
  })
  async simulatePaidTransaction(@Param('id') id: string) {
    if (this.configService.get<string>('ALLOW_PAYMENT_SIMULATION') !== 'true') {
      throw new ForbiddenException(
        'Payment simulation is disabled on this server (set ALLOW_PAYMENT_SIMULATION=true to enable).',
      );
    }

    await this.topupService.handleInvoicePaid(id);
    return { success: true };
  }

  @Get('contact-messages')
  @ApiOperation({ summary: 'List support/partnership messages' })
  async listContactMessages(@Query() query: ListContactMessagesDto) {
    const result = await this.contactService.findAll({
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

  @Post('contact-messages/:id/resolve')
  @ApiOperation({ summary: 'Mark a support/partnership message resolved' })
  async resolveContactMessage(@Param('id') id: string) {
    const message = await this.contactService.markResolved(id);
    return { success: true, data: message };
  }

  @Delete('contact-messages/:id')
  @ApiOperation({
    summary:
      'Soft-delete a contact message (hidden from listings, not removed from the database)',
  })
  async deleteContactMessage(@Param('id') id: string) {
    await this.contactService.softDelete(id);
    return { success: true };
  }

  @Get('provider/balance')
  @ApiOperation({
    summary:
      "Check the merchant's remaining coin balance with the Provider Top-Up vendor",
  })
  async getProviderBalance() {
    const balance = await this.providerTopUp.getBalance();
    return { success: true, data: { balance } };
  }

  @Get('linkqu/balance')
  @ApiOperation({
    summary:
      "Check the merchant's LinkQu account balance - saldo_simpanan is LinkQu's own available/withdrawable balance, saldo_ditahan is pending settlement (see LinkQu's 'Data Saya' page for the same two figures)",
  })
  async getLinkQuBalance() {
    const result = await this.linkQuService.checkBalance();
    return {
      success: result.success,
      data: {
        balance: result.balance,
        saldo_simpanan: result.balance,
        unsettle_amount: result.unsettleAmount,
        saldo_ditahan: result.unsettleAmount,
        unsettle_data: result.unsettleData.map((item) => ({
          transaction_date: item.transactionDate,
          settlement_date: item.settlementDate,
          settlement_amount: item.settlementAmount,
          product_name: item.productName,
        })),
        response_code: result.responseCode,
        response_desc: result.responseDesc,
      },
    };
  }

  @Post('provider/coin-transfer')
  @ApiOperation({
    summary:
      'Manually transfer coins to a player via the Provider Top-Up vendor (support/compensation use only, bypasses payment)',
  })
  async transferProviderCoin(
    @Body() dto: ProviderCoinTransferDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    this.logger.warn(
      `Manual coin transfer by admin ${request.user.id}: ${dto.coin} coin(s) to target_user_id=${dto.target_user_id} target_zone_id=${dto.target_zone_id ?? 'none'} - reason: ${dto.reason}`,
    );

    const result = await this.providerTopUp.injectCoin({
      productProviderCode: 'ADMIN_MANUAL_TRANSFER',
      targetUserId: dto.target_user_id,
      targetZoneId: dto.target_zone_id,
      coin: dto.coin,
    });
    if (result.duplicate) {
      throw new ConflictException(result.response);
    }

    return {
      success: result.success,
      data: {
        target_user_id: dto.target_user_id,
        coin: dto.coin,
        provider_response: result.response,
      },
    };
  }

  @Get('platform/balance')
  @ApiOperation({
    summary:
      "Check the platform's own accumulated revenue balance (sellingPrice - basePrice - commission, credited per paid transaction)",
  })
  async getPlatformBalance() {
    const balance = await this.platformService.getBalance();
    return { success: true, data: { balance } };
  }

  @Post('platform/withdraw')
  @ApiOperation({
    summary:
      "Request a withdrawal from the platform's own revenue balance to the admin payout account on file (set via PATCH /admin/settings)",
  })
  async requestPlatformWithdrawal(
    @Body() dto: PlatformWithdrawDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const withdrawal = await this.platformService.requestWithdrawal(
      dto.amount,
      request.user.id,
    );
    return {
      success: true,
      data: {
        withdrawal_id: withdrawal.id,
        amount: withdrawal.amount,
        status: withdrawal.status,
      },
    };
  }

  @Post('platform/withdrawals/:id/approve')
  @ApiOperation({
    summary:
      'Approve a platform withdrawal — triggers a real LinkQu disbursement to the admin payout account',
  })
  async approvePlatformWithdrawal(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const withdrawal = await this.platformService.approveWithdrawal(
      id,
      request.user.id,
    );
    return {
      success: true,
      data: {
        withdrawal_id: withdrawal.id,
        status: withdrawal.status,
        linkqu_disbursement_id: withdrawal.linkQuDisbursementId,
      },
    };
  }

  @Post('platform/withdrawals/:id/reject')
  @ApiOperation({
    summary:
      'Reject a platform withdrawal before it is sent to LinkQu and refund the locked balance',
  })
  async rejectPlatformWithdrawal(
    @Param('id') id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    const withdrawal = await this.platformService.rejectWithdrawal(
      id,
      request.user.id,
    );
    return {
      success: true,
      data: {
        withdrawal_id: withdrawal.id,
        status: withdrawal.status,
      },
    };
  }

  @Get('platform/withdrawals')
  @ApiOperation({ summary: 'List platform withdrawal requests' })
  async listPlatformWithdrawals(@Query() query: ListPlatformWithdrawalsDto) {
    const result = await this.platformService.findAllWithdrawals({
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
}

/** One withdrawal as GET /admin/withdrawals returns it (also the export's rows). */
function toWithdrawalItem(
  withdrawal: CommissionWithdrawal,
  momoUsers: Map<string, CheckIdResult | null>,
) {
  const momoUser = withdrawal.momoUserId
    ? momoUsers.get(withdrawal.momoUserId)
    : null;
  return {
    id: withdrawal.id,
    affiliator_id: withdrawal.affiliatorId,
    affiliator_name: withdrawal.affiliator?.user?.name ?? null,
    affiliator_email: withdrawal.affiliator?.user?.email ?? null,
    amount: withdrawal.amount,
    admin_fee: withdrawal.adminFee,
    net_amount: withdrawal.netAmount,
    method: withdrawal.method,
    momo_user_id: withdrawal.momoUserId,
    momo_username: momoUser?.username ?? null,
    momo_avatar_url: momoUser?.avatarUrl ?? null,
    coin_amount:
      withdrawal.method === WithdrawalMethod.MOMO_COIN
        ? withdrawal.netAmount
        : null,
    bank_name: withdrawal.bankName,
    account_number: withdrawal.accountNumber,
    account_holder: withdrawal.accountHolder,
    status: withdrawal.status,
    admin_notes: withdrawal.adminNotes,
    approved_by: withdrawal.approvedBy,
    approved_at: withdrawal.approvedAt,
    processed_by: withdrawal.processedBy,
    processed_at: withdrawal.processedAt,
    created_at: withdrawal.createdAt,
  };
}

const WITHDRAWAL_EXPORT_COLUMNS: [string, string][] = [
  ['id', 'Withdrawal ID'],
  ['created_at', 'Created At (WIB)'],
  ['affiliator_id', 'Affiliator ID'],
  ['affiliator_name', 'Affiliator Name'],
  ['affiliator_email', 'Affiliator Email'],
  ['method', 'Method'],
  ['status', 'Status'],
  ['amount', 'Amount'],
  ['admin_fee', 'Admin Fee'],
  ['net_amount', 'Net Amount'],
  ['momo_user_id', 'Momo User ID'],
  ['momo_username', 'Momo Username'],
  ['bank_name', 'Bank'],
  ['account_number', 'Account Number'],
  ['account_holder', 'Account Holder'],
  ['admin_notes', 'Admin Notes'],
  ['approved_at', 'Approved At (WIB)'],
  ['processed_at', 'Processed At (WIB)'],
];

const TRANSACTION_EXPORT_COLUMNS: [string, string][] = [
  ['id', 'Transaction ID'],
  ['created_at', 'Created At (WIB)'],
  ['paid_at', 'Paid At (WIB)'],
  ['completed_at', 'Completed At (WIB)'],
  ['product', 'Product'],
  ['coin_amount', 'Coin Amount'],
  ['target_user_id', 'Target User ID'],
  ['referral_code', 'Referral Code'],
  ['gross_amount', 'Gross Amount'],
  ['customer_discount_amount', 'Customer Discount'],
  ['affiliate_commission', 'Affiliate Commission'],
  ['provider_fee', 'Provider Fee'],
  ['cost_basis', 'Cost Basis'],
  ['payment_status', 'Payment Status'],
  ['provider_status', 'Provider Status'],
  ['linkqu_reference', 'LinkQu Reference'],
];

function toBonusTierResponse(tier: BonusTier) {
  return {
    id: Number(tier.id),
    min_amount: tier.minAmount,
    max_amount: tier.maxAmount,
    bonus_percent: tier.bonusPercent,
    is_active: tier.isActive,
  };
}
