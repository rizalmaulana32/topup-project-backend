import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class ProviderCoinTransferDto {
  @IsString()
  @IsNotEmpty()
  target_user_id: string;

  @IsOptional()
  @IsString()
  target_zone_id?: string;

  @IsInt()
  @IsPositive()
  coin: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
