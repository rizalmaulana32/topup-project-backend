import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomAmountMarginRate1790700100000
  implements MigrationInterface
{
  name = 'AddCustomAmountMarginRate1790700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "custom_amount_margin_rate" numeric(5,2) NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "custom_amount_margin_rate"`,
    );
  }
}
