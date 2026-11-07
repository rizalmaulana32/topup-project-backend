import { IsDateString, IsOptional, Matches } from 'class-validator';

export class CommissionSummaryDto {
  /** Month (YYYY-MM) for period_1 (1-15) and period_2 (16-end); defaults to the current month. */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;

  /** Inclusive start (YYYY-MM-DD) of the custom range. */
  @IsOptional()
  @IsDateString()
  date_from?: string;

  /** Inclusive end (YYYY-MM-DD) of the custom range. */
  @IsOptional()
  @IsDateString()
  date_to?: string;

  /** Required. Affiliate profile ID (affiliator_id in GET /admin/withdrawals, profile_id in GET /admin/affiliates). */
  @Matches(/^\d+$/, { message: 'affiliator_id must be numeric' })
  affiliator_id: string;
}
