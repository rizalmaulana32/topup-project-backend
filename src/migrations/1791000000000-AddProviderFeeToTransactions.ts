import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderFeeToTransactions1791000000000
  implements MigrationInterface
{
  name = 'AddProviderFeeToTransactions1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "provider_fee" numeric(14,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "provider_fee"`,
    );
  }
}
