import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

export const ADMIN_REFERRAL_CODE_PATTERN = /^[A-Z0-9-]{3,32}$/;
export const ADMIN_REFERRAL_CODE_MESSAGE =
  'referral_code must be 3-32 characters, uppercase letters/digits/hyphens only';

export class CreateAdminDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsNumber()
  @Min(0)
  coin_limit: number;

  /** Code new affiliates enter at registration to be linked to this admin. Auto-generated (ADM-XXXXXX) when omitted. */
  @IsOptional()
  @Matches(ADMIN_REFERRAL_CODE_PATTERN, {
    message: ADMIN_REFERRAL_CODE_MESSAGE,
  })
  referral_code?: string;
}
