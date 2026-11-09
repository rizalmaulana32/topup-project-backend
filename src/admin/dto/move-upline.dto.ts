import { IsString, Matches, ValidateIf } from 'class-validator';
import {
  ADMIN_REFERRAL_CODE_MESSAGE,
  ADMIN_REFERRAL_CODE_PATTERN,
} from '../../manual-topup/dto/create-admin.dto';

export class MoveUplineDto {
  /** Referral code of the new upline (admin or super affiliate); explicit null detaches the affiliate. */
  @ValidateIf((dto: MoveUplineDto) => dto.referral_code !== null)
  @IsString()
  @Matches(ADMIN_REFERRAL_CODE_PATTERN, {
    message: ADMIN_REFERRAL_CODE_MESSAGE,
  })
  referral_code: string | null;
}
