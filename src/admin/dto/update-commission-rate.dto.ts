import { IsNumber, Min } from 'class-validator';

export class UpdateCommissionRateDto {
  @IsNumber()
  @Min(0)
  commission_rate: number;
}
