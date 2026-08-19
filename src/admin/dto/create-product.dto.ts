import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  provider_code: string;

  @IsNumber()
  @Min(0)
  base_price: number;

  @IsNumber()
  @Min(0)
  selling_price: number;

  @IsNumber()
  @Min(0)
  coin_amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bonus_coin?: number;

  @IsOptional()
  @IsString()
  flag?: string;
}
