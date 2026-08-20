import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ContactMessageStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

@Entity('contact_messages')
export class ContactMessage {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'enum',
    enum: ContactMessageStatus,
    default: ContactMessageStatus.OPEN,
  })
  status: ContactMessageStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
