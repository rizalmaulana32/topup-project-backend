import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AdjustCommissionBalanceDto {
  /** Added to the affiliate's commission_balance - pass a negative number to deduct. */
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
