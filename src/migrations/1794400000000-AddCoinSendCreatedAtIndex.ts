import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoinSendCreatedAtIndex1794400000000 implements MigrationInterface {
  name = 'AddCoinSendCreatedAtIndex1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_coin_sends_created_at" ON "coin_sends" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_coin_sends_created_at"`);
  }
}
