import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerDiscountMinAmount1792500000000
  implements MigrationInterface
{
  name = 'AddCustomerDiscountMinAmount1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "customer_discount_min_amount" numeric(14,2) NOT NULL DEFAULT 350000`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "customer_discount_min_amount"`,
    );
  }
}
