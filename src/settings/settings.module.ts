import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';
import { SettingsService } from './settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformSettings])],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
