import { IsString, MinLength } from 'class-validator';

export class ResetAffiliatePasswordDto {
  @IsString()
  @MinLength(8)
  new_password: string;
}
