import { Module } from '@nestjs/common';
import { DuitkuService } from './duitku.service';

@Module({
  providers: [DuitkuService],
  exports: [DuitkuService],
})
export class DuitkuModule {}
