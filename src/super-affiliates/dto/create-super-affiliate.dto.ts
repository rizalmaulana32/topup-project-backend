import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import {
  ADMIN_REFERRAL_CODE_MESSAGE,
  ADMIN_REFERRAL_CODE_PATTERN,
} from '../../manual-topup/dto/create-admin.dto';
import { SuperAffiliateThresholdMode } from '../entities/super-affiliate-profile.entity';

export class CreateSuperAffiliateDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  phone_number: string;

  @IsString()
  @MinLength(1)
  bank_name: string;

  @IsString()
  @MinLength(1)
  account_number: string;

  @IsString()
  @MinLength(1)
  account_holder: string;

  /** Code affiliates enter at registration to join this SA. Auto-generated (SA-XXXXXX) when omitted. Unique across admins, SAs and affiliates. */
  @IsOptional()
  @Matches(ADMIN_REFERRAL_CODE_PATTERN, {
    message: ADMIN_REFERRAL_CODE_MESSAGE,
  })
  referral_code?: string;

  /** Percent of each qualifying downline transaction's gross amount. Default 1. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commission_rate?: number;

  /** Default per_transaction. */
  @IsOptional()
  @IsEnum(SuperAffiliateThresholdMode)
  threshold_mode?: SuperAffiliateThresholdMode;

  /** Default 1.000.000. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  threshold_amount?: number;
}
