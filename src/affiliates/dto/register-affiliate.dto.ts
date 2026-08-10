import { IsEmail, IsString, MinLength } from 'class-validator';

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
}
