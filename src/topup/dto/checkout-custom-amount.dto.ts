import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { MIN_CUSTOM_AMOUNT_RUPIAH } from '../custom-amount-pricing.util';

export class CheckoutCustomAmountDto {
  @Type(() => Number)
  @IsInt()
  @Min(MIN_CUSTOM_AMOUNT_RUPIAH, {
    message: `amount must be at least ${MIN_CUSTOM_AMOUNT_RUPIAH} (minimum top-up amount)`,
  })
  amount: number;

  @IsString()
  @MinLength(1)
  target_user_id: string;

  @IsOptional()
  @IsString()
  target_zone_id?: string;

  @IsOptional()
  @IsString()
  affiliate_code?: string;
}
