import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  ContactMessage,
  ContactMessageStatus,
} from '../src/contact/entities/contact-message.entity';
import { User, UserRole, UserStatus } from '../src/users/entities/user.entity';

/**
 * Exercises the public contact form (POST /contact) and the superadmin
 * side (list + resolve) against a real Postgres database.
 */
describe('Contact (e2e)', () => {
  let app: INestApplication<App>;
  let userRepository: Repository<User>;
  let contactMessageRepository: Repository<ContactMessage>;
  let superadminToken: string;

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    const body = response.body as { data: { access_token: string } };
    return body.data.access_token;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    userRepository = moduleFixture.get(getRepositoryToken(User));
    contactMessageRepository = moduleFixture.get(
      getRepositoryToken(ContactMessage),
    );

    await userRepository.query(
      'TRUNCATE TABLE contact_messages, commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_settings, users, products RESTART IDENTITY CASCADE',
    );

    const passwordHash = await bcrypt.hash('admin-secret-password', 4);
    await userRepository.save(
      userRepository.create({
        name: 'Root Admin',
        email: 'admin.contact.e2e@example.com',
        passwordHash,
        role: UserRole.SUPERADMIN,
        status: UserStatus.ACTIVE,
      }),
    );
    superadminToken = await login(
      'admin.contact.e2e@example.com',
      'admin-secret-password',
    );
  });

  afterAll(async () => {
    await userRepository.query(
      'TRUNCATE TABLE contact_messages, commission_withdrawals, commission_logs, transactions, affiliator_profiles, platform_settings, users, products RESTART IDENTITY CASCADE',
    );
    await app.close();
  });

  it('accepts a public contact message submission', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/contact')
      .send({
        name: 'Ricky Oktavio',
        email: 'ricky@example.com',
        message: 'Pembayaran saya belum masuk ke akun',
      })
      .expect(201);

    const body = response.body as {
      success: boolean;
      data: { id: string; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe(ContactMessageStatus.OPEN);

    const stored = await contactMessageRepository.findOneOrFail({
      where: { id: body.data.id },
    });
    expect(stored.name).toBe('Ricky Oktavio');
    expect(stored.email).toBe('ricky@example.com');
  });

  it('rejects a submission missing a required field', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/contact')
      .send({
        name: 'Ricky Oktavio',
        email: 'ricky@example.com',
      })
      .expect(400);
  });

  it('rejects admin contact-message routes without a superadmin token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/contact-messages')
      .expect(401);
  });

  it('lists and resolves a contact message as superadmin', async () => {
    const submitResponse = await request(app.getHttpServer())
      .post('/api/v1/contact')
      .send({
        name: 'Ana Partner',
        email: 'ana@example.com',
        message: 'Saya ingin jadi reseller',
      })
      .expect(201);
    const submitBody = submitResponse.body as { data: { id: string } };
    const messageId = submitBody.data.id;

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/contact-messages')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);
    const listBody = listResponse.body as {
      data: { items: { id: string; status: string }[] };
    };
    expect(listBody.data.items.some((m) => m.id === messageId)).toBe(true);

    const resolveResponse = await request(app.getHttpServer())
      .post(`/api/v1/admin/contact-messages/${messageId}/resolve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(201);
    const resolveBody = resolveResponse.body as { data: { status: string } };
    expect(resolveBody.data.status).toBe(ContactMessageStatus.RESOLVED);

    const filteredResponse = await request(app.getHttpServer())
      .get(
        `/api/v1/admin/contact-messages?status=${ContactMessageStatus.RESOLVED}`,
      )
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200);
    const filteredBody = filteredResponse.body as {
      data: { items: { id: string; status: ContactMessageStatus }[] };
    };
    expect(
      filteredBody.data.items.every(
        (m) => m.status === ContactMessageStatus.RESOLVED,
      ),
    ).toBe(true);
  });

  it('returns 404 when resolving an unknown contact message', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/contact-messages/999999/resolve')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(404);
  });
});
