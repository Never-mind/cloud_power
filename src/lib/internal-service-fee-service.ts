import { execute, queryRows, type Row } from "./db";
import { attachPartyCodes } from "./party-display";
import { DEFAULT_PAGE_SIZE, normalizePageSize } from "./pagination";
import { appendTableFilterOptionConditions, appendTableInFilter, formatTableDateExpression, getTableFilterOptionsOrderBy, getTableSort, listSqlFilterOptions } from "./table-query";
import {
  buildInternalServiceFeeSchedule,
  firstDayOfMonth,
  type InternalServiceAdjustment,
  type InternalServicePricingAdjustment,
  type InternalServiceLedgerInput,
  type InternalServiceMonthlyRow,
} from "./internal-service-fee-workflow";

type LedgerRow = InternalServiceLedgerInput & {
  internalServiceFeeTotal?: number;
  first24MonthPrice?: number;
  next36MonthPrice?: number;
};

export async function syncInternalServiceLedgers(ledgerIds?: string[]) {
  const requestedLedgerIds = Array.from(new Set((ledgerIds ?? []).map((ledgerId) => ledgerId.trim()).filter(Boolean)));
  const ledgers = await queryRows<LedgerRow>(
    `
      SELECT
        billing.ledgerId, billing.countryCode, billing.batchName, billing.requestNo, billing.poNo, billing.deviceCode, billing.modelCode, billing.nameEn,
        COALESCE(NULLIF(billing.supplierId, ''), requestItem.supplierId, requestByBusinessKey.supplierId) AS supplierId,
        COALESCE(NULLIF(billing.undertakingUnitId, ''), requestItem.undertakingUnitId, requestByBusinessKey.undertakingUnitId) AS undertakingUnitId,
        COALESCE(NULLIF(billing.customerId, ''), requestItem.customerId, requestByBusinessKey.customerId) AS customerId,
        billing.quantity, billing.contractCurrency AS currency, COALESCE(country.vatRate, billing.vatRate, 0) AS vatRate, billing.first24MonthPrice, billing.next36MonthPrice,
        COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0) AS procurementTaxExcludedUnitPrice,
        COALESCE(purchaseItem.taxSurcharge, billing.taxSurcharge, 0) AS procurementTaxSurcharge,
        DATE_FORMAT(billing.startMonth, '%Y-%m-%d') AS startMonth
      FROM billinginstanceledgers billing
      LEFT JOIN countries country ON country.code = billing.countryCode
      LEFT JOIN purchaseorderitems purchaseItem ON purchaseItem.id = billing.purchaseOrderItemId
      LEFT JOIN requestitems requestItem ON requestItem.id = purchaseItem.requestItemId
      LEFT JOIN requestitems requestByBusinessKey ON requestByBusinessKey.requestNo = billing.requestNo AND requestByBusinessKey.deviceCode = billing.deviceCode
      ${requestedLedgerIds.length ? "WHERE billing.ledgerId IN (:ledgerIds)" : ""}
    `,
    requestedLedgerIds.length ? { ledgerIds: requestedLedgerIds } : {},
  );
  for (const ledger of ledgers) await regenerateInternalServiceLedger(ledger.ledgerId);
  return { count: ledgers.length };
}

export async function listAvailableInternalServiceLedgers(searchParams: URLSearchParams) {
  const keyword = searchParams.get("keyword")?.trim();
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  const conditions = ["internal.ledgerId IS NULL"];
  const params: Row = {};
  if (keyword) {
    conditions.push("(billing.requestNo LIKE :keyword OR billing.poNo LIKE :keyword OR billing.deviceCode LIKE :keyword OR billing.batchName LIKE :keyword)");
    params.keyword = `%${keyword}%`;
  }
  const filterExpressions: Record<string, string> = {
    countryCode: "billing.countryCode", batchName: "billing.batchName", requestNo: "billing.requestNo", poNo: "billing.poNo",
    deviceCode: "billing.deviceCode", modelCode: "billing.modelCode", nameEn: "billing.nameEn", quantity: "billing.quantity", currency: "billing.contractCurrency",
    revenueExcludingTax: "monthly.revenueIncludingTax", procurementCost: "COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0)",
    expectedInternalServiceFee: "monthly.revenueIncludingTax - COALESCE(billing.quantity, 0) * (COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0) + COALESCE(purchaseItem.taxSurcharge, billing.taxSurcharge, 0))",
  };
  for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(conditions, params, expression, field, searchParams, "internalAvailable");
  const where = `WHERE ${conditions.join(" AND ")}`;
  const requestedSort = getTableSort(searchParams, filterExpressions);
  const sourceFrom = `
      FROM billinginstanceledgers billing
      LEFT JOIN internalserviceledgers internal ON internal.ledgerId = billing.ledgerId
      LEFT JOIN countries country ON country.code = billing.countryCode
      LEFT JOIN purchaseorderitems purchaseItem ON purchaseItem.id = billing.purchaseOrderItemId
      LEFT JOIN requestitems requestItem ON requestItem.id = purchaseItem.requestItemId
      LEFT JOIN requestitems requestByBusinessKey ON requestByBusinessKey.requestNo = billing.requestNo AND requestByBusinessKey.deviceCode = billing.deviceCode
      LEFT JOIN (
        SELECT ledgerId, SUM(COALESCE(monthlyTotalAmount, 0)) AS revenueIncludingTax
        FROM monthlybillingwriteoffs GROUP BY ledgerId
      ) monthly ON monthly.ledgerId = billing.ledgerId
      ${where}
  `;
  const [{ total: totalValue }] = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total ${sourceFrom}`, params);
  const total = Number(totalValue ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await queryRows<Row>(
    `
      SELECT billing.ledgerId, billing.countryCode, billing.batchName, billing.requestNo, billing.poNo,
        billing.deviceCode, billing.modelCode, billing.nameEn,
        COALESCE(NULLIF(billing.supplierId, ''), requestItem.supplierId, requestByBusinessKey.supplierId) AS supplierId,
        COALESCE(NULLIF(billing.undertakingUnitId, ''), requestItem.undertakingUnitId, requestByBusinessKey.undertakingUnitId) AS undertakingUnitId,
        COALESCE(NULLIF(billing.customerId, ''), requestItem.customerId, requestByBusinessKey.customerId) AS customerId,
        billing.quantity, billing.contractCurrency AS currency,
        COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0) AS taxExcludedUnitPrice,
        COALESCE(purchaseItem.taxSurcharge, billing.taxSurcharge, 0) AS taxSurcharge, COALESCE(country.vatRate, billing.vatRate, 0) AS vatRate, billing.startMonth, monthly.revenueIncludingTax,
        ROUND(COALESCE(monthly.revenueIncludingTax, 0) / (1 + COALESCE(country.vatRate, billing.vatRate, 0)), 2) AS revenueExcludingTax,
        ROUND(COALESCE(billing.quantity, 0) * (COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0) + COALESCE(purchaseItem.taxSurcharge, billing.taxSurcharge, 0)), 2) AS procurementCost,
        ROUND(COALESCE(monthly.revenueIncludingTax, 0) / (1 + COALESCE(country.vatRate, billing.vatRate, 0)) - COALESCE(billing.quantity, 0) * (COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0) + COALESCE(purchaseItem.taxSurcharge, billing.taxSurcharge, 0)), 2) AS expectedInternalServiceFee
      ${sourceFrom}
      ${requestedSort || "ORDER BY billing.createdAt DESC"}
      LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: pageSize, offset: (page - 1) * pageSize },
  );
  return { rows: await attachPartyCodes(rows), total, page, pageSize, totalPages };
}

export async function listAvailableInternalServiceFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    countryCode: "billing.countryCode", batchName: "billing.batchName", requestNo: "billing.requestNo", poNo: "billing.poNo",
    deviceCode: "billing.deviceCode", modelCode: "billing.modelCode", nameEn: "billing.nameEn", quantity: "billing.quantity", currency: "billing.contractCurrency",
    revenueExcludingTax: "monthly.revenueIncludingTax", procurementCost: "COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0)",
    expectedInternalServiceFee: "monthly.revenueIncludingTax - COALESCE(billing.quantity, 0) * (COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0) + COALESCE(purchaseItem.taxSurcharge, billing.taxSurcharge, 0))",
  };
  return listSqlFilterOptions({
    expressions,
    searchParams,
    from: `billinginstanceledgers billing
      LEFT JOIN internalserviceledgers internal ON internal.ledgerId = billing.ledgerId
      LEFT JOIN purchaseorderitems purchaseItem ON purchaseItem.id = billing.purchaseOrderItemId
      LEFT JOIN (
        SELECT ledgerId, SUM(COALESCE(monthlyTotalAmount, 0)) AS revenueIncludingTax
        FROM monthlybillingwriteoffs GROUP BY ledgerId
      ) monthly ON monthly.ledgerId = billing.ledgerId`,
    conditions: ["internal.ledgerId IS NULL"],
  });
}

export async function listInternalServiceAdjustments(searchParams: URLSearchParams) {
  const keyword = searchParams.get("keyword")?.trim();
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  const conditions: string[] = [];
  const params: Row = {};
  if (keyword) {
    conditions.push("(adjustmentNo LIKE :keyword OR requestNo LIKE :keyword OR poNo LIKE :keyword OR deviceCode LIKE :keyword)");
    params.keyword = `%${keyword}%`;
  }
  const filterExpressions: Record<string, string> = {
    adjustmentNo: "adjustmentNo", countryCode: "countryCode", batchName: "batchName", requestNo: "requestNo", poNo: "poNo", deviceCode: "deviceCode",
    startMonth: formatTableDateExpression("startMonth"), endMonth: formatTableDateExpression("endMonth"), monthlyAmount: "monthlyAmount", reason: "reason", status: "status", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(conditions, params, expression, field, searchParams, "internalAdjustment");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [{ total: totalValue }] = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM internalservicefeeadjustments ${where}`, params);
  const total = Number(totalValue ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await queryRows<Row>(
    `
      SELECT adjustmentNo, ledgerId, countryCode, batchName, requestNo, poNo, deviceCode,
        supplierId, undertakingUnitId, customerId, DATE_FORMAT(startMonth, '%Y-%m-%d') AS startMonth,
        DATE_FORMAT(endMonth, '%Y-%m-%d') AS endMonth, monthlyAmount, reason, status,
        DATE_FORMAT(confirmedAt, '%Y-%m-%d') AS confirmedAt,
        DATE_FORMAT(createdAt, '%Y-%m-%d') AS createdAt,
        DATE_FORMAT(updatedAt, '%Y-%m-%d') AS updatedAt
      FROM internalservicefeeadjustments
      ${where}
      ${getTableSort(searchParams, filterExpressions) || "ORDER BY confirmedAt DESC, adjustmentNo DESC"}
      LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: pageSize, offset: (page - 1) * pageSize },
  );
  return { rows: await attachPartyCodes(rows), total, page, pageSize, totalPages };
}

export async function listInternalServiceAdjustmentFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    adjustmentNo: "adjustmentNo", countryCode: "countryCode", batchName: "batchName", requestNo: "requestNo", poNo: "poNo", deviceCode: "deviceCode",
    startMonth: formatTableDateExpression("startMonth"), endMonth: formatTableDateExpression("endMonth"), monthlyAmount: "monthlyAmount", reason: "reason", status: "status", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  return listSqlFilterOptions({ from: "internalservicefeeadjustments", expressions, searchParams });
}

export async function listInternalServiceSnapshots(searchParams: URLSearchParams) {
  const snapshotNo = searchParams.get("snapshotNo")?.trim();
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  const requestedItemPage = Math.max(1, Math.floor(Number(searchParams.get("itemPage") ?? 1) || 1));
  const itemPageSize = normalizePageSize(Number(searchParams.get("itemPageSize") ?? DEFAULT_PAGE_SIZE));
  const snapshotExpressions: Record<string, string> = {
    snapshotNo: "snapshotNo", archiveMonth: formatTableDateExpression("archiveMonth"), countryCode: "countryCode", itemCount: "itemCount", totalAmount: "totalAmount", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  const snapshotConditions: string[] = [];
  const params: Row = {};
  const snapshotSearchParams = new URLSearchParams(searchParams);
  if (searchParams.get("snapshotSortField")) snapshotSearchParams.set("sortField", searchParams.get("snapshotSortField") ?? "");
  if (searchParams.get("snapshotSortOrder")) snapshotSearchParams.set("sortOrder", searchParams.get("snapshotSortOrder") ?? "");
  for (const [field, expression] of Object.entries(snapshotExpressions)) appendTableInFilter(snapshotConditions, params, expression, field, searchParams, "internalSnapshot");
  const snapshotWhere = snapshotConditions.length ? `WHERE ${snapshotConditions.join(" AND ")}` : "";
  const [{ total: totalValue }] = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM internalservicefeesnapshots ${snapshotWhere}`, params);
  const total = Number(totalValue ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const snapshots = await queryRows<Row>(
    `SELECT snapshotNo, DATE_FORMAT(archiveMonth, '%Y-%m-%d') AS archiveMonth, countryCode, itemCount, totalAmount,
       DATE_FORMAT(confirmedAt, '%Y-%m-%d') AS confirmedAt,
       DATE_FORMAT(createdAt, '%Y-%m-%d') AS createdAt,
       DATE_FORMAT(updatedAt, '%Y-%m-%d') AS updatedAt
       FROM internalservicefeesnapshots ${snapshotWhere} ${getTableSort(snapshotSearchParams, snapshotExpressions) || "ORDER BY archiveMonth DESC, snapshotNo DESC"} LIMIT :limit OFFSET :offset`,
    { ...params, limit: pageSize, offset: (page - 1) * pageSize },
  );
  const itemExpressions: Record<string, string> = {
    writeOffMonth: formatTableDateExpression("writeOffMonth"), countryCode: "countryCode", batchName: "batchName", requestNo: "requestNo", poNo: "poNo", deviceCode: "deviceCode", currency: "currency", internalServiceFeeAmount: "internalServiceFeeAmount", sourceType: "sourceType", adjustmentNo: "adjustmentNo", createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  const itemConditions: string[] = [];
  const itemParams: Row = {};
  if (snapshotNo) { itemConditions.push("snapshotNo = :snapshotNo"); itemParams.snapshotNo = snapshotNo; }
  for (const [field, expression] of Object.entries(itemExpressions)) appendTableInFilter(itemConditions, itemParams, expression, field, searchParams, "internalSnapshotItem", "itemFilter");
  const itemWhere = itemConditions.length ? `WHERE ${itemConditions.join(" AND ")}` : "WHERE 1 = 0";
  const [{ total: itemTotalValue }] = snapshotNo ? await queryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM internalservicefeesnapshotitems ${itemWhere}`, itemParams) : [{ total: 0 }];
  const itemTotal = Number(itemTotalValue ?? 0);
  const itemTotalPages = Math.max(1, Math.ceil(itemTotal / itemPageSize));
  const itemPage = Math.min(requestedItemPage, itemTotalPages);
  const items = snapshotNo ? await queryRows<Row>(
    `SELECT id, snapshotNo, monthlyFeeId, ledgerId,
       DATE_FORMAT(writeOffMonth, '%Y-%m-%d') AS writeOffMonth,
       countryCode, batchName, requestNo, poNo, deviceCode, supplierId, undertakingUnitId, customerId,
       currency, internalServiceFeeAmount, sourceType, adjustmentNo,
       DATE_FORMAT(createdAt, '%Y-%m-%d') AS createdAt,
       DATE_FORMAT(updatedAt, '%Y-%m-%d') AS updatedAt
       FROM internalservicefeesnapshotitems ${itemWhere} ${getTableSort(searchParams, itemExpressions) || "ORDER BY id"} LIMIT :limit OFFSET :offset`,
    { ...itemParams, limit: itemPageSize, offset: (itemPage - 1) * itemPageSize },
  ) : [];
  return { snapshots, items: await attachPartyCodes(items), total, page, pageSize, totalPages, itemTotal, itemPage, itemPageSize, itemTotalPages };
}

export async function listInternalServiceSnapshotFilterOptions(searchParams: URLSearchParams) {
  const itemScope = searchParams.get("scope") === "items";
  if (itemScope) {
    const expressions: Record<string, string> = {
      writeOffMonth: formatTableDateExpression("writeOffMonth"), countryCode: "countryCode", batchName: "batchName", requestNo: "requestNo", poNo: "poNo", deviceCode: "deviceCode", currency: "currency", internalServiceFeeAmount: "internalServiceFeeAmount", sourceType: "sourceType", adjustmentNo: "adjustmentNo", createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
    };
    const snapshotNo = searchParams.get("snapshotNo")?.trim() ?? "";
    return listSqlFilterOptions({ from: "internalservicefeesnapshotitems", expressions, searchParams, queryPrefix: "itemFilter", conditions: snapshotNo ? ["snapshotNo = :snapshotNo"] : ["1 = 0"], params: snapshotNo ? { snapshotNo } : {} });
  }
  const expressions: Record<string, string> = {
    snapshotNo: "snapshotNo", archiveMonth: "archiveMonth", countryCode: "countryCode", itemCount: "itemCount", totalAmount: "totalAmount", confirmedAt: "confirmedAt", createdAt: "createdAt", updatedAt: "updatedAt",
  };
  return listSqlFilterOptions({ from: "internalservicefeesnapshots", expressions, searchParams });
}

export async function regenerateInternalServiceLedger(ledgerId: string) {
  const ledger = await getLedger(ledgerId);
  if (!ledger) throw new Error("未找到对应的月账单台账");
  const [billingRows, existingRows, adjustments, pricingAdjustments] = await Promise.all([
    queryRows<Row>(
      "SELECT monthlyTotalAmount FROM monthlybillingwriteoffs WHERE ledgerId = :ledgerId ORDER BY monthIndex",
      { ledgerId },
    ),
    queryRows<Row>(
      `
        SELECT id, DATE_FORMAT(writeOffMonth, '%Y-%m-%d') AS writeOffMonth, monthIndex,
          internalServiceFeeAmount, sourceType, adjustmentNo, archived
        FROM monthlyinternalservicefees
        WHERE ledgerId = :ledgerId
        ORDER BY monthIndex
      `,
      { ledgerId },
    ),
    listConfirmedAdjustments(ledgerId),
    listPricingAdjustments(ledger),
  ]);
  if (billingRows.length !== 60) throw new Error("月账单每月明细不完整，无法生成内部服务费");

  const result = buildInternalServiceFeeSchedule({
    ledger,
    billingMonthlyAmounts: Array.from({ length: 60 }, (_, index) => Number(ledger.quantity ?? 0) * Number(index < 24 ? ledger.first24MonthPrice ?? 0 : ledger.next36MonthPrice ?? 0)),
    existingRows: existingRows.map((row) => ({
      ...ledger,
      id: String(row.id),
      writeOffMonth: String(row.writeOffMonth),
      monthIndex: Number(row.monthIndex),
      internalServiceFeeAmount: Number(row.internalServiceFeeAmount ?? 0),
      sourceType: String(row.sourceType) === "manual" ? "manual" : "auto",
      adjustmentNo: String(row.adjustmentNo ?? ""),
      archived: Boolean(row.archived),
    })) as InternalServiceMonthlyRow[],
    adjustments,
    pricingAdjustments,
  });

  await execute(
    `
      INSERT INTO internalserviceledgers
        (ledgerId, countryCode, batchName, requestNo, poNo, deviceCode, modelCode, nameEn,
         supplierId, undertakingUnitId, customerId, quantity, currency, vatRate, procurementTaxExcludedUnitPrice,
         procurementTaxSurcharge, contractRevenueIncludingTax, contractRevenueExcludingTax,
         procurementCost, internalServiceFeeTotal, archivedAmount, manualAmount, remainingAmount,
         unallocatedAmount, startMonth, status)
      VALUES
        (:ledgerId, :countryCode, :batchName, :requestNo, :poNo, :deviceCode, :modelCode, :nameEn,
         :supplierId, :undertakingUnitId, :customerId, :quantity, :currency, :vatRate, :procurementTaxExcludedUnitPrice,
         :procurementTaxSurcharge, :contractRevenueIncludingTax, :contractRevenueExcludingTax,
         :procurementCost, :internalServiceFeeTotal, :archivedAmount, :manualAmount, :remainingAmount,
         :unallocatedAmount, :startMonth, '已生成')
      ON DUPLICATE KEY UPDATE
        countryCode = VALUES(countryCode), batchName = VALUES(batchName), requestNo = VALUES(requestNo),
        poNo = VALUES(poNo), deviceCode = VALUES(deviceCode), modelCode = VALUES(modelCode), nameEn = VALUES(nameEn),
        supplierId = VALUES(supplierId), undertakingUnitId = VALUES(undertakingUnitId), customerId = VALUES(customerId), quantity = VALUES(quantity),
        currency = VALUES(currency), vatRate = VALUES(vatRate),
        procurementTaxExcludedUnitPrice = VALUES(procurementTaxExcludedUnitPrice),
        procurementTaxSurcharge = VALUES(procurementTaxSurcharge),
        contractRevenueIncludingTax = VALUES(contractRevenueIncludingTax),
        contractRevenueExcludingTax = VALUES(contractRevenueExcludingTax), procurementCost = VALUES(procurementCost),
        internalServiceFeeTotal = VALUES(internalServiceFeeTotal), archivedAmount = VALUES(archivedAmount),
        manualAmount = VALUES(manualAmount), remainingAmount = VALUES(remainingAmount),
        unallocatedAmount = VALUES(unallocatedAmount), startMonth = VALUES(startMonth), status = VALUES(status)
    `,
    { ...ledger, ...result },
  );

  for (const row of result.rows) {
    await execute(
      `
        INSERT INTO monthlyinternalservicefees
          (id, ledgerId, writeOffMonth, monthIndex, countryCode, batchName, requestNo, poNo,
           deviceCode, modelCode, nameEn, supplierId, undertakingUnitId, customerId, quantity, currency,
           internalServiceFeeAmount, sourceType, adjustmentNo, archived)
        VALUES
          (:id, :ledgerId, :writeOffMonth, :monthIndex, :countryCode, :batchName, :requestNo, :poNo,
           :deviceCode, :modelCode, :nameEn, :supplierId, :undertakingUnitId, :customerId, :quantity, :currency,
           :internalServiceFeeAmount, :sourceType, :adjustmentNo, :archived)
        ON DUPLICATE KEY UPDATE
          internalServiceFeeAmount = VALUES(internalServiceFeeAmount), sourceType = VALUES(sourceType),
          adjustmentNo = VALUES(adjustmentNo), supplierId = VALUES(supplierId), undertakingUnitId = VALUES(undertakingUnitId), customerId = VALUES(customerId),
          archived = VALUES(archived)
      `,
      row,
    );
  }
  return result;
}

export async function listInternalServiceFees(searchParams: URLSearchParams) {
  const params: Row = {};
  const where: string[] = [];
  const keyword = searchParams.get("keyword")?.trim();
  const countryCode = searchParams.get("countryCode")?.trim();
  const batchName = searchParams.get("batchName")?.trim();
  const startMonth = searchParams.get("startMonth")?.trim();
  const endMonth = searchParams.get("endMonth")?.trim();
  const exportAll = searchParams.get("export") === "1";
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  const filterExpressions: Record<string, string> = {
    writeOffMonth: "fee.writeOffMonth", countryCode: "fee.countryCode", batchName: "fee.batchName", requestNo: "fee.requestNo", poNo: "fee.poNo",
    deviceCode: "fee.deviceCode", modelCode: "fee.modelCode", nameEn: "fee.nameEn", quantity: "fee.quantity", currency: "fee.currency",
    internalServiceFeeAmount: "fee.internalServiceFeeAmount", sourceType: "fee.sourceType", adjustmentNo: "fee.adjustmentNo", archived: "fee.archived",
  };
  for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(where, params, expression, field, searchParams, "internalServiceFee");
  if (keyword) {
    where.push("(fee.ledgerId LIKE :keyword OR fee.requestNo LIKE :keyword OR fee.poNo LIKE :keyword OR fee.deviceCode LIKE :keyword OR fee.nameEn LIKE :keyword)");
    params.keyword = `%${keyword}%`;
  }
  if (countryCode) { where.push("fee.countryCode = :countryCode"); params.countryCode = countryCode; }
  if (batchName) { where.push("fee.batchName = :batchName"); params.batchName = batchName; }
  if (startMonth) { where.push("fee.writeOffMonth >= :startMonth"); params.startMonth = firstDayOfMonth(startMonth); }
  if (endMonth) { where.push("fee.writeOffMonth <= :endMonth"); params.endMonth = firstDayOfMonth(endMonth); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [{ total, totalAmount }] = await queryRows<{ total: number; totalAmount: number }>(
    `
      SELECT COUNT(*) AS total, COALESCE(SUM(fee.internalServiceFeeAmount), 0) AS totalAmount
      FROM monthlyinternalservicefees AS fee
      ${whereSql}
    `,
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
      SELECT fee.id, fee.ledgerId, DATE_FORMAT(fee.writeOffMonth, '%Y-%m-%d') AS writeOffMonth,
        fee.monthIndex, fee.countryCode, fee.batchName, fee.requestNo, fee.poNo, fee.deviceCode,
        fee.modelCode, fee.nameEn, fee.supplierId, fee.undertakingUnitId, fee.customerId,
        fee.quantity, fee.currency, fee.internalServiceFeeAmount, fee.sourceType, fee.adjustmentNo,
        fee.archived, fee.archiveSnapshotNo, DATE_FORMAT(fee.archivedAt, '%Y-%m-%d') AS archivedAt,
        DATE_FORMAT(fee.createdAt, '%Y-%m-%d') AS createdAt,
        DATE_FORMAT(fee.updatedAt, '%Y-%m-%d') AS updatedAt
      FROM monthlyinternalservicefees fee
      ${whereSql}
      ${getTableSort(searchParams, filterExpressions) || "ORDER BY fee.writeOffMonth DESC, fee.ledgerId"}
      ${exportAll ? "" : "LIMIT :limit OFFSET :offset"}
    `,
    params,
  );
  return {
    rows: await attachPartyCodes(rows),
    total: normalizedTotal,
    totalAmount: Number(totalAmount ?? 0),
    page,
    pageSize,
    totalPages,
  };
}

export async function listInternalServiceFeeFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    writeOffMonth: formatTableDateExpression("writeOffMonth"), countryCode: "countryCode", batchName: "batchName", requestNo: "requestNo", poNo: "poNo", deviceCode: "deviceCode",
    modelCode: "modelCode", nameEn: "nameEn", quantity: "quantity", currency: "currency", internalServiceFeeAmount: "internalServiceFeeAmount",
    sourceType: "sourceType", adjustmentNo: "adjustmentNo", archived: "archived",
  };
  const field = searchParams.get("field")?.trim() ?? "";
  const expression = expressions[field];
  if (!expression) return { options: [] as Array<{ value: string; count: number }> };
  const params: Row = {};
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const where = [`${expression} IS NOT NULL`, `TRIM(CAST(${expression} AS CHAR)) <> ''`];
  if (keyword) { where.push(`${expression} LIKE :optionKeyword`); params.optionKeyword = `%${keyword}%`; }
  appendTableFilterOptionConditions(where, params, expressions, searchParams, field);
  const rows = await queryRows<{ value: string; count: number }>(`SELECT ${expression} AS value, COUNT(*) AS count FROM monthlyinternalservicefees WHERE ${where.join(" AND ")} GROUP BY ${expression} ORDER BY ${getTableFilterOptionsOrderBy(field, expression)} LIMIT 500`, params);
  return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
}

export async function saveInternalServiceAdjustment(input: {
  ledgerId: string;
  startMonth: string;
  endMonth: string;
  monthlyAmount: number;
  reason?: string;
}) {
  const ledger = await getLedger(input.ledgerId);
  if (!ledger) throw new Error("月账单台账不存在");
  const startMonth = firstDayOfMonth(input.startMonth);
  const endMonth = firstDayOfMonth(input.endMonth);
  if (!startMonth || !endMonth || startMonth > endMonth) throw new Error("调整月份范围不正确");
  if (!Number.isFinite(Number(input.monthlyAmount))) throw new Error("每月内部服务费金额不正确");
  const adjustmentNo = `IFS-${Date.now()}`;
  await execute(
    `
      INSERT INTO internalservicefeeadjustments
        (adjustmentNo, ledgerId, countryCode, batchName, requestNo, poNo, deviceCode, supplierId,
         undertakingUnitId, customerId, startMonth, endMonth, monthlyAmount, reason, status, confirmedAt)
      VALUES
        (:adjustmentNo, :ledgerId, :countryCode, :batchName, :requestNo, :poNo, :deviceCode, :supplierId,
         :undertakingUnitId, :customerId, :startMonth, :endMonth, :monthlyAmount, :reason, '已确认', CURRENT_TIMESTAMP)
    `,
    { adjustmentNo, ...ledger, startMonth, endMonth, monthlyAmount: Number(input.monthlyAmount), reason: String(input.reason ?? "").trim() },
  );
  await regenerateInternalServiceLedger(input.ledgerId);
  return { adjustmentNo };
}

export async function deleteInternalServiceAdjustment(adjustmentNo: string) {
  const rows = await queryRows<Row>(
    "SELECT ledgerId FROM internalservicefeeadjustments WHERE adjustmentNo = :adjustmentNo LIMIT 1",
    { adjustmentNo },
  );
  const ledgerId = String(rows[0]?.ledgerId ?? "");
  if (!ledgerId) throw new Error("内部服务费调整单不存在");
  const archivedRows = await queryRows<Row>(
    "SELECT COUNT(*) AS count FROM monthlyinternalservicefees WHERE adjustmentNo = :adjustmentNo AND archived = 1",
    { adjustmentNo },
  );
  if (Number(archivedRows[0]?.count ?? 0) > 0) throw new Error("该调整已包含归档月份，不能撤销");
  await execute("DELETE FROM internalservicefeeadjustments WHERE adjustmentNo = :adjustmentNo", { adjustmentNo });
  await regenerateInternalServiceLedger(ledgerId);
  return { adjustmentNo, ledgerId };
}

export async function archiveInternalServiceFees(input: { countryCode?: string; archiveMonth: string }) {
  const archiveMonth = firstDayOfMonth(input.archiveMonth);
  if (!archiveMonth) throw new Error("归档月份不正确");
  const countryCode = input.countryCode?.trim() ?? "";
  const rows = await queryRows<Row>(
    `
      SELECT * FROM monthlyinternalservicefees
      WHERE writeOffMonth = :archiveMonth
      ${countryCode ? "AND countryCode = :countryCode" : ""}
      AND archived = 0
    `,
    { archiveMonth, countryCode },
  );
  if (!rows.length) throw new Error("该月份没有可归档的内部服务费明细");
  const snapshotNo = `ISF-SNAP-${archiveMonth.replaceAll("-", "")}-${Date.now()}`;
  const totalAmount = rows.reduce((total, row) => total + Number(row.internalServiceFeeAmount ?? 0), 0);
  await execute(
    `INSERT INTO internalservicefeesnapshots (snapshotNo, archiveMonth, countryCode, itemCount, totalAmount, confirmedAt)
     VALUES (:snapshotNo, :archiveMonth, :countryCode, :itemCount, :totalAmount, CURRENT_TIMESTAMP)`,
    { snapshotNo, archiveMonth, countryCode, itemCount: rows.length, totalAmount },
  );
  for (const [index, row] of rows.entries()) {
    await execute(
      `INSERT INTO internalservicefeesnapshotitems
        (id, snapshotNo, monthlyFeeId, ledgerId, writeOffMonth, countryCode, batchName, requestNo, poNo,
         deviceCode, supplierId, undertakingUnitId, customerId, currency, internalServiceFeeAmount, sourceType, adjustmentNo)
       VALUES
        (:id, :snapshotNo, :monthlyFeeId, :ledgerId, :writeOffMonth, :countryCode, :batchName, :requestNo, :poNo,
         :deviceCode, :supplierId, :undertakingUnitId, :customerId, :currency, :internalServiceFeeAmount, :sourceType, :adjustmentNo)`,
      { ...row, snapshotNo, monthlyFeeId: row.id, id: `${snapshotNo}-${String(index + 1).padStart(4, "0")}` },
    );
  }
  await execute(
    `UPDATE monthlyinternalservicefees SET archived = 1, archivedAt = CURRENT_TIMESTAMP, archiveSnapshotNo = :snapshotNo
     WHERE writeOffMonth = :archiveMonth ${countryCode ? "AND countryCode = :countryCode" : ""}`,
    { snapshotNo, archiveMonth, countryCode },
  );
  const ledgerIds = Array.from(new Set(rows.map((row) => String(row.ledgerId))));
  for (const ledgerId of ledgerIds) await regenerateInternalServiceLedger(ledgerId);
  return { snapshotNo, itemCount: rows.length };
}

async function getLedger(ledgerId: string) {
  const rows = await queryRows<LedgerRow>(
    `
      SELECT billing.ledgerId, billing.countryCode, billing.batchName, billing.requestNo, billing.poNo, billing.deviceCode, billing.modelCode, billing.nameEn,
        COALESCE(NULLIF(billing.supplierId, ''), requestItem.supplierId, requestByBusinessKey.supplierId) AS supplierId,
        COALESCE(NULLIF(billing.undertakingUnitId, ''), requestItem.undertakingUnitId, requestByBusinessKey.undertakingUnitId) AS undertakingUnitId,
        COALESCE(NULLIF(billing.customerId, ''), requestItem.customerId, requestByBusinessKey.customerId) AS customerId,
        billing.quantity, billing.contractCurrency AS currency, COALESCE(country.vatRate, billing.vatRate, 0) AS vatRate, billing.first24MonthPrice, billing.next36MonthPrice,
        COALESCE(purchaseItem.taxExcludedUnitPrice, billing.taxExcludedUnitPrice, 0) AS procurementTaxExcludedUnitPrice,
        COALESCE(purchaseItem.taxSurcharge, billing.taxSurcharge, 0) AS procurementTaxSurcharge,
        DATE_FORMAT(billing.startMonth, '%Y-%m-%d') AS startMonth
      FROM billinginstanceledgers billing
      LEFT JOIN countries country ON country.code = billing.countryCode
      LEFT JOIN purchaseorderitems purchaseItem ON purchaseItem.id = billing.purchaseOrderItemId
      LEFT JOIN requestitems requestItem ON requestItem.id = purchaseItem.requestItemId
      LEFT JOIN requestitems requestByBusinessKey ON requestByBusinessKey.requestNo = billing.requestNo AND requestByBusinessKey.deviceCode = billing.deviceCode
      WHERE billing.ledgerId = :ledgerId LIMIT 1
    `,
    { ledgerId },
  );
  const row = rows[0];
  return row ? normalizeLedger(row) : null;
}

async function listConfirmedAdjustments(ledgerId: string): Promise<InternalServiceAdjustment[]> {
  const rows = await queryRows<Row>(
    `SELECT adjustmentNo, DATE_FORMAT(startMonth, '%Y-%m-%d') AS startMonth, DATE_FORMAT(endMonth, '%Y-%m-%d') AS endMonth,
       monthlyAmount, confirmedAt
     FROM internalservicefeeadjustments WHERE ledgerId = :ledgerId AND status = '已确认'`,
    { ledgerId },
  );
  return rows.map((row) => ({
    adjustmentNo: String(row.adjustmentNo), startMonth: String(row.startMonth), endMonth: String(row.endMonth),
    monthlyAmount: Number(row.monthlyAmount ?? 0), confirmedAt: String(row.confirmedAt ?? ""),
  }));
}

async function listPricingAdjustments(ledger: LedgerRow): Promise<InternalServicePricingAdjustment[]> {
  const rows = await queryRows<Row>(
    `
      SELECT bai.adjustmentNo, DATE_FORMAT(bai.effectiveMonth, '%Y-%m-%d') AS effectiveMonth,
        bai.adjustedFirst24MonthPrice, bai.adjustedNext36MonthPrice, ba.confirmedAt
      FROM billingadjustments ba
      INNER JOIN billingadjustmentitems bai ON bai.adjustmentNo = ba.adjustmentNo
      WHERE bai.countryCode = :countryCode
        AND bai.batchName = :batchName
        AND (bai.requestNo = :requestNo OR bai.requestNo = '')
        AND bai.deviceCode = :deviceCode
        AND ba.confirmedAt IS NOT NULL
      ORDER BY bai.effectiveMonth ASC, ba.confirmedAt ASC, bai.adjustmentNo ASC
    `,
    { countryCode: ledger.countryCode, batchName: ledger.batchName, requestNo: ledger.requestNo, deviceCode: ledger.deviceCode },
  );

  const timeline = Array.from({ length: 60 }, (_, index) => {
    const month = addMonths(ledger.startMonth, index);
    const effective = rows.filter((row) => month >= String(row.effectiveMonth));
    if (!effective.length) return null;
    return effective.sort((left, right) => {
      const confirmedDiff = getTime(right.confirmedAt) - getTime(left.confirmedAt);
      return confirmedDiff || String(right.adjustmentNo).localeCompare(String(left.adjustmentNo));
    })[0];
  });

  const adjustments: InternalServicePricingAdjustment[] = [];
  let previousAdjustmentNo = "";
  timeline.forEach((row, index) => {
    const adjustmentNo = String(row?.adjustmentNo ?? "");
    if (!adjustmentNo || adjustmentNo === previousAdjustmentNo) {
      previousAdjustmentNo = adjustmentNo;
      return;
    }
    adjustments.push({
      adjustmentNo,
      effectiveMonth: addMonths(ledger.startMonth, index),
      first24MonthlyAmount: Number(row?.adjustedFirst24MonthPrice ?? 0) * Number(ledger.quantity ?? 0),
      next36MonthlyAmount: Number(row?.adjustedNext36MonthPrice ?? 0) * Number(ledger.quantity ?? 0),
    });
    previousAdjustmentNo = adjustmentNo;
  });
  return adjustments;
}

function normalizeLedger(row: LedgerRow): LedgerRow {
  return {
    ...row,
    supplierId: String(row.supplierId ?? ""), undertakingUnitId: String(row.undertakingUnitId ?? ""), customerId: String(row.customerId ?? ""),
    quantity: Number(row.quantity ?? 0), vatRate: Number(row.vatRate ?? 0),
    procurementTaxExcludedUnitPrice: Number(row.procurementTaxExcludedUnitPrice ?? 0),
    procurementTaxSurcharge: Number(row.procurementTaxSurcharge ?? 0),
    first24MonthPrice: Number(row.first24MonthPrice ?? 0), next36MonthPrice: Number(row.next36MonthPrice ?? 0),
    startMonth: String(row.startMonth), currency: String(row.currency ?? ""),
  };
}

function addMonths(startMonth: string, offset: number) {
  const date = new Date(`${firstDayOfMonth(startMonth)}T00:00:00`);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function getTime(value: unknown) {
  const time = new Date(String(value ?? "").replace(" ", "T")).getTime();
  return Number.isNaN(time) ? 0 : time;
}
