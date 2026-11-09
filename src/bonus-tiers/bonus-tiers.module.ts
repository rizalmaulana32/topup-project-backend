import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BonusTiersService } from './bonus-tiers.service';
import { BonusTier } from './entities/bonus-tier.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BonusTier])],
  providers: [BonusTiersService],
  exports: [BonusTiersService],
})
export class BonusTiersModule {}
