import { IsOptional, IsString, MinLength } from 'class-validator';

export class CheckIdDto {
  @IsString()
  @MinLength(1)
  game_code: string;

  @IsString()
  @MinLength(1)
  user_id: string;

  @IsOptional()
  @IsString()
  zone_id?: string;
}
