import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @ApiOperation({
    summary: 'Submit a support/partnership message (public contact form)',
  })
  async create(@Body() dto: CreateContactMessageDto) {
    const data = await this.contactService.create(dto);
    return { success: true, data };
  }
}
