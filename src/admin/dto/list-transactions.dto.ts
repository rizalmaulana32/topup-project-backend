import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaymentStatus } from '../../transactions/entities/transaction.entity';

// "sukses"/"success" accepted as aliases for "paid" - the stored status
// value is "paid" (matches PaymentStatus.PAID), but that's not the term an
// admin naturally reaches for when asking "show me the successful ones".
const STATUS_ALIASES: Record<string, PaymentStatus> = {
  sukses: PaymentStatus.PAID,
  success: PaymentStatus.PAID,
};

export class ListTransactionsDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value in STATUS_ALIASES
      ? STATUS_ALIASES[value]
      : value,
  )
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

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
