import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CommissionLogType } from '../entities/commission-log.entity';
import type { HistoryFilter } from '../history-filter.util';

/** Query for the affiliate transaction / commission history lists. */
export class ListHistoryDto {
  /** Partial, case-insensitive: username, Momo user ID, transaction ID (+ description, withdrawal ID for commissions). */
  @IsOptional()
  @IsString()
  search?: string;

  /** Transactions only: paid = paid/success/settlement, pending, expired = anything else. */
  @IsOptional()
  @IsIn(['paid', 'pending', 'expired'])
  status?: 'paid' | 'pending' | 'expired';

  /** Transactions only. */
  @IsOptional()
  @IsIn(['gateway', 'manual'])
  source?: 'gateway' | 'manual';

  /** Commissions only: credit or debit. */
  @IsOptional()
  @IsEnum(CommissionLogType)
  type?: CommissionLogType;

  /** YYYY-MM-DD, inclusive, Asia/Jakarta. */
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  /** 0 = Sunday ... 6 = Saturday, Asia/Jakarta. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount_max?: number;

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

export function toHistoryFilter(query: ListHistoryDto): HistoryFilter {
  return {
    search: query.search,
    status: query.status,
    source: query.source,
    type: query.type,
    dateFrom: query.date_from?.slice(0, 10),
    dateTo: query.date_to?.slice(0, 10),
    weekday: query.weekday,
    amountMin: query.amount_min,
    amountMax: query.amount_max,
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
  };
}
