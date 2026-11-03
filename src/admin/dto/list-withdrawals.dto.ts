import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  WithdrawalMethod,
  WithdrawalStatus,
} from '../../affiliates/entities/commission-withdrawal.entity';

// The frontend's withdrawal tabs (Semua / Pending / Approval / Success /
// Failed) use their own tab names, not always the stored enum value - these
// aliases let the frontend pass its tab name straight through as `status`.
const STATUS_ALIASES: Record<string, WithdrawalStatus> = {
  success: WithdrawalStatus.PAID,
  approval: WithdrawalStatus.APPROVED,
  failed: WithdrawalStatus.REJECTED,
};

export class ListWithdrawalsDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value in STATUS_ALIASES
      ? STATUS_ALIASES[value]
      : value,
  )
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;

  /** bank or momo_coin */
  @IsOptional()
  @IsEnum(WithdrawalMethod)
  method?: WithdrawalMethod;

  @IsOptional()
  @IsString()
  search?: string;

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
