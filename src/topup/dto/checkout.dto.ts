import { IsOptional, IsString, MinLength } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @MinLength(1)
  product_id: string;

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
