import { IsOptional, IsString, Matches } from 'class-validator';

export class ApproveAffiliateDto {
  /** Omit to auto-generate as before. Must be unique across affiliates. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9-]{3,32}$/, {
    message:
      'referral_code must be 3-32 characters, uppercase letters/digits/hyphens only',
  })
  referral_code?: string;
}
