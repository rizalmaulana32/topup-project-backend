import { IsNumber } from 'class-validator';

export class AdjustCoinLimitDto {
  /** Added to the admin's current coin_limit - pass a negative number to deduct. */
  @IsNumber()
  amount: number;
}
