import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

export class CheckReferralCodeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(1)
  code: string;
}
