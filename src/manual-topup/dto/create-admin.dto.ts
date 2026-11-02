import { IsEmail, IsNumber, IsString, Min, MinLength } from 'class-validator';

export class CreateAdminDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsNumber()
  @Min(0)
  coin_limit: number;
}
