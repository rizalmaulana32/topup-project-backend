import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('affiliator_profiles')
export class AffiliatorProfile {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  /**
   * Not eager: an eager relation forces TypeORM to LEFT JOIN User on every
   * AffiliatorProfile query, including pessimistic-locked ones — Postgres
   * rejects FOR UPDATE across a LEFT JOIN ("cannot be applied to the
   * nullable side of an outer join"). Request `relations: { user: true }`
   * explicitly where the join is actually needed and safe (no lock).
   */
  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    name: 'affiliate_code',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  affiliateCode: string | null;

  @Column({
    name: 'commission_rate',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 10,
  })
  commissionRate: string;

  @Column({ name: 'bank_name' })
  bankName: string;

  @Column({ name: 'account_number' })
  accountNumber: string;

  @Column({ name: 'account_holder' })
  accountHolder: string;

  @Column({
    name: 'commission_balance',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  commissionBalance: string;

  @Column({
    name: 'total_commission_earned',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  totalCommissionEarned: string;

  @Column({ name: 'approved_by', type: 'bigint', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
