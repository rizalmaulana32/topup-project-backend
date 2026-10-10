import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports adjustable-amount checkout (customer types a nominal instead of
 * picking a fixed product): product_id becomes optional, and coin_amount/
 * cost_basis carry the computed payout + cost basis directly on the
 * transaction row for the transactions that have no product.
 */
export class AddCustomAmountCheckoutSupport1790700000000
  implements MigrationInterface
{
  name = 'AddCustomAmountCheckoutSupport1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_8d5b2e87f2129081ebacc894f8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "product_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_8d5b2e87f2129081ebacc894f8f" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "coin_amount" numeric(14,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "cost_basis" numeric(14,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "cost_basis"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "coin_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_8d5b2e87f2129081ebacc894f8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "product_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_8d5b2e87f2129081ebacc894f8f" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
