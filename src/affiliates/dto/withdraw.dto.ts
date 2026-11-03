import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { WithdrawalMethod } from '../entities/commission-withdrawal.entity';

export class WithdrawDto {
  @IsNumber()
  @Min(1)
  amount: number;

  /** bank (default) = manual transfer; momo_coin = coins to momo_user_id on approval, 1 coin = Rp1 of net_amount. */
  @IsOptional()
  @IsEnum(WithdrawalMethod)
  method?: WithdrawalMethod;

  /** Required when method is momo_coin. */
  @ValidateIf((dto: WithdrawDto) => dto.method === WithdrawalMethod.MOMO_COIN)
  @IsString()
  @IsNotEmpty()
  momo_user_id?: string;
}
