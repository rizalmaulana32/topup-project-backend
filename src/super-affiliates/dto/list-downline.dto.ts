import { Type } from 'class-transformer';
import {
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

/**
 * No default limit on purpose: without `limit` the SA dashboard lists keep
 * returning the old plain array so an older frontend doesn't break; with it
 * they return { items, total, limit, offset }.
 */
class PageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListDownlineDto extends PageDto {
  /** Partial, case-insensitive: name, email, affiliate code, affiliator ID. */
  @IsOptional()
  @IsString()
  search?: string;
}

export class ListOwnWithdrawalsDto extends PageDto {
  /** Same tabs as GET /admin/withdrawals: pending, processing, success, failed. */
  @IsOptional()
  @IsIn(Object.keys(WITHDRAWAL_STATUS_FILTERS))
  status?: string;

  @IsOptional()
  @IsEnum(WithdrawalMethod)
  method?: WithdrawalMethod;
}
