import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ProductStatus } from '../../products/entities/product.entity';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  provider_code?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  base_price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  selling_price?: number;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
