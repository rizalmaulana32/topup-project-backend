import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, UserStatus } from './entities/user.entity';

interface CreateUserParams {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async findByIdOrFail(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async createUser(params: CreateUserParams): Promise<User> {
    const existing = await this.findByEmail(params.email);
    if (existing) {
      throw new ConflictException(
        `Email ${params.email} is already registered`,
      );
    }

    const user = this.userRepository.create(params);
    return this.userRepository.save(user);
  }

  async updateStatus(id: string, status: UserStatus): Promise<void> {
    await this.userRepository.update(id, { status });
  }
}
