import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { countByGroups } from '../common/utils/list-query.util';
import { EmailService } from '../email/email.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import {
  ContactMessage,
  ContactMessageStatus,
} from './entities/contact-message.entity';

interface FindAllParams {
  status?: ContactMessageStatus;
  search?: string;
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
        subject: `Pesan Baru dari ${dto.name}`,
        text: `Nama: ${dto.name}\nEmail: ${dto.email}\n\nPesan:\n${dto.message}`,
      });
    } else {
      this.logger.warn(
        'SUPPORT_NOTIFICATION_EMAIL is not set - skipping email notification.',
      );
    }

    return saved;
  }

  async findAll(params: FindAllParams) {
    const qb = this.contactMessageRepository.createQueryBuilder('m');
    if (params.search) {
      qb.andWhere(
        '(m.name ILIKE :search OR m.email ILIKE :search OR m.message ILIKE :search)',
        { search: `%${params.search}%` },
      );
    }
    const counts = await countByGroups(qb, 'm.status', {
      open: [ContactMessageStatus.OPEN],
      resolved: [ContactMessageStatus.RESOLVED],
    });
    if (params.status) {
      qb.andWhere('m.status = :status', { status: params.status });
    }
    const [items, total] = await qb
      .orderBy('m.createdAt', 'DESC')
      .take(params.limit)
      .skip(params.offset)
      .getManyAndCount();
    return { items, total, counts };
  }

  async markResolved(id: string): Promise<ContactMessage> {
    const found = await this.findByIdOrFail(id);
    found.status = ContactMessageStatus.RESOLVED;
    return this.contactMessageRepository.save(found);
  }

  /**
   * Soft delete: sets deleted_at instead of removing the row. TypeORM
   * automatically excludes soft-deleted rows from find/findOne, so a
   * deleted message disappears from the admin listing without further
   * code changes here.
   */
  async softDelete(id: string): Promise<void> {
    await this.findByIdOrFail(id);
    await this.contactMessageRepository.softDelete(id);
  }

  private async findByIdOrFail(id: string): Promise<ContactMessage> {
    const found = await this.contactMessageRepository.findOne({
      where: { id },
    });
    if (!found) {
      throw new NotFoundException(`Contact message ${id} not found`);
    }
    return found;
  }
}
