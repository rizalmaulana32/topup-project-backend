import { IsNumber, Min } from 'class-validator';

export class PlatformWithdrawDto {
  @IsNumber()
  @Min(1)
  amount: number;
}
