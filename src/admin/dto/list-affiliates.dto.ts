import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { UserStatus } from '../../users/entities/user.entity';

export class ListAffiliatesDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** Inclusive start (YYYY-MM-DD) of the period for each item's period_stats, e.g. 2026-11-01 for periode 1. */
  @IsOptional()
  @IsDateString()
  date_from?: string;

  /** Inclusive end (YYYY-MM-DD) of the period for period_stats, e.g. 2026-11-15 for periode 1, 2026-11-30 for periode 2. */
  @IsOptional()
  @IsDateString()
  date_to?: string;

  /** Only affiliates who registered with this admin's referral code. */
  @IsOptional()
  @IsString()
  admin_profile_id?: string;

  @IsOptional()
  @IsString()
  search?: string;

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
