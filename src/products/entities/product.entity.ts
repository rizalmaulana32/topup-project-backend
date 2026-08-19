import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ProductStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column()
  name: string;

  @Column({ name: 'provider_code' })
  providerCode: string;

  @Column({ name: 'base_price', type: 'decimal', precision: 14, scale: 2 })
  basePrice: string;

  @Column({ name: 'selling_price', type: 'decimal', precision: 14, scale: 2 })
  sellingPrice: string;

  @Column({ name: 'coin_amount', type: 'decimal', precision: 14, scale: 2 })
  coinAmount: string;

  @Column({
    name: 'bonus_coin',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: 0,
  })
  bonusCoin: string;

  @Column({ type: 'varchar', nullable: true })
  flag: string | null;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  status: ProductStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
