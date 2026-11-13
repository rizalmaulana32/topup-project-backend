import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive: interval_minutes is kept (no longer written) so this never
 * touches existing data destructively; drop it in a later migration.
 */
export class AddManualTopupIntervalSeconds1793900000000 implements MigrationInterface {
  name = 'AddManualTopupIntervalSeconds1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_topups" ADD "interval_seconds" integer`,
    );
    await queryRunner.query(
      `UPDATE "manual_topups" SET "interval_seconds" = "interval_minutes" * 60 WHERE "interval_minutes" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "manual_topups" ADD "locked_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Postgres >= 12 allows this inside the migration transaction (the new
    // value just can't be used in that same transaction - it isn't).
    await queryRunner.query(
      `ALTER TYPE "public"."manual_topup_sends_status_enum" ADD VALUE IF NOT EXISTS 'unknown'`,
    );
  }

  // Postgres can't drop an enum value; 'unknown' stays (harmless).
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_topups" DROP COLUMN "locked_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "manual_topups" DROP COLUMN "interval_seconds"`,
    );
  }
}
