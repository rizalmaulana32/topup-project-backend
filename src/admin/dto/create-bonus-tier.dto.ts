import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
} from 'class-validator';

export class CreateBonusTierDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  min_amount: number;

  /** Exclusive upper bound; null/omitted = no upper bound. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  max_amount?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100)
  bonus_percent: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
