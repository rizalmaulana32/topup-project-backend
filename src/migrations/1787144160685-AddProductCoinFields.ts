import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductCoinFields1787144160685 implements MigrationInterface {
  name = 'AddProductCoinFields1787144160685';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD "coin_amount" numeric(14,2) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD "bonus_coin" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD "flag" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "flag"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "bonus_coin"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "coin_amount"`);
  }
}
