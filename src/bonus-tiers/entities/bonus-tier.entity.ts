import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// pg returns numeric as string; these are small amounts/percents, safe as JS numbers.
const numeric = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

/**
 * Bonus % for a custom-amount top-up whose nominal falls in
 * [min_amount, max_amount) - max_amount NULL = no upper bound. Ranges
 * never overlap, inactive ones included (so re-activating can't clash);
 * BonusTiersService checks that for a readable message, the exclusion
 * constraint is the race-proof backstop.
 */
@Entity('bonus_tiers')
@Check(
  'CHK_bonus_tiers_percent',
  `"bonus_percent" > 0 AND "bonus_percent" <= 100`,
)
@Check(
  'CHK_bonus_tiers_range',
  `"min_amount" >= 0 AND ("max_amount" IS NULL OR "max_amount" > "min_amount")`,
)
@Exclusion(
  'EX_bonus_tiers_no_overlap',
  `USING gist (numrange("min_amount", "max_amount", '[)') WITH &&)`,
)
export class BonusTier {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({
    name: 'min_amount',
    type: 'decimal',
    precision: 14,
    scale: 2,
    transformer: numeric,
  })
  minAmount: number;

  @Column({
    name: 'max_amount',
    type: 'decimal',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numeric,
  })
  maxAmount: number | null;

  @Column({
    name: 'bonus_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
    transformer: numeric,
  })
  bonusPercent: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
