import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  execute,
  executeInTransaction,
  queryRows,
  queryRowsInTransaction,
  withTransaction,
  type Row,
} from "./db";
import { firstDayOfMonth } from "./billing-workflow";
import { DEFAULT_PAGE_SIZE, normalizePageSize } from "./pagination";
import { appendTableFilterOptionConditions, appendTableInFilter, formatTableDateExpression, getTableFilterOptionsOrderBy, getTableSort } from "./table-query";
import {
  buildBillingStatementRows,
  getVatRate,
  groupBillingStatementRowsByCurrency,
  type BillingStatementRow,
  type BillingStatementSourceRow,
} from "./billing-statement-workflow";

export type BillingStatementFilters = {
  countryCode?: string;
  currency?: string;
  startDate?: string;
  endDate?: string;
};

const COUNTRY_NAMES: Record<string, { company: string; customer: string }> = {
  BR: {
    company: "HK WANZHONG TECHNOLOGY LIMITED",
    customer: "华为云计算技术有限公司",
  },
  CL: {
    company: "LUZ TECHNOLOGY SpA",
    customer: "Sparkoo Technologies Chile SpA",
  },
  MX: {
    company: "LUZ NEWMEDIA, S.A. DE C.V.",
    customer: "Huawei Technologies De Mexico, S.A. De C.V.",
  },
};

export async function listBillingStatementSnapshots(searchParams: URLSearchParams) {
  const keyword = searchParams.get("keyword")?.trim();
  const countryCode = searchParams.get("countryCode")?.trim();
  const status = searchParams.get("status")?.trim();
  const exportAll = searchParams.get("export") === "1";
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  const whereParts: string[] = [];
  const params: Row = {};
  const filterExpressions: Record<string, string> = {
    snapshotNo: "snapshotNo", status: "status", countryCode: "countryCode", startDate: formatTableDateExpression("startDate"), endDate: formatTableDateExpression("endDate"),
    currencySummary: "currencySummary", totalQuantity: "totalQuantity", totalAmount: "totalAmount", itemCount: "itemCount", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(whereParts, params, expression, field, searchParams, "billingStatement");

  if (keyword) {
    whereParts.push("(snapshotNo LIKE :keyword OR countryCode LIKE :keyword OR currencySummary LIKE :keyword)");
    params.keyword = `%${keyword}%`;
  }
  if (countryCode) {
    whereParts.push("countryCode = :countryCode");
    params.countryCode = countryCode;
  }
  if (status) {
    whereParts.push("status = :status");
    params.status = status;
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const [{ total }] = await queryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM billingstatementsnapshots ${where}`,
    params,
  );
  const normalizedTotal = Number(total ?? 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / pageSize));
  const page = exportAll ? 1 : Math.min(requestedPage, totalPages);
  if (!exportAll) {
    params.limit = pageSize;
    params.offset = (page - 1) * pageSize;
  }
  const rows = await queryRows<Row>(
    `
      SELECT
        snapshotNo,
        status,
        countryCode,
        DATE_FORMAT(startDate, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(endDate, '%Y-%m-%d') AS endDate,
        currencySummary,
        totalQuantity,
        totalAmount,
        itemCount,
        DATE_FORMAT(confirmedAt, '%Y-%m-%d') AS confirmedAt,
        DATE_FORMAT(createdAt, '%Y-%m-%d') AS createdAt,
        DATE_FORMAT(updatedAt, '%Y-%m-%d') AS updatedAt
      FROM billingstatementsnapshots
      ${where}
      ${getTableSort(searchParams, filterExpressions) || "ORDER BY createdAt DESC"}
      ${exportAll ? "" : "LIMIT :limit OFFSET :offset"}
    `,
    params,
  );

  return { rows, total: normalizedTotal, page, pageSize, totalPages };
}

export async function listBillingStatementFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    snapshotNo: "snapshotNo", status: "status", countryCode: "countryCode", startDate: formatTableDateExpression("startDate"), endDate: formatTableDateExpression("endDate"),
    currencySummary: "currencySummary", totalQuantity: "totalQuantity", totalAmount: "totalAmount", itemCount: "itemCount", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  const field = searchParams.get("field")?.trim() ?? "";
  const expression = expressions[field];
  if (!expression) return { options: [] as Array<{ value: string; count: number }> };
  const params: Row = {};
  const where = [`${expression} IS NOT NULL`, `TRIM(CAST(${expression} AS CHAR)) <> ''`];
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  if (keyword) { where.push(`${expression} LIKE :optionKeyword`); params.optionKeyword = `%${keyword}%`; }
  appendTableFilterOptionConditions(where, params, expressions, searchParams, field);
  const rows = await queryRows<{ value: string; count: number }>(`SELECT ${expression} AS value, COUNT(*) AS count FROM billingstatementsnapshots WHERE ${where.join(" AND ")} GROUP BY ${expression} ORDER BY ${getTableFilterOptionsOrderBy(field, expression)} LIMIT 500`, params);
  return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
}

export async function previewBillingStatement(filters: BillingStatementFilters) {
  const normalized = normalizeFilters(filters);
  const sourceRows = await listMonthlyBillingRowsForStatement(normalized);
  const rows = buildBillingStatementRows({
    rows: sourceRows,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
  });
  return {
    rows,
    groups: groupBillingStatementRowsByCurrency(rows),
    summary: summarizeRows(rows),
  };
}

export async function createBillingStatementSnapshot({
  filters,
  snapshotNo,
}: {
  filters: BillingStatementFilters;
  snapshotNo?: string;
}) {
  const normalized = normalizeFilters(filters);
  const countryCode = normalized.countryCode;
  if (!countryCode) throw new Error("请选择国家");
  const preview = await previewBillingStatement(normalized);
  if (!preview.rows.length) throw new Error("当前筛选条件下没有月账单核销明细");

  const finalSnapshotNo = snapshotNo?.trim() || buildSnapshotNo(countryCode);
  const existingRows = await queryRows<{ status: string }>(
    "SELECT status FROM billingstatementsnapshots WHERE snapshotNo = :snapshotNo LIMIT 1",
    { snapshotNo: finalSnapshotNo },
  );
  if (existingRows[0]?.status === "已确认") throw new Error("已确认的月账单对账单不能重新生成");
  await execute("DELETE FROM billingstatementsnapshotitems WHERE snapshotNo = :snapshotNo", { snapshotNo: finalSnapshotNo });
  await execute(
    `
      INSERT INTO billingstatementsnapshots
        (snapshotNo, status, countryCode, startDate, endDate, currencySummary, totalQuantity, totalAmount, itemCount, confirmedAt)
      VALUES
        (:snapshotNo, '未确认', :countryCode, :startDate, :endDate, :currencySummary, :totalQuantity, :totalAmount, :itemCount, NULL)
      ON DUPLICATE KEY UPDATE
        status = '未确认',
        countryCode = VALUES(countryCode),
        startDate = VALUES(startDate),
        endDate = VALUES(endDate),
        currencySummary = VALUES(currencySummary),
        totalQuantity = VALUES(totalQuantity),
        totalAmount = VALUES(totalAmount),
        itemCount = VALUES(itemCount),
        confirmedAt = NULL,
        createdAt = CURRENT_TIMESTAMP
    `,
    {
      snapshotNo: finalSnapshotNo,
      countryCode,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      currencySummary: preview.groups.map((group) => `${group.currency}:${group.totalAmount}`).join(", "),
      totalQuantity: preview.summary.totalQuantity,
      totalAmount: preview.summary.totalAmount,
      itemCount: preview.rows.length,
    },
  );

  for (const [index, row] of preview.rows.entries()) {
    await insertSnapshotItem(finalSnapshotNo, index + 1, row);
  }

  return { snapshotNo: finalSnapshotNo, ...preview };
}

export async function getBillingStatementSnapshot(snapshotNo: string) {
  const snapshotRows = await queryRows<Row>(
    `
      SELECT
        snapshotNo,
        status,
        countryCode,
        DATE_FORMAT(startDate, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(endDate, '%Y-%m-%d') AS endDate,
        currencySummary,
        totalQuantity,
        totalAmount,
        itemCount,
        DATE_FORMAT(confirmedAt, '%Y-%m-%d') AS confirmedAt,
        DATE_FORMAT(createdAt, '%Y-%m-%d') AS createdAt,
        DATE_FORMAT(updatedAt, '%Y-%m-%d') AS updatedAt
      FROM billingstatementsnapshots
      WHERE snapshotNo = :snapshotNo
      LIMIT 1
    `,
    { snapshotNo },
  );
  const snapshot = snapshotRows[0] ?? null;
  const items = snapshot
    ? await queryRows<BillingStatementRow & Row>(
        `
          SELECT
            countryCode,
            currency,
            instanceContractNo,
            productType,
            unitPriceVatExcluded,
            vatRate,
            unitPriceVatIncluded,
            quantity,
            amount,
            DATE_FORMAT(startTime, '%Y-%m-%d') AS startTime,
            DATE_FORMAT(endTime, '%Y-%m-%d') AS endTime,
            sourceIds
          FROM billingstatementsnapshotitems
          WHERE snapshotNo = :snapshotNo
          ORDER BY currency, instanceContractNo, productType
        `,
        { snapshotNo },
      )
    : [];

  return { snapshot, items };
}

export async function confirmBillingStatementSnapshot(snapshotNo: string) {
  return withTransaction(async (connection) => {
    const rows = await queryRowsInTransaction<{ status: string }>(
      connection,
      "SELECT status FROM billingstatementsnapshots WHERE snapshotNo = :snapshotNo LIMIT 1 FOR UPDATE",
      { snapshotNo },
    );
    if (!rows[0]) throw new Error("月账单对账单不存在");
    if (rows[0].status === "已确认") return { snapshotNo, status: "已确认" };
    const [{ total }] = await queryRowsInTransaction<{ total: number }>(
      connection,
      "SELECT COUNT(*) AS total FROM billingstatementsnapshotitems WHERE snapshotNo = :snapshotNo",
      { snapshotNo },
    );
    if (Number(total ?? 0) === 0) throw new Error("月账单对账单没有明细，不能确认");
    await executeInTransaction(
      connection,
      "UPDATE billingstatementsnapshots SET status = '已确认', confirmedAt = CURRENT_TIMESTAMP WHERE snapshotNo = :snapshotNo",
      { snapshotNo },
    );
    return { snapshotNo, status: "已确认" };
  });
}

export async function deleteBillingStatementDraft(snapshotNo: string) {
  return withTransaction(async (connection) => {
    const rows = await queryRowsInTransaction<{ status: string }>(
      connection,
      "SELECT status FROM billingstatementsnapshots WHERE snapshotNo = :snapshotNo LIMIT 1 FOR UPDATE",
      { snapshotNo },
    );
    if (!rows[0]) throw new Error("月账单对账单不存在");
    if (rows[0].status === "已确认") throw new Error("已确认的月账单对账单不能删除或退回");
    await executeInTransaction(connection, "DELETE FROM billingstatementsnapshotitems WHERE snapshotNo = :snapshotNo", { snapshotNo });
    await executeInTransaction(connection, "DELETE FROM billingstatementsnapshots WHERE snapshotNo = :snapshotNo", { snapshotNo });
    return { snapshotNo };
  });
}

export async function exportBillingStatementSnapshot(snapshotNo: string) {
  const { snapshot, items } = await getBillingStatementSnapshot(snapshotNo);
  if (!snapshot) throw new Error("月账单对账单不存在");
  const countryCode = String(snapshot.countryCode ?? "");
  const workbook = buildPrettyStatementWorkbook({
    countryCode,
    rows: items.map((item) => ({
      ...item,
      unitPriceVatExcluded: Number(item.unitPriceVatExcluded ?? 0),
      vatRate: Number(item.vatRate ?? getVatRate(countryCode)),
      unitPriceVatIncluded: Number(item.unitPriceVatIncluded ?? 0),
      quantity: Number(item.quantity ?? 0),
      amount: Number(item.amount ?? 0),
    })),
  });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    filename: `XXLL-${countryCode}-${String(snapshot.startDate).slice(0, 7).replace("-", "")}-Computing Service Statement.xlsx`,
  };
}

function normalizeFilters(filters: BillingStatementFilters) {
  const startDate = filters.startDate ? firstDayOfMonth(filters.startDate) : "";
  const endDate = filters.endDate ? normalizeDate(filters.endDate) : "";
  if (!startDate) throw new Error("请选择起始日期");
  if (!endDate) throw new Error("请选择终止日期");
  return {
    countryCode: String(filters.countryCode ?? "").trim(),
    currency: String(filters.currency ?? "").trim(),
    startDate,
    endDate,
  };
}

async function listMonthlyBillingRowsForStatement(filters: Required<BillingStatementFilters>) {
  const whereParts = ["writeOffMonth >= :startDate", "writeOffMonth <= :endDate"];
  const params: Row = {
    startDate: filters.startDate,
    endDate: filters.endDate,
  };
  if (filters.countryCode) {
    whereParts.push("countryCode = :countryCode");
    params.countryCode = filters.countryCode;
  }
  if (filters.currency) {
    whereParts.push("currency = :currency");
    params.currency = filters.currency;
  }
  return queryRows<BillingStatementSourceRow & Row>(
    `
      SELECT
        id,
        countryCode,
        instanceContractNo,
        monthlybillingwriteoffs.nameEn AS nameEn,
        quantity,
        currency,
        monthlyAmount,
        country.vatRate,
        DATE_FORMAT(writeOffMonth, '%Y-%m-%d') AS writeOffMonth
      FROM monthlybillingwriteoffs
      LEFT JOIN countries country ON country.code = monthlybillingwriteoffs.countryCode
      WHERE ${whereParts.join(" AND ")}
      ORDER BY monthlybillingwriteoffs.countryCode, monthlybillingwriteoffs.currency, instanceContractNo, monthlybillingwriteoffs.nameEn, monthlyAmount
    `,
    params,
  );
}

async function insertSnapshotItem(snapshotNo: string, index: number, row: BillingStatementRow) {
  await execute(
    `
      INSERT INTO billingstatementsnapshotitems
        (id, snapshotNo, countryCode, currency, instanceContractNo, productType,
         unitPriceVatExcluded, vatRate, unitPriceVatIncluded, quantity, amount, startTime, endTime, sourceIds)
      VALUES
        (:id, :snapshotNo, :countryCode, :currency, :instanceContractNo, :productType,
         :unitPriceVatExcluded, :vatRate, :unitPriceVatIncluded, :quantity, :amount, :startTime, :endTime, :sourceIds)
    `,
    {
      ...row,
      id: `${snapshotNo}-${String(index).padStart(5, "0")}`,
      snapshotNo,
    },
  );
}

function buildStatementWorkbook({ countryCode, rows }: { countryCode: string; rows: BillingStatementRow[] }) {
  const country = COUNTRY_NAMES[countryCode] ?? { company: "HK WANZHONG TECHNOLOGY LIMITED", customer: "" };
  const groups = groupBillingStatementRowsByCurrency(rows);
  const aoa: unknown[][] = [];

  aoa.push([country.company]);
  aoa.push(["Computing Service Statement"]);
  aoa.push(["Customer Name", country.customer]);
  aoa.push([]);

  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) aoa.push([], []);
    aoa.push(["Reconciliation Details"]);
    aoa.push([
      "Party B's Contract Number",
      "Computing Service Product Type",
      "Unit Price (VAT excluded)",
      "VAT Rate",
      "Unit Price (VAT included)",
      "Qty",
      `AMOUNT in ${group.currency || "Currency"}`,
      "Currency",
      "Start Time",
      "End Of Charge Time",
    ]);
    for (const row of group.rows) {
      aoa.push([
        row.instanceContractNo,
        row.productType,
        row.unitPriceVatExcluded,
        row.vatRate,
        row.unitPriceVatIncluded,
        row.quantity,
        row.amount,
        row.currency,
        row.startTime,
        row.endTime,
      ]);
    }
    aoa.push(["Total", "", "", "", "", group.totalQuantity, group.totalAmount, group.currency, group.rows[0]?.startTime ?? "", group.rows[0]?.endTime ?? ""]);
    aoa.push(["Payment information of Party B"]);
    aoa.push(["Remarks:", "Total:"]);
    aoa.push([]);
    aoa.push(["", "", "", "", "Reviewer (Signature) :", "", "", "Seal (official seal of department) :"]);
  });

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!cols"] = [
    { wch: 32 },
    { wch: 34 },
    { wch: 22 },
    { wch: 12 },
    { wch: 22 },
    { wch: 10 },
    { wch: 18 },
    { wch: 12 },
    { wch: 16 },
    { wch: 20 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "对账表");
  return workbook;
}

export function buildPrettyStatementWorkbook({ countryCode, rows }: { countryCode: string; rows: BillingStatementRow[] }) {
  const country = COUNTRY_NAMES[countryCode] ?? { company: "HK WANZHONG TECHNOLOGY LIMITED", customer: "" };
  const groups = groupBillingStatementRowsByCurrency(rows);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "cloud_power";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("对账表", {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  worksheet.columns = [
    { key: "contractNo", width: 42.38 },
    { key: "productType", width: 33.88 },
    { key: "unitPriceVatExcluded", width: 20.69 },
    { key: "unitPriceVatIncluded", width: 19.71 },
    { key: "quantity", width: 18.88 },
    { key: "amount", width: 19.44 },
    { key: "currency", width: 13.58 },
    { key: "startTime", width: 16.11 },
    { key: "endTime", width: 27.21 },
  ];

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };
  const center: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle", wrapText: true };
  const bodyFont: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, color: { argb: "FF000000" } };
  const headerFont: Partial<ExcelJS.Font> = { name: "宋体", size: 10, bold: true, color: { argb: "FF000000" } };
  const titleFont: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 14, color: { argb: "FF000000" } };

  const styleRow = (
    rowNumber: number,
    options: { font?: Partial<ExcelJS.Font>; fill?: string; align?: Partial<ExcelJS.Alignment>; border?: boolean; height?: number } = {},
  ) => {
    const row = worksheet.getRow(rowNumber);
    row.height = options.height ?? 28;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = options.align ?? center;
      if (options.border !== false) cell.border = thinBorder;
      if (options.font) cell.font = options.font;
      if (options.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: options.fill } };
    });
  };

  const setRangeBorder = (rowNumber: number) => {
    for (let column = 1; column <= 9; column += 1) {
      worksheet.getCell(rowNumber, column).border = thinBorder;
    }
  };

  worksheet.mergeCells("A1:I1");
  worksheet.getCell("A1").value = country.company;
  worksheet.mergeCells("A2:I2");
  worksheet.getCell("A2").value = "Computing Service Statement";
  worksheet.getCell("A3").value = "Customer Name";
  worksheet.mergeCells("B3:I3");
  worksheet.getCell("B3").value = country.customer;
  styleRow(1, { font: titleFont, border: false, height: 37, align: { horizontal: "center", vertical: "middle", wrapText: true } });
  styleRow(2, { font: titleFont, border: false, height: 28, align: { horizontal: "center", vertical: "middle", wrapText: true } });
  styleRow(3, { font: { ...bodyFont, bold: true }, height: 28, align: { horizontal: "center", vertical: "middle", wrapText: true } });
  worksheet.getCell("B3").font = titleFont;

  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex > 0) {
      for (let index = 0; index < 6; index += 1) worksheet.addRow([]);
    }

    const titleRow = worksheet.rowCount + 1;
    worksheet.mergeCells(titleRow, 1, titleRow, 9);
    worksheet.getCell(titleRow, 1).value = "Reconciliation Details";
    styleRow(titleRow, {
      font: { name: "宋体", size: 14, bold: true, color: { argb: "FF000000" } },
      fill: "FFC0C0C0",
      height: 28,
      align: { horizontal: "center", vertical: "middle", wrapText: true },
    });

    const headerRow = worksheet.rowCount + 1;
    worksheet.addRow([
      "Party B's Contract Number",
      "Computing Service Product Type",
      "Unit Price (VAT excluded)",
      "Unit Price (VAT included)",
      "Qty",
      `AMOUNT in ${group.currency || "Currency"}`,
      "Currency",
      "Start Time",
      "End Of Charge Time",
    ]);
    styleRow(headerRow, { font: headerFont, height: 28 });

    const firstDataRow = worksheet.rowCount + 1;
    for (const row of group.rows) {
      const dataRow = worksheet.addRow([
        row.instanceContractNo,
        row.productType,
        row.unitPriceVatExcluded,
        row.unitPriceVatIncluded,
        row.quantity,
        row.amount,
        row.currency,
        toExcelDate(row.startTime),
        toExcelDate(row.endTime),
      ]);
      dataRow.height = 28;
      dataRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = center;
        cell.border = thinBorder;
        cell.font = bodyFont;
      });
      dataRow.getCell(3).numFmt = "#,##0.00";
      dataRow.getCell(4).numFmt = "#,##0.00";
      dataRow.getCell(5).numFmt = "0";
      dataRow.getCell(6).numFmt = "#,##0.00";
      dataRow.getCell(8).numFmt = "mm-dd-yy";
      dataRow.getCell(9).numFmt = "mm-dd-yy";
    }
    mergeSameContractCells(worksheet, firstDataRow, worksheet.rowCount, thinBorder, bodyFont);

    const totalRow = worksheet.rowCount + 1;
    worksheet.addRow(["Total", "", "", "", group.totalQuantity, group.totalAmount, group.currency, toExcelDate(group.rows[0]?.startTime), toExcelDate(group.rows[0]?.endTime)]);
    worksheet.mergeCells(totalRow, 1, totalRow, 4);
    styleRow(totalRow, { font: headerFont, height: 28 });
    worksheet.getRow(totalRow).getCell(5).numFmt = "0";
    worksheet.getRow(totalRow).getCell(6).numFmt = "#,##0.00";
    worksheet.getRow(totalRow).getCell(8).numFmt = "mm-dd-yy";
    worksheet.getRow(totalRow).getCell(9).numFmt = "mm-dd-yy";

    const paymentRow = worksheet.rowCount + 1;
    worksheet.mergeCells(paymentRow, 1, paymentRow, 9);
    worksheet.getCell(paymentRow, 1).value = "Payment information of Party B";
    styleRow(paymentRow, { font: headerFont, height: 28, align: { horizontal: "left", vertical: "middle", wrapText: true } });

    const remarksRow = worksheet.rowCount + 1;
    worksheet.getCell(remarksRow, 1).value = "Remarks:";
    worksheet.mergeCells(remarksRow, 2, remarksRow, 9);
    worksheet.getCell(remarksRow, 2).value = "Total:";
    styleRow(remarksRow, { font: headerFont, height: 28, align: { vertical: "middle", wrapText: true } });

    const spacerRow = worksheet.rowCount + 1;
    worksheet.addRow([]);
    worksheet.getRow(spacerRow).height = 28;
    setRangeBorder(spacerRow);

    const signatureRow = worksheet.rowCount + 1;
    worksheet.getCell(signatureRow, 5).value = "Reviewer (Signature) :";
    worksheet.mergeCells(signatureRow, 5, signatureRow, 6);
    worksheet.getCell(signatureRow, 8).value = "Seal (official seal of department) :";
    worksheet.mergeCells(signatureRow, 8, signatureRow, 9);
    styleRow(signatureRow, { font: headerFont, height: 28, align: { vertical: "middle", wrapText: true } });
  }

  worksheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.protection = { locked: false };
    });
  });

  return workbook;
}

function toExcelDate(value: unknown) {
  const text = String(value ?? "").slice(0, 10);
  if (!text) return "";
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? text : date;
}

function mergeSameContractCells(
  worksheet: ExcelJS.Worksheet,
  firstDataRow: number,
  lastDataRow: number,
  border: Partial<ExcelJS.Borders>,
  font: Partial<ExcelJS.Font>,
) {
  let startRow = firstDataRow;
  let currentContract = String(worksheet.getCell(firstDataRow, 1).value ?? "");

  const mergeRange = (from: number, to: number) => {
    if (to <= from) return;
    worksheet.mergeCells(from, 1, to, 1);
    const cell = worksheet.getCell(from, 1);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
    cell.font = font;
  };

  for (let rowNumber = firstDataRow + 1; rowNumber <= lastDataRow + 1; rowNumber += 1) {
    const nextContract = rowNumber <= lastDataRow ? String(worksheet.getCell(rowNumber, 1).value ?? "") : "__END__";
    if (nextContract !== currentContract) {
      mergeRange(startRow, rowNumber - 1);
      startRow = rowNumber;
      currentContract = nextContract;
    }
  }
}

type StatementSectionRange = {
  titleRow: number;
  headerRow: number;
  firstDataRow: number;
  totalRow: number;
  paymentRow: number;
  remarksRow: number;
  signatureRow: number;
};

type WorksheetCell = XLSX.CellObject & {
  s?: Record<string, unknown>;
};

const THIN_BORDER = {
  top: { style: "thin", color: { rgb: "808080" } },
  bottom: { style: "thin", color: { rgb: "808080" } },
  left: { style: "thin", color: { rgb: "808080" } },
  right: { style: "thin", color: { rgb: "808080" } },
};

function applyStatementStyles(worksheet: XLSX.WorkSheet, rowCount: number, sections: StatementSectionRange[]) {
  styleCell(worksheet, 0, 0, {
    font: { bold: true, sz: 16 },
    alignment: { horizontal: "center", vertical: "center" },
  });
  styleCell(worksheet, 1, 0, {
    font: { bold: true, sz: 15 },
    alignment: { horizontal: "center", vertical: "center" },
  });
  styleRow(worksheet, 2, 0, 9, {
    font: { bold: true },
    alignment: { vertical: "center" },
    border: THIN_BORDER,
  });

  for (const section of sections) {
    styleRow(worksheet, section.titleRow, 0, 9, {
      font: { bold: true, sz: 12 },
      fill: { fgColor: { rgb: "D9EAF7" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: THIN_BORDER,
    });
    styleRow(worksheet, section.headerRow, 0, 9, {
      font: { bold: true },
      fill: { fgColor: { rgb: "EDEDED" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: THIN_BORDER,
    });

    for (let rowIndex = section.firstDataRow; rowIndex <= section.totalRow; rowIndex += 1) {
      styleRow(worksheet, rowIndex, 0, 9, {
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: THIN_BORDER,
      });
      setFormat(worksheet, rowIndex, 2, "#,##0.00");
      setFormat(worksheet, rowIndex, 3, "0.00%");
      setFormat(worksheet, rowIndex, 4, "#,##0.00");
      setFormat(worksheet, rowIndex, 5, "#,##0.####");
      setFormat(worksheet, rowIndex, 6, "#,##0.00");
    }

    styleRow(worksheet, section.totalRow, 0, 9, {
      font: { bold: true },
      fill: { fgColor: { rgb: "FFF2CC" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: THIN_BORDER,
    });
    styleRow(worksheet, section.paymentRow, 0, 9, {
      font: { bold: true },
      fill: { fgColor: { rgb: "D9EAD3" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: THIN_BORDER,
    });
    styleRow(worksheet, section.remarksRow, 0, 9, {
      font: { bold: true },
      alignment: { vertical: "center" },
      border: THIN_BORDER,
    });
    styleRow(worksheet, section.signatureRow, 0, 9, {
      font: { bold: true },
      alignment: { vertical: "center" },
      border: THIN_BORDER,
    });
  }

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 10; columnIndex += 1) {
      const cell = getCell(worksheet, rowIndex, columnIndex);
      if (cell) cell.s = { alignment: { vertical: "center", wrapText: true }, ...(cell.s ?? {}) };
    }
  }
}

function styleRow(worksheet: XLSX.WorkSheet, rowIndex: number, firstColumn: number, lastColumn: number, style: Record<string, unknown>) {
  for (let columnIndex = firstColumn; columnIndex <= lastColumn; columnIndex += 1) {
    styleCell(worksheet, rowIndex, columnIndex, style);
  }
}

function styleCell(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number, style: Record<string, unknown>) {
  const cell = ensureCell(worksheet, rowIndex, columnIndex);
  cell.s = { ...(cell.s ?? {}), ...style };
}

function setFormat(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number, format: string) {
  const cell = getCell(worksheet, rowIndex, columnIndex);
  if (cell) cell.z = format;
}

function getCell(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) {
  return worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })] as WorksheetCell | undefined;
}

function ensureCell(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  worksheet[address] = (worksheet[address] ?? { t: "s", v: "" }) as XLSX.CellObject;
  return worksheet[address] as WorksheetCell;
}

function range(startRow: number, startColumn: number, endRow: number, endColumn: number): XLSX.Range {
  return {
    s: { r: startRow, c: startColumn },
    e: { r: endRow, c: endColumn },
  };
}

function summarizeRows(rows: BillingStatementRow[]) {
  return {
    totalQuantity: round(rows.reduce((sum, row) => sum + row.quantity, 0)),
    totalAmount: round(rows.reduce((sum, row) => sum + row.amount, 0)),
  };
}

function buildSnapshotNo(countryCode: string) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `BSS-${countryCode}-${stamp}`;
}

function normalizeDate(value: string) {
  return String(value).slice(0, 10);
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
