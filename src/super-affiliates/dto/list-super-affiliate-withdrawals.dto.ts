import { IsOptional, IsString } from 'class-validator';
import { ListWithdrawalsDto } from '../../admin/dto/list-withdrawals.dto';

export class ListSuperAffiliateWithdrawalsDto extends ListWithdrawalsDto {
  @IsOptional()
  @IsString()
  super_affiliate_id?: string;
}
