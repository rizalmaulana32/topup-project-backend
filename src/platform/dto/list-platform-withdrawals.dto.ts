import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PlatformWithdrawalStatus } from '../entities/platform-withdrawal.entity';

export class ListPlatformWithdrawalsDto {
  // "success" is accepted as an alias for "paid" - see ListWithdrawalsDto.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'success' ? PlatformWithdrawalStatus.PAID : value,
  )
  @IsEnum(PlatformWithdrawalStatus)
  status?: PlatformWithdrawalStatus;

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
