import { IsString, Matches } from 'class-validator';

export class UpdateReferralCodeDto {
  @IsString()
  @Matches(/^[A-Z0-9-]{3,32}$/, {
    message:
      'referral_code must be 3-32 characters, uppercase letters/digits/hyphens only',
  })
  referral_code: string;
}
