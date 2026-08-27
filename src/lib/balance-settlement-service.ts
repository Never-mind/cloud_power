import { randomUUID } from "node:crypto";
import { execute, queryRows, type Row } from "./db";
import { attachPartyCodes } from "./party-display";
import { calculateNonInstanceLine, validateNonInstanceLine } from "./non-instance-settlement-import";
import { appendTableInFilter, formatTableDateExpression, getTableSort, listSqlFilterOptions } from "./table-query";

const DRAFT = "\u8349\u7a3f";
const CONFIRMED = "\u5df2\u786e\u8ba4";
const VOIDED = "\u5df2\u4f5c\u5e9f";
const INSTANCE = "\u5b9e\u4f8b";
const SPARE_PART = "\u5907\u4ef6";
const NON_INSTANCE_EXPENSE = "\u975e\u5b9e\u4f8b\u8d39\u7528";

export const BALANCE_SETTLEMENT_STATUSES = [DRAFT, CONFIRMED, VOIDED] as const;
export const BALANCE_ITEM_TYPES = [INSTANCE, SPARE_PART, NON_INSTANCE_EXPENSE] as const;

export type BalanceCalculationInput = {
  quantity?: unknown;
  purchaseCapexUnitPrice?: unknown;
  purchaseOpexUnitPrice?: unknown;
  settlementRate?: unknown;
  anchorCapexUnitPrice?: unknown;
  anchorOpexUnitPrice?: unknown;
};

export type BalanceCalculation = {
  settlementCapexUnitPrice: number;
  settlementOpexUnitPrice: number;
  capexDifferenceUnitPrice: number;
  capexDifferenceTotal: number;
  opexDifferenceUnitPrice: number;
  opexDifferenceTotal: number;
  differenceTotal: number;
};

export type ManualBalanceItemInput = {
  itemType: string;
  countryCode?: string;
  batchName?: string;
  requestNo?: string;
  poNo?: string;
  deviceCode?: string;
  nameEn?: string;
  quantity?: number | string;
  procurementCurrency?: string;
  purchaseCapexUnitPrice?: number | string;
  purchaseOpexUnitPrice?: number | string;
  settlementCurrency?: string;
  settlementRate?: number | string;
  anchorCapexUnitPrice?: number | string;
  anchorOpexUnitPrice?: number | string;
  expenseCategory?: string;
  expenseName?: string;
  expenseType?: string;
  differenceNature?: string;
  expenseDate?: string;
  documentNo?: string;
  deviceNodeQuantity?: number | string;
  deliveryQuantity?: number | string;
  settlementQuantity?: number | string;
  taxExcludedUnitPriceUsd?: number | string;
  priceConfirmation?: string;
  paymentExchangeRate?: number | string;
  taxExcludedTotalUsd?: number | string;
  taxExcludedTotalCny?: number | string;
  equipmentTotalUsd?: number | string;
  localTaxRate?: number | string;
  calculatedTaxAmountUsd?: number | string;
  feeCurrency?: string;
  feeAmount?: number | string;
  expenseProvider?: string;
  usdExchangeRate?: number | string;
  settlementAmountUsd?: number | string;
  issRate?: number | string;
  issExcludedAmountUsd?: number | string;
  confirmationResult?: string;
  sourceReference?: string;
  notes?: string;
};

type CandidateRow = Row & {
  id: string;
  countryCode: string | null;
  procurementCurrency: string | null;
  capexUnitPrice: number | string | null;
  opexUnitPrice: number | string | null;
  quantity: number | string | null;
  deviceCode: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function dateValue(value: unknown) {
  return text(value).slice(0, 10);
}

function requiredText(value: unknown, label: string) {
  const result = text(value);
  if (!result) throw new Error(`${label}\u4e0d\u80fd\u4e3a\u7a7a`);
  return result;
}

function nextSettlementNo() {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `JS-${day}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function hasProvidedMoney(value: unknown) {
  return value !== null && value !== undefined && text(value) !== "";
}

function rateReason() {
  return "\u8bf7\u586b\u5199\u91c7\u8d2d\u5e01\u79cd\u5151USD\u7684\u7ed3\u5dee\u6c47\u7387";
}

function normalizeSettlementRate(currency: unknown, rate?: unknown) {
  if (text(currency).toUpperCase() === "USD") return 1;
  return numberValue(rate);
}

export function calculateBalanceSettlement(input: BalanceCalculationInput): BalanceCalculation {
  const quantity = numberValue(input.quantity, 1);
  const settlementRate = numberValue(input.settlementRate);
  if (settlementRate <= 0) throw new Error("\u7ed3\u5dee\u6c47\u7387\u5fc5\u987b\u5927\u4e8e0");

  const rawSettlementCapexUnitPrice = numberValue(input.purchaseCapexUnitPrice) / settlementRate;
  const rawSettlementOpexUnitPrice = numberValue(input.purchaseOpexUnitPrice) / settlementRate;
  const rawCapexDifferenceUnitPrice = rawSettlementCapexUnitPrice - numberValue(input.anchorCapexUnitPrice);
  const rawOpexDifferenceUnitPrice = rawSettlementOpexUnitPrice - numberValue(input.anchorOpexUnitPrice);
  const settlementCapexUnitPrice = money(rawSettlementCapexUnitPrice);
  const settlementOpexUnitPrice = money(rawSettlementOpexUnitPrice);
  const capexDifferenceUnitPrice = money(rawCapexDifferenceUnitPrice);
  const opexDifferenceUnitPrice = money(rawOpexDifferenceUnitPrice);
  // Keep the workbook rule: totals use the unrounded unit difference, then round once.
  const capexDifferenceTotal = money(rawCapexDifferenceUnitPrice * quantity);
  const opexDifferenceTotal = money(rawOpexDifferenceUnitPrice * quantity);

  return {
    settlementCapexUnitPrice,
    settlementOpexUnitPrice,
    capexDifferenceUnitPrice,
    capexDifferenceTotal,
    opexDifferenceUnitPrice,
    opexDifferenceTotal,
    differenceTotal: money(capexDifferenceTotal + opexDifferenceTotal),
  };
}

export async function listSettlementPricingVersions(countryCode = "") {
  const rows = await queryRows<Row>(
    `
      SELECT versionId, versionNo, countryCode, effectiveDate, confirmedAt, createdAt
      FROM capexpricingversions
      WHERE status = :status ${countryCode ? "AND countryCode = :countryCode" : ""}
      ORDER BY effectiveDate DESC, confirmedAt DESC, createdAt DESC
    `,
    countryCode ? { status: CONFIRMED, countryCode } : { status: CONFIRMED },
  );
  return rows;
}

async function findPricingVersion(pricingVersionId: string) {
  const rows = await queryRows<Row>(
    "SELECT * FROM capexpricingversions WHERE versionId = :pricingVersionId AND status = :status LIMIT 1",
    { pricingVersionId, status: CONFIRMED },
  );
  return rows[0];
}

async function getAnchors(pricingVersionId: string) {
  if (!pricingVersionId) return new Map<string, Row>();
  const rows = await queryRows<Row>(
    `
      SELECT id, deviceCode, capexAnchorUsd, opexAnchorUsd
      FROM capexpricingitems
      WHERE versionId = :pricingVersionId
      ORDER BY lineNo ASC
    `,
    { pricingVersionId },
  );
  const anchors = new Map<string, Row>();
  for (const row of rows) {
    const deviceCode = text(row.deviceCode);
    if (deviceCode && !anchors.has(deviceCode)) anchors.set(deviceCode, row);
  }
  return anchors;
}

function candidateMissingReasons(candidate: CandidateRow, anchor?: Row, hasPricingVersion = false, inputRate?: unknown) {
  const rate = normalizeSettlementRate(candidate.procurementCurrency, inputRate ?? candidate.settlementRate);
  return [
    ...(hasProvidedMoney(candidate.capexUnitPrice) ? [] : ["\u672a\u7ef4\u62a4\u91c7\u8d2dCAPEX\u5355\u4ef7"]),
    ...(hasProvidedMoney(candidate.opexUnitPrice) ? [] : ["\u672a\u7ef4\u62a4\u91c7\u8d2dOPEX\u5355\u4ef7"]),
    ...(anchor ? [] : [hasPricingVersion ? "\u8be5\u7248\u672c\u672a\u5339\u914d\u5b9e\u4f8b\u951a\u5b9a\u4ef7" : "\u8bf7\u9009\u62e9CAPEX/OPEX\u951a\u5b9a\u4ef7\u683c\u7248\u672c"]),
    ...(rate > 0 ? [] : [rateReason()]),
  ];
}

function enrichCandidate(candidate: CandidateRow, version?: Row, anchor?: Row, inputRate?: unknown) {
  const settlementRate = normalizeSettlementRate(candidate.procurementCurrency, inputRate ?? candidate.settlementRate);
  const missingReasons = candidateMissingReasons(candidate, anchor, Boolean(version), settlementRate);
  const calculation = missingReasons.length
    ? {}
    : calculateBalanceSettlement({
        quantity: candidate.quantity,
        purchaseCapexUnitPrice: candidate.capexUnitPrice,
        purchaseOpexUnitPrice: candidate.opexUnitPrice,
        settlementRate,
        anchorCapexUnitPrice: anchor?.capexAnchorUsd,
        anchorOpexUnitPrice: anchor?.opexAnchorUsd,
      });

  return {
    ...candidate,
    pricingVersionId: text(version?.versionId),
    pricingVersionNo: text(version?.versionNo),
    anchorItemId: text(anchor?.id),
    anchorCapexUnitPrice: anchor?.capexAnchorUsd ?? null,
    anchorOpexUnitPrice: anchor?.opexAnchorUsd ?? null,
    settlementCurrency: "USD",
    settlementRate,
    missingReasons,
    canGenerate: missingReasons.length === 0,
    ...calculation,
  };
}

export async function listInstanceSettlementCandidates({
  countryCode = "",
  pricingVersionId = "",
  keyword = "",
  page = 1,
  pageSize = 20,
  purchaseOrderItemIds = [],
  searchParams,
}: {
  countryCode?: string;
  pricingVersionId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  purchaseOrderItemIds?: string[];
  searchParams?: URLSearchParams;
}) {
  const version = pricingVersionId ? await findPricingVersion(pricingVersionId) : undefined;
  if (pricingVersionId && !version) throw new Error("\u951a\u5b9a\u4ef7\u683c\u7248\u672c\u4e0d\u5b58\u5728\u6216\u5c1a\u672a\u786e\u8ba4");
  const appliedCountryCode = text(version?.countryCode) || text(countryCode);
  const conditions = ["po.status = :purchaseStatus", "(req.requestType IS NULL OR req.requestType <> :spareType)"];
  const params: Row = { purchaseStatus: CONFIRMED, spareType: SPARE_PART, pricingVersionId: text(pricingVersionId) };

  if (appliedCountryCode) {
    conditions.push("req.countryCode = :countryCode");
    params.countryCode = appliedCountryCode;
  }
  if (keyword.trim()) {
    conditions.push(`(
      req.batchName LIKE :keyword OR poi.poNo LIKE :keyword OR COALESCE(poi.requestNo, ri.requestNo) LIKE :keyword
      OR ri.deviceCode LIKE :keyword OR im.nameEn LIKE :keyword OR im.modelCode LIKE :keyword
    )`);
    params.keyword = `%${keyword.trim()}%`;
  }
  conditions.push(`NOT EXISTS (
    SELECT 1
    FROM balancesettlementitems existingItem
    INNER JOIN balancesettlements existingSettlement ON existingSettlement.settlementNo = existingItem.settlementNo
    WHERE existingItem.purchaseOrderItemId = poi.id
      AND existingItem.itemType = :instanceType
      AND existingSettlement.status <> :voidedStatus
  )`);
  params.instanceType = INSTANCE;
  params.voidedStatus = VOIDED;
  const selectedIds = Array.from(new Set(purchaseOrderItemIds.map(text).filter(Boolean)));
  if (selectedIds.length) {
    conditions.push("poi.id IN (:purchaseOrderItemIds)");
    params.purchaseOrderItemIds = selectedIds;
  }
  const filterExpressions: Record<string, string> = {
    countryCode: "req.countryCode", batchName: "req.batchName", requestNo: "COALESCE(poi.requestNo, ri.requestNo)", poNo: "poi.poNo",
    deviceCode: "ri.deviceCode", modelCode: "im.modelCode", nameEn: "im.nameEn", undertakingUnitCode: "undertaking.undertakingUnitCode", supplierCode: "supplier.supplierCode", customerCode: "customer.customerCode", quantity: "ri.quantity", procurementCurrency: "po.currency",
    capexUnitPrice: "poi.capexUnitPrice", opexUnitPrice: "poi.opexUnitPrice", anchorCapexUnitPrice: "anchor.capexAnchorUsd", anchorOpexUnitPrice: "anchor.opexAnchorUsd",
  };
  if (searchParams) for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(conditions, params, expression, field, searchParams, "balanceCandidate");

  const from = `
    FROM purchaseorderitems poi
    INNER JOIN purchaseorders po ON po.purchaseOrderId = poi.purchaseOrderId
      OR ((poi.purchaseOrderId IS NULL OR poi.purchaseOrderId = '') AND po.poNo = poi.poNo)
    LEFT JOIN requestitems ri ON ri.id = poi.requestItemId
    LEFT JOIN requests req ON req.requestNo = COALESCE(poi.requestNo, ri.requestNo, po.requestNo)
    LEFT JOIN instancemodels im ON im.deviceCode = ri.deviceCode
    LEFT JOIN suppliers supplier ON supplier.supplierId = ri.supplierId
    LEFT JOIN undertakingunits undertaking ON undertaking.undertakingUnitId = ri.undertakingUnitId
    LEFT JOIN customers customer ON customer.customerId = ri.customerId
    LEFT JOIN capexpricingitems anchor ON anchor.versionId = :pricingVersionId AND anchor.deviceCode = ri.deviceCode
    LEFT JOIN (
      SELECT purchaseOrderItemId, MAX(deliveredAt) AS receiptDate
      FROM shipments
      WHERE purchaseOrderItemId IS NOT NULL AND purchaseOrderItemId <> ''
      GROUP BY purchaseOrderItemId
    ) shipment ON shipment.purchaseOrderItemId = poi.id
    WHERE ${conditions.join(" AND ")}
  `;
  const [{ total: totalValue }] = await queryRows<{ total: number }>(
    `SELECT COUNT(*) AS total ${from}`,
    params,
  );
  const total = Number(totalValue ?? 0);
  // The interactive list is capped, but creating a draft must process all
  // explicitly selected lines even when the selection spans several pages.
  const safePageSize = selectedIds.length
    ? Math.max(selectedIds.length, 1)
    : Math.min(100, Math.max(1, Math.floor(numberValue(pageSize, 20))));
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(numberValue(page, 1))), totalPages);

  const rows = await queryRows<CandidateRow>(
    `
      SELECT
        poi.id, poi.purchaseOrderId, poi.poNo, COALESCE(poi.requestNo, ri.requestNo) AS requestNo, poi.requestItemId,
        poi.taxExcludedUnitPrice, poi.taxSurcharge, poi.unitPrice, poi.capexUnitPrice, poi.opexUnitPrice,
        po.currency AS procurementCurrency, po.paymentDate, po.releasedAt,
        req.countryCode, req.batchName, req.requestType,
        ri.deviceCode, ri.quantity, ri.supplierId, ri.undertakingUnitId, ri.customerId,
        im.modelCode, im.nameEn,
        shipment.receiptDate
      ${from}
      ${searchParams ? (getTableSort(searchParams, filterExpressions) || "ORDER BY req.batchName DESC, po.createdAt DESC, poi.id") : "ORDER BY req.batchName DESC, po.createdAt DESC, poi.id"}
      LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: safePageSize, offset: (safePage - 1) * safePageSize },
  );

  const anchors = await getAnchors(text(version?.versionId));
  const normalized = await attachPartyCodes(rows.map((row) => enrichCandidate(row, version, anchors.get(text(row.deviceCode)))));

  return {
    rows: normalized,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    version: version ?? null,
  };
}

export async function listInstanceSettlementCandidateFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    countryCode: "req.countryCode", batchName: "req.batchName", requestNo: "COALESCE(poi.requestNo, ri.requestNo)", poNo: "poi.poNo",
    deviceCode: "ri.deviceCode", modelCode: "im.modelCode", nameEn: "im.nameEn", undertakingUnitCode: "undertaking.undertakingUnitCode", supplierCode: "supplier.supplierCode", customerCode: "customer.customerCode", quantity: "ri.quantity", procurementCurrency: "po.currency",
    capexUnitPrice: "poi.capexUnitPrice", opexUnitPrice: "poi.opexUnitPrice", anchorCapexUnitPrice: "anchor.capexAnchorUsd", anchorOpexUnitPrice: "anchor.opexAnchorUsd",
  };
  const pricingVersionId = text(searchParams.get("pricingVersionId"));
  const selectedCountry = text(searchParams.get("countryCode"));
  const conditions = [
    "po.status = :purchaseStatus", "(req.requestType IS NULL OR req.requestType <> :spareType)",
    "NOT EXISTS (SELECT 1 FROM balancesettlementitems existingItem INNER JOIN balancesettlements existingSettlement ON existingSettlement.settlementNo = existingItem.settlementNo WHERE existingItem.purchaseOrderItemId = poi.id AND existingItem.itemType = :instanceType AND existingSettlement.status <> :voidedStatus)",
  ];
  if (selectedCountry) conditions.push("req.countryCode = :candidateCountry");
  return listSqlFilterOptions({
    expressions,
    searchParams,
    from: `purchaseorderitems poi
      INNER JOIN purchaseorders po ON po.purchaseOrderId = poi.purchaseOrderId OR ((poi.purchaseOrderId IS NULL OR poi.purchaseOrderId = '') AND po.poNo = poi.poNo)
      LEFT JOIN requestitems ri ON ri.id = poi.requestItemId
      LEFT JOIN requests req ON req.requestNo = COALESCE(poi.requestNo, ri.requestNo, po.requestNo)
      LEFT JOIN instancemodels im ON im.deviceCode = ri.deviceCode
      LEFT JOIN suppliers supplier ON supplier.supplierId = ri.supplierId
      LEFT JOIN undertakingunits undertaking ON undertaking.undertakingUnitId = ri.undertakingUnitId
      LEFT JOIN customers customer ON customer.customerId = ri.customerId
      LEFT JOIN capexpricingitems anchor ON anchor.versionId = :pricingVersionId AND anchor.deviceCode = ri.deviceCode`,
    conditions,
    params: { purchaseStatus: CONFIRMED, spareType: SPARE_PART, instanceType: INSTANCE, voidedStatus: VOIDED, pricingVersionId, ...(selectedCountry ? { candidateCountry: selectedCountry } : {}) },
  });
}

export async function createInstanceSettlementDraft({
  pricingVersionId,
  purchaseOrderItemIds,
  settlementRates = {},
  title,
  notes,
  periodStart,
  periodEnd,
}: {
  pricingVersionId: string;
  purchaseOrderItemIds: string[];
  settlementRates?: Record<string, number | string>;
  title?: string;
  notes?: string;
  periodStart?: string;
  periodEnd?: string;
}) {
  const version = await findPricingVersion(requiredText(pricingVersionId, "CAPEX/OPEX\u951a\u5b9a\u4ef7\u683c\u7248\u672c"));
  if (!version) throw new Error("\u8bf7\u9009\u62e9\u5df2\u786e\u8ba4\u7684CAPEX/OPEX\u951a\u5b9a\u4ef7\u683c\u7248\u672c");
  const selectedIds = new Set(purchaseOrderItemIds.map(text).filter(Boolean));
  if (!selectedIds.size) throw new Error("\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u6761\u5f85\u751f\u6210\u5b9e\u4f8b\u7ed3\u5dee");

  const available = await listInstanceSettlementCandidates({
    countryCode: text(version.countryCode),
    pricingVersionId: text(version.versionId),
    purchaseOrderItemIds: Array.from(selectedIds),
    pageSize: selectedIds.size,
  });
  const anchors = await getAnchors(text(version.versionId));
  const selected = available.rows
    .filter((row) => selectedIds.has(text(row.id)))
    .map((row) => enrichCandidate(row as CandidateRow, version, anchors.get(text(row.deviceCode)), settlementRates[text(row.id)]));

  if (selected.length !== selectedIds.size) {
    throw new Error("\u90e8\u5206\u5df2\u9009\u660e\u7ec6\u5df2\u751f\u6210\u7ed3\u5dee\u5355\u6216\u4e0d\u5728\u5f53\u524d\u951a\u5b9a\u4ef7\u7248\u672c\u9002\u7528\u8303\u56f4");
  }
  const invalid = selected.filter((row) => !row.canGenerate);
  if (invalid.length) {
    const firstReason = Array.isArray(invalid[0]?.missingReasons) ? invalid[0].missingReasons[0] : "\u6570\u636e\u4e0d\u5b8c\u6574";
    throw new Error(`\u5b58\u5728 ${invalid.length} \u6761\u65e0\u6cd5\u751f\u6210\u7684\u660e\u7ec6\uff1a${String(firstReason)}`);
  }

  const settlementNo = nextSettlementNo();
  const rows = selected.map((candidate, index) => buildInstanceItem({
    candidate,
    version,
    settlementNo,
    lineNo: index + 1,
    settlementRate: settlementRates[text(candidate.id)],
  }));
  await insertSettlement({
    settlementNo,
    title: text(title) || `${text(version.countryCode)} \u5b9e\u4f8bCAPEX/OPEX\u7ed3\u5dee`,
    countryCode: text(version.countryCode),
    pricingVersionId: text(version.versionId),
    pricingVersionNo: text(version.versionNo),
    currency: "USD",
    notes: text(notes),
    periodStart: dateValue(periodStart) || null,
    periodEnd: dateValue(periodEnd) || null,
    rows,
  });
  return getBalanceSettlement(settlementNo);
}

export async function createManualSettlement({
  title,
  countryCode,
  currency = "USD",
  sourceFileName,
  notes,
  periodStart,
  periodEnd,
  items,
}: {
  title?: string;
  countryCode?: string;
  currency?: string;
  sourceFileName?: string;
  notes?: string;
  periodStart?: string;
  periodEnd?: string;
  items: ManualBalanceItemInput[];
}) {
  if (!items.length) throw new Error("\u8bf7\u81f3\u5c11\u6dfb\u52a0\u4e00\u6761\u7ed3\u5dee\u660e\u7ec6");
  const settlementNo = nextSettlementNo();
  const rows = items.map((item, index) => buildManualItem({
    item,
    settlementNo,
    lineNo: index + 1,
    fallbackCountryCode: text(countryCode),
    currency,
  }));
  await insertSettlement({
    settlementNo,
    title: text(title) || `${text(countryCode) || "\u591a\u56fd\u5bb6"}\u7ed3\u5dee\u5355`,
    countryCode: text(countryCode) || null,
    pricingVersionId: null,
    pricingVersionNo: null,
    currency: text(currency) || "USD",
    sourceFileName: text(sourceFileName) || null,
    notes: text(notes),
    periodStart: dateValue(periodStart) || null,
    periodEnd: dateValue(periodEnd) || null,
    rows,
  });
  return getBalanceSettlement(settlementNo);
}

export async function listBalanceSettlements({
  countryCode = "",
  status = "",
  keyword = "",
  page = 1,
  pageSize = 20,
  searchParams,
}: {
  countryCode?: string;
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  searchParams?: URLSearchParams;
}) {
  const conditions: string[] = [];
  const params: Row = {};
  if (countryCode) { conditions.push("countryCode = :countryCode"); params.countryCode = countryCode; }
  if (status) { conditions.push("status = :status"); params.status = status; }
  if (keyword.trim()) {
    conditions.push("(settlementNo LIKE :keyword OR title LIKE :keyword OR pricingVersionNo LIKE :keyword)");
    params.keyword = `%${keyword.trim()}%`;
  }
  const filterExpressions: Record<string, string> = {
    settlementNo: "settlement.settlementNo", title: "settlement.title", itemTypes: "(SELECT GROUP_CONCAT(DISTINCT itemType ORDER BY itemType SEPARATOR ', ') FROM balancesettlementitems itemFilter WHERE itemFilter.settlementNo = settlement.settlementNo)",
    countryCode: "settlement.countryCode", pricingVersionNo: "settlement.pricingVersionNo", currency: "settlement.currency", status: "settlement.status", itemCount: "settlement.itemCount",
    capexDifferenceTotal: "settlement.capexDifferenceTotal", opexDifferenceTotal: "settlement.opexDifferenceTotal", differenceTotal: "settlement.differenceTotal", confirmedAt: formatTableDateExpression("settlement.confirmedAt"), createdAt: formatTableDateExpression("settlement.createdAt"), updatedAt: formatTableDateExpression("settlement.updatedAt"),
  };
  if (searchParams) for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(conditions, params, expression, field, searchParams, "balanceSettlement");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [{ total: totalValue }] = await queryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM balancesettlements settlement ${where}`,
    params,
  );
  const total = Number(totalValue ?? 0);
  const safePageSize = Math.min(100, Math.max(1, Math.floor(numberValue(pageSize, 20))));
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(numberValue(page, 1))), totalPages);
  const rows = await queryRows<Row>(
    `
      SELECT settlement.*,
             (
               SELECT GROUP_CONCAT(DISTINCT item.itemType ORDER BY item.itemType SEPARATOR ', ')
               FROM balancesettlementitems item
               WHERE item.settlementNo = settlement.settlementNo
             ) AS itemTypes
      FROM balancesettlements settlement
      ${where}
      ${searchParams ? (getTableSort(searchParams, filterExpressions) || "ORDER BY settlement.createdAt DESC") : "ORDER BY settlement.createdAt DESC"}
      LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: safePageSize, offset: (safePage - 1) * safePageSize },
  );
  return { rows, total, page: safePage, pageSize: safePageSize, totalPages };
}

export async function listBalanceSettlementFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    settlementNo: "settlementNo", title: "title", countryCode: "countryCode", pricingVersionNo: "pricingVersionNo", currency: "currency", status: "status", itemCount: "itemCount",
    capexDifferenceTotal: "capexDifferenceTotal", opexDifferenceTotal: "opexDifferenceTotal", differenceTotal: "differenceTotal", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  return listSqlFilterOptions({ from: "balancesettlements", expressions, searchParams });
}

export async function getBalanceSettlement(settlementNo: string) {
  const master = (await queryRows<Row>(
    "SELECT * FROM balancesettlements WHERE settlementNo = :settlementNo LIMIT 1",
    { settlementNo },
  ))[0];
  if (!master) return null;
  const items = await queryRows<Row>(
    `
      SELECT item.*, supplier.supplierCode, undertaking.undertakingUnitCode, customer.customerCode
      FROM balancesettlementitems item
      LEFT JOIN suppliers supplier ON supplier.supplierId = item.supplierId
      LEFT JOIN undertakingunits undertaking ON undertaking.undertakingUnitId = item.undertakingUnitId
      LEFT JOIN customers customer ON customer.customerId = item.customerId
      WHERE item.settlementNo = :settlementNo
      ORDER BY item.lineNo ASC
    `,
    { settlementNo },
  );
  return { master, items };
}

export async function confirmBalanceSettlement(settlementNo: string) {
  const detail = await getBalanceSettlement(settlementNo);
  if (!detail) throw new Error("\u7ed3\u5dee\u5355\u4e0d\u5b58\u5728");
  if (text(detail.master.status) === CONFIRMED) return detail;
  if (text(detail.master.status) !== DRAFT) throw new Error("\u53ea\u6709\u8349\u7a3f\u7ed3\u5dee\u5355\u53ef\u4ee5\u786e\u8ba4");
  if (!detail.items.length) throw new Error("\u7ed3\u5dee\u5355\u81f3\u5c11\u9700\u8981\u4e00\u6761\u660e\u7ec6");
  await execute(
    "UPDATE balancesettlements SET status = :status, confirmedAt = NOW() WHERE settlementNo = :settlementNo",
    { status: CONFIRMED, settlementNo },
  );
  return getBalanceSettlement(settlementNo);
}

export async function voidBalanceSettlement(settlementNo: string) {
  const detail = await getBalanceSettlement(settlementNo);
  if (!detail) throw new Error("\u7ed3\u5dee\u5355\u4e0d\u5b58\u5728");
  if (text(detail.master.status) === CONFIRMED) {
    throw new Error("\u5df2\u786e\u8ba4\u7ed3\u5dee\u5355\u4e0d\u53ef\u4f5c\u5e9f\uff0c\u8bf7\u4fdd\u7559\u5ba1\u8ba1\u8bb0\u5f55");
  }
  if (text(detail.master.status) === VOIDED) return detail;
  await execute(
    "UPDATE balancesettlements SET status = :status WHERE settlementNo = :settlementNo",
    { status: VOIDED, settlementNo },
  );
  return getBalanceSettlement(settlementNo);
}

export async function getBalanceSettlementSummary({ countryCode = "" }: { countryCode?: string }) {
  return queryRows<Row>(
    `
      SELECT settlement.settlementNo, settlement.title,
             COALESCE(NULLIF(settlement.countryCode, ''), GROUP_CONCAT(DISTINCT NULLIF(item.countryCode, ''))) AS countryCode,
             GROUP_CONCAT(DISTINCT NULLIF(item.itemType, '')) AS itemTypes,
             settlement.pricingVersionNo, settlement.currency, settlement.periodStart, settlement.periodEnd,
             settlement.sourceFileName, settlement.notes, settlement.confirmedAt, settlement.createdAt,
             settlement.itemCount, settlement.capexDifferenceTotal, settlement.opexDifferenceTotal, settlement.differenceTotal
      FROM balancesettlements settlement
      LEFT JOIN balancesettlementitems item ON item.settlementNo = settlement.settlementNo
      WHERE settlement.status = :status ${countryCode ? "AND (settlement.countryCode = :countryCode OR item.countryCode = :countryCode)" : ""}
      GROUP BY settlement.settlementNo, settlement.title, settlement.countryCode, settlement.pricingVersionNo, settlement.currency,
               settlement.periodStart, settlement.periodEnd, settlement.sourceFileName, settlement.notes, settlement.confirmedAt,
               settlement.createdAt, settlement.itemCount, settlement.capexDifferenceTotal, settlement.opexDifferenceTotal, settlement.differenceTotal
      ORDER BY COALESCE(settlement.periodEnd, settlement.periodStart, DATE(settlement.confirmedAt), DATE(settlement.createdAt)) DESC,
               settlement.confirmedAt DESC, settlement.createdAt DESC
    `,
    countryCode ? { status: CONFIRMED, countryCode } : { status: CONFIRMED },
  );
}

function buildInstanceItem({
  candidate,
  version,
  settlementNo,
  lineNo,
  settlementRate,
}: {
  candidate: Row;
  version: Row;
  settlementNo: string;
  lineNo: number;
  settlementRate?: number | string;
}) {
  const rate = normalizeSettlementRate(candidate.procurementCurrency, settlementRate ?? candidate.settlementRate);
  const calculation = calculateBalanceSettlement({
    quantity: candidate.quantity,
    purchaseCapexUnitPrice: candidate.capexUnitPrice,
    purchaseOpexUnitPrice: candidate.opexUnitPrice,
    settlementRate: rate,
    anchorCapexUnitPrice: candidate.anchorCapexUnitPrice,
    anchorOpexUnitPrice: candidate.anchorOpexUnitPrice,
  });
  return {
    id: `BSI-${randomUUID()}`,
    settlementNo,
    lineNo,
    itemType: INSTANCE,
    countryCode: text(candidate.countryCode),
    batchName: text(candidate.batchName),
    requestNo: text(candidate.requestNo),
    poNo: text(candidate.poNo),
    purchaseOrderItemId: text(candidate.id),
    requestItemId: text(candidate.requestItemId),
    deviceCode: text(candidate.deviceCode),
    modelCode: text(candidate.modelCode),
    nameEn: text(candidate.nameEn),
    supplierId: text(candidate.supplierId),
    undertakingUnitId: text(candidate.undertakingUnitId),
    customerId: text(candidate.customerId),
    quantity: numberValue(candidate.quantity, 1),
    receiptDate: dateValue(candidate.receiptDate) || null,
    paymentDate: dateValue(candidate.paymentDate) || null,
    procurementCurrency: text(candidate.procurementCurrency),
    purchaseUnitPrice: numberValue(candidate.unitPrice),
    purchaseCapexUnitPrice: numberValue(candidate.capexUnitPrice),
    purchaseOpexUnitPrice: numberValue(candidate.opexUnitPrice),
    settlementCurrency: "USD",
    settlementRate: rate,
    anchorVersionId: text(version.versionId),
    anchorVersionNo: text(version.versionNo),
    anchorItemId: text(candidate.anchorItemId),
    anchorCapexUnitPrice: numberValue(candidate.anchorCapexUnitPrice),
    anchorOpexUnitPrice: numberValue(candidate.anchorOpexUnitPrice),
    expenseCategory: null,
    expenseName: null,
    expenseType: null,
    differenceNature: null,
    expenseDate: null,
    documentNo: null,
    deviceNodeQuantity: null,
    deliveryQuantity: null,
    settlementQuantity: null,
    taxExcludedUnitPriceUsd: null,
    priceConfirmation: null,
    paymentExchangeRate: null,
    taxExcludedTotalUsd: null,
    taxExcludedTotalCny: null,
    equipmentTotalUsd: null,
    localTaxRate: null,
    calculatedTaxAmountUsd: null,
    feeCurrency: null,
    feeAmount: null,
    expenseProvider: null,
    usdExchangeRate: null,
    settlementAmountUsd: null,
    issRate: null,
    issExcludedAmountUsd: null,
    confirmationResult: null,
    sourceReference: null,
    sourceSnapshotJson: JSON.stringify({ candidate, version }),
    notes: null,
    ...calculation,
  };
}

function buildManualItem({
  item,
  settlementNo,
  lineNo,
  fallbackCountryCode,
  currency,
}: {
  item: ManualBalanceItemInput;
  settlementNo: string;
  lineNo: number;
  fallbackCountryCode: string;
  currency: string;
}) {
  const itemType = requiredText(item.itemType, "\u7ed3\u5dee\u7c7b\u578b");
  if (!BALANCE_ITEM_TYPES.includes(itemType as (typeof BALANCE_ITEM_TYPES)[number])) {
    throw new Error("\u7ed3\u5dee\u7c7b\u578b\u5fc5\u987b\u4e3a\u5b9e\u4f8b\u3001\u5907\u4ef6\u6216\u975e\u5b9e\u4f8b\u8d39\u7528");
  }
  const procurementCurrency = text(item.procurementCurrency) || text(currency) || "USD";
  const settlementRate = normalizeSettlementRate(procurementCurrency, item.settlementRate);
  const structured = itemType === NON_INSTANCE_EXPENSE && text(item.expenseType);
  const structuredCalculation = structured
    ? calculateNonInstanceLine(text(item.expenseType), item as unknown as Record<string, unknown>)
    : null;
  const structuredErrors = structured
    ? validateNonInstanceLine(text(item.expenseType), item as unknown as Record<string, unknown>)
    : [];
  if (structuredErrors.length) {
    throw new Error(`${text(item.expenseType)}：${structuredErrors[0]}`);
  }
  const calculation = structuredCalculation
    ? structuredCalculation.values
    : calculateBalanceSettlement({
        quantity: item.quantity,
        purchaseCapexUnitPrice: item.purchaseCapexUnitPrice,
        purchaseOpexUnitPrice: item.purchaseOpexUnitPrice,
        settlementRate,
        anchorCapexUnitPrice: item.anchorCapexUnitPrice,
        anchorOpexUnitPrice: item.anchorOpexUnitPrice,
      });
  return {
    id: `BSI-${randomUUID()}`,
    settlementNo,
    lineNo,
    itemType,
    countryCode: requiredText(item.countryCode || fallbackCountryCode, "\u56fd\u5bb6"),
    batchName: text(item.batchName),
    requestNo: text(item.requestNo),
    poNo: text(item.poNo),
    purchaseOrderItemId: null,
    requestItemId: null,
    deviceCode: text(item.deviceCode),
    modelCode: null,
    nameEn: text(item.nameEn),
    supplierId: null,
    undertakingUnitId: null,
    customerId: null,
    quantity: numberValue(item.quantity, 1),
    receiptDate: null,
    paymentDate: null,
    procurementCurrency,
    purchaseUnitPrice: null,
    purchaseCapexUnitPrice: numberValue(item.purchaseCapexUnitPrice),
    purchaseOpexUnitPrice: numberValue(item.purchaseOpexUnitPrice),
    settlementCurrency: text(item.settlementCurrency) || "USD",
    settlementRate,
    anchorVersionId: null,
    anchorVersionNo: null,
    anchorItemId: null,
    anchorCapexUnitPrice: numberValue(item.anchorCapexUnitPrice),
    anchorOpexUnitPrice: numberValue(item.anchorOpexUnitPrice),
    expenseCategory: text(item.expenseCategory),
    expenseName: text(item.expenseName),
    expenseType: text(item.expenseType),
    differenceNature: text(item.differenceNature).toUpperCase() || null,
    expenseDate: dateValue(item.expenseDate) || null,
    documentNo: text(item.documentNo),
    deviceNodeQuantity: numberValue(item.deviceNodeQuantity),
    deliveryQuantity: numberValue(item.deliveryQuantity),
    settlementQuantity: numberValue(item.settlementQuantity ?? item.deliveryQuantity ?? item.quantity, 1),
    taxExcludedUnitPriceUsd: numberValue(item.taxExcludedUnitPriceUsd),
    priceConfirmation: text(item.priceConfirmation),
    paymentExchangeRate: numberValue(item.paymentExchangeRate),
    taxExcludedTotalUsd: numberValue(item.taxExcludedTotalUsd),
    taxExcludedTotalCny: numberValue(item.taxExcludedTotalCny),
    equipmentTotalUsd: numberValue(item.equipmentTotalUsd),
    localTaxRate: numberValue(item.localTaxRate),
    feeCurrency: text(item.feeCurrency),
    feeAmount: numberValue(item.feeAmount),
    expenseProvider: text(item.expenseProvider),
    usdExchangeRate: numberValue(item.usdExchangeRate),
    settlementAmountUsd: structured ? numberValue(structuredCalculation?.values.settlementAmountUsd) : numberValue(item.settlementAmountUsd),
    issRate: numberValue(item.issRate),
    issExcludedAmountUsd: numberValue(item.issExcludedAmountUsd),
    calculatedTaxAmountUsd: numberValue(item.calculatedTaxAmountUsd),
    confirmationResult: text(item.confirmationResult),
    sourceReference: text(item.sourceReference),
    sourceSnapshotJson: JSON.stringify({ manual: true, item, calculation: structuredCalculation }),
    notes: text(item.notes),
    ...calculation,
  };
}

async function insertSettlement({
  settlementNo,
  title,
  countryCode,
  pricingVersionId,
  pricingVersionNo,
  currency,
  sourceFileName = null,
  notes,
  periodStart = null,
  periodEnd = null,
  rows,
}: {
  settlementNo: string;
  title: string;
  countryCode: string | null;
  pricingVersionId: string | null;
  pricingVersionNo: string | null;
  currency: string;
  sourceFileName?: string | null;
  notes: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  rows: Row[];
}) {
  await execute(
    `
      INSERT INTO balancesettlements
        (settlementNo, title, countryCode, pricingVersionId, pricingVersionNo, currency, status, periodStart, periodEnd, sourceFileName, notes)
      VALUES
        (:settlementNo, :title, :countryCode, :pricingVersionId, :pricingVersionNo, :currency, :status, :periodStart, :periodEnd, :sourceFileName, :notes)
    `,
    { settlementNo, title, countryCode, pricingVersionId, pricingVersionNo, currency, status: DRAFT, periodStart, periodEnd, sourceFileName, notes },
  );
  for (const row of rows) {
    await execute(
      `
        INSERT INTO balancesettlementitems (
          id, settlementNo, lineNo, itemType, countryCode, batchName, requestNo, poNo, purchaseOrderItemId, requestItemId,
          deviceCode, modelCode, nameEn, supplierId, undertakingUnitId, customerId, quantity, receiptDate, paymentDate, procurementCurrency,
          purchaseUnitPrice, purchaseCapexUnitPrice, purchaseOpexUnitPrice, settlementCurrency, settlementRate,
          settlementCapexUnitPrice, settlementOpexUnitPrice, anchorVersionId, anchorVersionNo, anchorItemId,
          anchorCapexUnitPrice, anchorOpexUnitPrice, capexDifferenceUnitPrice, capexDifferenceTotal,
          opexDifferenceUnitPrice, opexDifferenceTotal, differenceTotal, expenseCategory, expenseName, sourceSnapshotJson, notes
          , expenseType, differenceNature, expenseDate, documentNo, deviceNodeQuantity, deliveryQuantity, settlementQuantity,
          taxExcludedUnitPriceUsd, priceConfirmation, paymentExchangeRate, taxExcludedTotalUsd, taxExcludedTotalCny,
          equipmentTotalUsd, localTaxRate, calculatedTaxAmountUsd, feeCurrency, feeAmount, expenseProvider, usdExchangeRate, settlementAmountUsd,
          issRate, issExcludedAmountUsd, confirmationResult, sourceReference
        ) VALUES (
          :id, :settlementNo, :lineNo, :itemType, :countryCode, :batchName, :requestNo, :poNo, :purchaseOrderItemId, :requestItemId,
          :deviceCode, :modelCode, :nameEn, :supplierId, :undertakingUnitId, :customerId, :quantity, :receiptDate, :paymentDate, :procurementCurrency,
          :purchaseUnitPrice, :purchaseCapexUnitPrice, :purchaseOpexUnitPrice, :settlementCurrency, :settlementRate,
          :settlementCapexUnitPrice, :settlementOpexUnitPrice, :anchorVersionId, :anchorVersionNo, :anchorItemId,
          :anchorCapexUnitPrice, :anchorOpexUnitPrice, :capexDifferenceUnitPrice, :capexDifferenceTotal,
          :opexDifferenceUnitPrice, :opexDifferenceTotal, :differenceTotal, :expenseCategory, :expenseName, :sourceSnapshotJson, :notes,
          :expenseType, :differenceNature, :expenseDate, :documentNo, :deviceNodeQuantity, :deliveryQuantity, :settlementQuantity,
          :taxExcludedUnitPriceUsd, :priceConfirmation, :paymentExchangeRate, :taxExcludedTotalUsd, :taxExcludedTotalCny,
          :equipmentTotalUsd, :localTaxRate, :calculatedTaxAmountUsd, :feeCurrency, :feeAmount, :expenseProvider, :usdExchangeRate, :settlementAmountUsd,
          :issRate, :issExcludedAmountUsd, :confirmationResult, :sourceReference
        )
      `,
      row,
    );
  }
  await refreshSettlementTotals(settlementNo);
}

async function refreshSettlementTotals(settlementNo: string) {
  const [summary] = await queryRows<Row>(
    `
      SELECT COUNT(*) AS itemCount,
             COALESCE(SUM(capexDifferenceTotal), 0) AS capexDifferenceTotal,
             COALESCE(SUM(opexDifferenceTotal), 0) AS opexDifferenceTotal,
             COALESCE(SUM(differenceTotal), 0) AS differenceTotal
      FROM balancesettlementitems
      WHERE settlementNo = :settlementNo
    `,
    { settlementNo },
  );
  await execute(
    `
      UPDATE balancesettlements
      SET itemCount = :itemCount,
          capexDifferenceTotal = :capexDifferenceTotal,
          opexDifferenceTotal = :opexDifferenceTotal,
          differenceTotal = :differenceTotal
      WHERE settlementNo = :settlementNo
    `,
    { settlementNo, ...summary },
  );
}
