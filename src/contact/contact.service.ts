import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import {
  ContactMessage,
  ContactMessageStatus,
} from './entities/contact-message.entity';

interface FindAllParams {
  status?: ContactMessageStatus;
  limit: number;
  offset: number;
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectRepository(ContactMessage)
    private readonly contactMessageRepository: Repository<ContactMessage>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateContactMessageDto): Promise<ContactMessage> {
    const message = this.contactMessageRepository.create({
      name: dto.name,
      email: dto.email,
      category: dto.category,
      message: dto.message,
      status: ContactMessageStatus.OPEN,
    });
    const saved = await this.contactMessageRepository.save(message);

    const notifyTo = this.configService.get<string>(
      'SUPPORT_NOTIFICATION_EMAIL',
    );
    if (notifyTo) {
      await this.emailService.send({
        to: notifyTo,
        subject: `Pesan Baru dari ${dto.name} - ${dto.category}`,
        text: `Nama: ${dto.name}\nEmail: ${dto.email}\nKategori: ${dto.category}\n\nPesan:\n${dto.message}`,
      });
    } else {
      this.logger.warn(
        'SUPPORT_NOTIFICATION_EMAIL is not set - skipping email notification.',
      );
    }

    return saved;
  }

  async findAll(
    params: FindAllParams,
  ): Promise<{ items: ContactMessage[]; total: number }> {
    const [items, total] = await this.contactMessageRepository.findAndCount({
      where: params.status ? { status: params.status } : {},
      order: { createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { items, total };
  }

  async markResolved(id: string): Promise<ContactMessage> {
    const found = await this.contactMessageRepository.findOne({
      where: { id },
    });
    if (!found) {
      throw new NotFoundException(`Contact message ${id} not found`);
    }
    found.status = ContactMessageStatus.RESOLVED;
    return this.contactMessageRepository.save(found);
  }
}
