import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualQris1793800000000 implements MigrationInterface {
  name = 'AddManualQris1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "manual_qris_image" bytea`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "manual_qris_mime_type" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "manual_qris_enabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "manual_qris_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "manual_qris_mime_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "manual_qris_image"`,
    );
  }
}
