import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoinSendRefId1794300000000 implements MigrationInterface {
  name = 'AddCoinSendRefId1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coin_sends" ADD "ref_id" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coin_sends" DROP COLUMN "ref_id"`);
  }
}
