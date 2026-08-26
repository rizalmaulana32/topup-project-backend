import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  global_commission_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimum_withdrawal_amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  admin_bank_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  admin_account_number?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  admin_account_holder?: string;
}
