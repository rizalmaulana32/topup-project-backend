import { PartialType } from '@nestjs/swagger';
import { CreateBonusTierDto } from './create-bonus-tier.dto';

export class UpdateBonusTierDto extends PartialType(CreateBonusTierDto) {}
