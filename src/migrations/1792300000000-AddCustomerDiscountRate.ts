import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerDiscountRate1792300000000
  implements MigrationInterface
{
  name = 'AddCustomerDiscountRate1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "customer_discount_rate" numeric(5,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "customer_discount_amount" numeric(14,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "customer_discount_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "customer_discount_rate"`,
    );
  }
}
