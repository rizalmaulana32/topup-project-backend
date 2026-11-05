import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomAmountExtraCoinToggle1793500000000 implements MigrationInterface {
  name = 'AddCustomAmountExtraCoinToggle1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "custom_amount_extra_coin_enabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "custom_amount_extra_coin_enabled"`,
    );
  }
}
