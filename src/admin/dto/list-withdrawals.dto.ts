import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { WithdrawalStatus } from '../../affiliates/entities/commission-withdrawal.entity';

export class ListWithdrawalsDto {
  // "success" is accepted as an alias for "paid" - a client tried it as
  // the natural term for a completed withdrawal and got a validation
  // error, since the stored status value is "paid" (matches WithdrawalStatus.PAID).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'success' ? WithdrawalStatus.PAID : value,
  )
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;

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
