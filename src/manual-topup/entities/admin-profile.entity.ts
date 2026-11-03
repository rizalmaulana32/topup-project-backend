import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * The coin budget attached to a UserRole.ADMIN account (client request via
 * Ricky 2026-11-02: "akan ada batasan limit coin bisa transaksikan"). Not
 * a resettable period allowance - coinLimit is a running balance the
 * superadmin assigns/tops up directly (ManualTopupService.adjustCoinLimit),
 * decremented by each manual send the admin makes. totalCoinSent is a
 * separate lifetime counter for reporting, never decremented.
 */
@Entity('admin_profiles')
export class AdminProfile {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    name: 'coin_limit',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  coinLimit: string;

  @Column({
    name: 'total_coin_sent',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  totalCoinSent: string;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  /**
   * Entered by a new affiliate at registration to link them to this admin
   * (AffiliatorProfile.adminProfileId). Not a checkout code - no discount or
   * commission.
   */
  @Column({
    name: 'referral_code',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  referralCode: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
