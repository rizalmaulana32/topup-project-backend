import { IsOptional, IsString } from 'class-validator';

export class ProcessWithdrawalDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
