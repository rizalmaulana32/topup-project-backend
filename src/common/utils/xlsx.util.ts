import { StreamableFile } from '@nestjs/common';
import { Workbook } from 'exceljs';

/** An in-memory .xlsx download named `<name>-<WIB date>.xlsx`; nothing is written to disk. */
export async function toXlsxFile(
  name: string,
  columns: [string, string][],
  rows: Record<string, unknown>[],
): Promise<StreamableFile> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map(([key, header]) => ({ key, header, width: 20 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);
  // ponytail: whole export built in memory (max 10000 rows); stream with exceljs' WorkbookWriter if exports outgrow this.
  const buffer = await workbook.xlsx.writeBuffer();
  const today = toJakartaTime(new Date())?.slice(0, 10);
  return new StreamableFile(Buffer.from(buffer), {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    disposition: `attachment; filename="${name}-${today}.xlsx"`,
  });
}

/** "YYYY-MM-DD HH:mm:ss" in Asia/Jakarta, whatever the server's TZ. */
export function toJakartaTime(date: Date | null): string | null {
  return date
    ? date.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })
    : null;
}
