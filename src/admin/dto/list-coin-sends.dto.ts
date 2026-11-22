import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { CoinSendStatus } from '../../provider/entities/coin-send.entity';
import { CoinSendChartDto } from './coin-send-chart.dto';

/** date_from/date_to as in the chart, but omitted = all time. */
export class ListCoinSendsDto extends CoinSendChartDto {
  @IsOptional()
  @IsIn(['linkqu', 'manual'])
  channel?: 'linkqu' | 'manual';

  @IsOptional()
  @IsIn(['pending', 'success', 'rejected', 'unknown'])
  status?: CoinSendStatus;

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
