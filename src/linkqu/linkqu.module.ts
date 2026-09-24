import { Module } from '@nestjs/common';
import { LinkQuService } from './linkqu.service';

@Module({
  providers: [LinkQuService],
  exports: [LinkQuService],
})
export class LinkQuModule {}
