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

  /** Overall amount to send. For a one-off send, omit amount_per_send/interval_seconds - this whole amount goes in one shot. */
  @Type(() => Number)
  @IsPositive()
  total_amount: number;

  /** Amount sent each tick, for a scheduled/partial send - required together with interval_seconds. */
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  amount_per_send?: number;

  /** Seconds between each send (min 5) - required (or interval_minutes) together with amount_per_send. Wins over interval_minutes when both are given. */
  // No @Min here: anything under MIN_INTERVAL_SECONDS gets the service's 422.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  interval_seconds?: number;

  /** Legacy: minutes between each send, used only when interval_seconds is absent. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  interval_minutes?: number;
}
