import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTieredCommission1792400000000 implements MigrationInterface {
  name = 'AddTieredCommission1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD "tiered_commission_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD "current_period_volume" numeric(14,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD "current_period_month" varchar(7)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP COLUMN "current_period_month"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP COLUMN "current_period_volume"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP COLUMN "tiered_commission_enabled"`,
    );
  }
}
