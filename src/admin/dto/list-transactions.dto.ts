import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
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

  // "Dari Tanggal" - inclusive start of the created_at range, e.g. 2026-11-01.
  @IsOptional()
  @IsDateString()
  date_from?: string;

  // "Sampai Tanggal" - inclusive end of the created_at range.
  @IsOptional()
  @IsDateString()
  date_to?: string;

  // "Produk" filter in the admin UI.
  @IsOptional()
  @IsString()
  product_id?: string;

  // "Referral Code" filter in the admin UI.
  @IsOptional()
  @IsString()
  referral_code?: string;

  // "Jumlah Min (Rp)" - inclusive lower bound on gross_amount.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount_min?: number;

  // "Jumlah Max (Rp)" - inclusive upper bound on gross_amount.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount_max?: number;

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
