import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class EstimateCustomAmountDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coin?: number;
}
