import { IsBoolean } from 'class-validator';

export class SetTieredCommissionDto {
  @IsBoolean()
  enabled: boolean;
}
