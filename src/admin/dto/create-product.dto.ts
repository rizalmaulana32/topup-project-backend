import { IsNumber, IsString, Min, MinLength } from 'class-validator';

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
}
