import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateBankDetailsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bank_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  account_number?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  account_holder?: string;
}
