import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ManualTopupStatus } from '../entities/manual-topup.entity';

export class ListManualTopupsDto {
  @IsOptional()
  @IsEnum(ManualTopupStatus)
  status?: ManualTopupStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
