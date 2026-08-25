import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameXenditColumnsToDuitku1787676524635 implements MigrationInterface {
    name = 'RenameXenditColumnsToDuitku1787676524635'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "commission_withdrawals" RENAME COLUMN "xendit_disbursement_id" TO "duitku_disbursement_id"`);
        await queryRunner.query(`ALTER TABLE "commission_withdrawals" RENAME CONSTRAINT "UQ_0cf1c54b4551439c8fec4e5cf65" TO "UQ_d732e48d6ab7ceedfdbe814f9d6"`);
        await queryRunner.query(`ALTER TABLE "transactions" RENAME COLUMN "xendit_invoice_id" TO "duitku_reference"`);
        await queryRunner.query(`ALTER TABLE "transactions" RENAME CONSTRAINT "UQ_86d5b013c2d0e4f1879cd97a360" TO "UQ_140657c52b0123d0252056102f2"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "transactions" RENAME CONSTRAINT "UQ_140657c52b0123d0252056102f2" TO "UQ_86d5b013c2d0e4f1879cd97a360"`);
        await queryRunner.query(`ALTER TABLE "transactions" RENAME COLUMN "duitku_reference" TO "xendit_invoice_id"`);
        await queryRunner.query(`ALTER TABLE "commission_withdrawals" RENAME CONSTRAINT "UQ_d732e48d6ab7ceedfdbe814f9d6" TO "UQ_0cf1c54b4551439c8fec4e5cf65"`);
        await queryRunner.query(`ALTER TABLE "commission_withdrawals" RENAME COLUMN "duitku_disbursement_id" TO "xendit_disbursement_id"`);
    }

}
