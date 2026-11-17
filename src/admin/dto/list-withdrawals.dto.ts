import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { WithdrawalMethod } from '../../affiliates/entities/commission-withdrawal.entity';
import { WITHDRAWAL_STATUS_FILTERS } from '../../affiliates/withdrawal.util';

export class ListWithdrawalsDto {
  /**
   * A tab: pending, processing (approved), success (paid), failed (failed +
   * rejected). Older aliases (approval) and stored statuses are accepted too.
   */
  @IsOptional()
  @IsIn(Object.keys(WITHDRAWAL_STATUS_FILTERS))
  status?: string;

  /** bank or momo_coin */
  @IsOptional()
  @IsEnum(WithdrawalMethod)
  method?: WithdrawalMethod;

  /** Partial match on name, email, account number, bank name or Momo ID. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  affiliator_id?: string;

  /** Inclusive, YYYY-MM-DD, Asia/Jakarta, on created_at. */
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
