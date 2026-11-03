import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ManualTopupSendStatus } from '../entities/manual-topup-send.entity';

export class ListTransferHistoryDto {
  @IsOptional()
  @IsEnum(ManualTopupSendStatus)
  status?: ManualTopupSendStatus;

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
