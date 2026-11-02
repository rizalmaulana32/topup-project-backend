import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateManualTopupDto {
  @IsString()
  @MinLength(1)
  momo_user_id: string;

  @IsOptional()
  @IsString()
  customer_name?: string;

  /** Overall amount to send. For a one-off send, omit amount_per_send/interval_minutes - this whole amount goes in one shot. */
  @Type(() => Number)
  @IsPositive()
  total_amount: number;

  /** Amount sent each tick, for a scheduled/partial send - required together with interval_minutes. */
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  amount_per_send?: number;

  /** Minutes between each send - required together with amount_per_send. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  interval_minutes?: number;
}
