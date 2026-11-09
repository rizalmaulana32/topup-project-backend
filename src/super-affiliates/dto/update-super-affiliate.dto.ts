import { PickType, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { UserStatus } from '../../users/entities/user.entity';
import { CreateSuperAffiliateDto } from './create-super-affiliate.dto';

/** Only the fields sent are changed. Rate/threshold changes apply to future transactions only. */
export class UpdateSuperAffiliateDto extends PartialType(
  PickType(CreateSuperAffiliateDto, [
    'name',
    'referral_code',
    'commission_rate',
    'threshold_mode',
    'threshold_amount',
  ] as const),
) {
  @IsOptional()
  @IsIn([UserStatus.ACTIVE, UserStatus.INACTIVE])
  status?: UserStatus.ACTIVE | UserStatus.INACTIVE;
}
