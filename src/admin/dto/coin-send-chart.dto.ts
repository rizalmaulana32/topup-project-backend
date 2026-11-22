import { IsDateString, IsOptional, Matches } from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class CoinSendChartDto {
  /** YYYY-MM-DD, inclusive, Asia/Jakarta. Both omitted = today (chart) / all time (list). */
  @IsOptional()
  @Matches(YMD, { message: 'date_from must be YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'date_from is not a valid date' })
  date_from?: string;

  @IsOptional()
  @Matches(YMD, { message: 'date_to must be YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'date_to is not a valid date' })
  date_to?: string;
}
