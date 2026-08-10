import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  global_commission_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimum_withdrawal_amount?: number;
}
