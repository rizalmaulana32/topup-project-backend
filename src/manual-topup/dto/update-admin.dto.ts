import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import {
  ADMIN_REFERRAL_CODE_MESSAGE,
  ADMIN_REFERRAL_CODE_PATTERN,
} from './create-admin.dto';

/** All fields optional - only the ones sent are changed. Coin budget has its own endpoint (PATCH /admin/manual-admins/:id/coin-limit). */
export class UpdateAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @Matches(ADMIN_REFERRAL_CODE_PATTERN, {
    message: ADMIN_REFERRAL_CODE_MESSAGE,
  })
  referral_code?: string;
}
