import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterAffiliateDto {
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
  bank_name: string;

  @IsString()
  @MinLength(1)
  account_number: string;

  @IsString()
  @MinLength(1)
  account_holder: string;

  @IsString()
  @MinLength(1)
  phone_number: string;

  /** Optional admin referral code (from GET /admin/manual-admins) - links the new affiliate to that admin. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || undefined : value,
  )
  @IsString()
  referral_code?: string;
}
