import { queryRows, type Row } from "./db";
import { DEFAULT_PAGE_SIZE, normalizePageSize } from "./pagination";
import { formatTableDateExpression, getNaturalBatchSort } from "./table-query";

type OrderListResult = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  statusCounts: { draft: number; confirmed: number };
};

export async function listOrderRows(searchParams: URLSearchParams): Promise<OrderListResult> {
  const mode = searchParams.get("mode") === "purchase" ? "purchase" : "requests";
  const keyword = searchParams.get("keyword")?.trim();
  const countryCode = normalizeCountryCode(searchParams.get("countryCode"));
  const statusTab = searchParams.get("statusTab") === "confirmed" ? "confirmed" : "draft";
  const exportAll = searchParams.get("export") === "1";
  const sortField = searchParams.get("sortField")?.trim() ?? "";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "ASC" : "DESC";
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  return mode === "purchase"
    ? listPurchaseOrders({ keyword, countryCode, statusTab, exportAll, requestedPage, pageSize, sortField, sortOrder, searchParams })
    : listRequests({ keyword, countryCode, statusTab, exportAll, requestedPage, pageSize, sortField, sortOrder, searchParams });
}

async function listRequests(options: {
  keyword?: string;
  countryCode?: string;
  statusTab: "draft" | "confirmed";
  exportAll: boolean;
  requestedPage: number;
  pageSize: number;
  sortField: string;
  sortOrder: "ASC" | "DESC";
  searchParams: URLSearchParams;
}): Promise<OrderListResult> {
  const params: Row = {};
  const keywordWhere = buildRequestKeywordWhere(options.keyword, params);
  const countryWhere = buildCountryWhere("req", options.countryCode, params);
  const columnFilters = buildRequestColumnFilters(options.searchParams, params);
  const confirmedCondition = "req.status IN ('待下单', '已下单')";
  const statusCondition = options.statusTab === "confirmed" ? confirmedCondition : `NOT (${confirmedCondition})`;
  const baseWhere = [keywordWhere, countryWhere, statusCondition, ...columnFilters].filter(Boolean).join(" AND ");
  const allWhereParts = [keywordWhere, countryWhere, ...columnFilters].filter(Boolean);
  const allWhere = allWhereParts.length ? `WHERE ${allWhereParts.join(" AND ")}` : "";
  const [{ total }] = await queryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM requests AS req ${baseWhere ? `WHERE ${baseWhere}` : ""}`,
    params,
  );
  const [counts] = await queryRows<{ draft: number; confirmed: number }>(
    `
      SELECT
        SUM(CASE WHEN ${confirmedCondition} THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE WHEN ${confirmedCondition} THEN 0 ELSE 1 END) AS draft
      FROM requests AS req
      ${allWhere}
    `,
    params,
  );

  const normalizedTotal = Number(total ?? 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / options.pageSize));
  const page = options.exportAll ? 1 : Math.min(options.requestedPage, totalPages);
  if (!options.exportAll) {
    params.limit = options.pageSize;
    params.offset = (page - 1) * options.pageSize;
  }

  const rows = await queryRows<Row>(
    `
      SELECT
        req.requestNo,
        UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1))) AS countryCode,
        req.contractNo,
        req.batchName,
        req.requestType,
        req.status,
        COALESCE(SUM(ri.quantity), 0) AS totalQuantity,
        DATE_FORMAT(req.plannedDeliveryDate, '%Y-%m-%d') AS plannedDeliveryDate,
        DATE_FORMAT(req.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
        DATE_FORMAT(req.updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
      FROM requests AS req
      LEFT JOIN requestitems AS ri ON ri.requestNo = req.requestNo
      ${baseWhere ? `WHERE ${baseWhere}` : ""}
      GROUP BY req.requestNo, req.countryCode, req.contractNo, req.batchName, req.requestType, req.status,
        req.plannedDeliveryDate, req.createdAt, req.updatedAt
      ORDER BY ${getRequestOrderBy(options.sortField, options.sortOrder)}
      ${options.exportAll ? "" : "LIMIT :limit OFFSET :offset"}
    `,
    params,
  );

  return {
    rows,
    total: normalizedTotal,
    page,
    pageSize: options.pageSize,
    totalPages,
    statusCounts: { draft: Number(counts?.draft ?? 0), confirmed: Number(counts?.confirmed ?? 0) },
  };
}

async function listPurchaseOrders(options: {
  keyword?: string;
  countryCode?: string;
  statusTab: "draft" | "confirmed";
  exportAll: boolean;
  requestedPage: number;
  pageSize: number;
  sortField: string;
  sortOrder: "ASC" | "DESC";
  searchParams: URLSearchParams;
}): Promise<OrderListResult> {
  const params: Row = {};
  const keywordWhere = buildPurchaseKeywordWhere(options.keyword, params);
  const countryWhere = buildPurchaseCountryWhere(options.countryCode, params);
  const columnFilters = buildPurchaseColumnFilters(options.searchParams, params);
  const confirmedCondition = "purchase.status LIKE '%确认%'";
  const statusCondition = options.statusTab === "confirmed" ? confirmedCondition : `NOT (${confirmedCondition})`;
  const baseWhere = [keywordWhere, countryWhere, statusCondition, ...columnFilters].filter(Boolean).join(" AND ");
  const allWhereParts = [keywordWhere, countryWhere, ...columnFilters].filter(Boolean);
  const allWhere = allWhereParts.length ? `WHERE ${allWhereParts.join(" AND ")}` : "";
  const [{ total }] = await queryRows<{ total: number }>(
    `
      SELECT COUNT(DISTINCT purchase.purchaseOrderId) AS total
      FROM purchaseorders AS purchase
      LEFT JOIN purchaseorderitems AS item ON item.poNo = purchase.poNo
      LEFT JOIN requestitems AS requestItem ON requestItem.id = item.requestItemId
      LEFT JOIN requests AS requestMaster ON requestMaster.requestNo = COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo, purchase.requestNo)
      ${baseWhere ? `WHERE ${baseWhere}` : ""}
    `,
    params,
  );
  const [counts] = await queryRows<{ draft: number; confirmed: number }>(
    `
      SELECT
        COUNT(DISTINCT CASE WHEN ${confirmedCondition} THEN purchase.purchaseOrderId END) AS confirmed,
        COUNT(DISTINCT CASE WHEN ${confirmedCondition} THEN NULL ELSE purchase.purchaseOrderId END) AS draft
      FROM purchaseorders AS purchase
      LEFT JOIN purchaseorderitems AS item ON item.poNo = purchase.poNo
      LEFT JOIN requestitems AS requestItem ON requestItem.id = item.requestItemId
      LEFT JOIN requests AS requestMaster ON requestMaster.requestNo = COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo, purchase.requestNo)
      ${allWhere}
    `,
    params,
  );

  const normalizedTotal = Number(total ?? 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / options.pageSize));
  const page = options.exportAll ? 1 : Math.min(options.requestedPage, totalPages);
  if (!options.exportAll) {
    params.limit = options.pageSize;
    params.offset = (page - 1) * options.pageSize;
  }

  const rows = await queryRows<Row>(
    `
      SELECT
        purchase.purchaseOrderId,
        purchase.poNo,
        COALESCE(NULLIF(purchase.requestNo, ''), GROUP_CONCAT(DISTINCT requestItem.requestNo ORDER BY requestItem.requestNo SEPARATOR ',')) AS requestNo,
        GROUP_CONCAT(DISTINCT UPPER(TRIM(SUBSTRING_INDEX(requestMaster.countryCode, '-', 1))) ORDER BY UPPER(TRIM(SUBSTRING_INDEX(requestMaster.countryCode, '-', 1))) SEPARATOR ',') AS countryCode,
        GROUP_CONCAT(DISTINCT requestMaster.batchName ORDER BY
          CAST(SUBSTRING_INDEX(TRIM(COALESCE(requestMaster.batchName, '')), '-', -1) AS UNSIGNED) DESC,
          UPPER(SUBSTRING_INDEX(TRIM(COALESCE(requestMaster.batchName, '')), '-', 1)) ASC
          SEPARATOR ',') AS batchName,
        purchase.status,
        purchase.currency,
        COALESCE(SUM(requestItem.quantity), 0) AS totalQuantity,
        ROUND(COALESCE(SUM(requestItem.quantity * COALESCE(item.unitPrice, COALESCE(item.taxExcludedUnitPrice, 0) + COALESCE(item.taxSurcharge, 0))), 0), 4) AS purchaseTotalAmount,
        DATE_FORMAT(purchase.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
        DATE_FORMAT(purchase.updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
      FROM purchaseorders AS purchase
      LEFT JOIN purchaseorderitems AS item
        ON item.poNo = purchase.poNo
      LEFT JOIN requestitems AS requestItem ON requestItem.id = item.requestItemId
      LEFT JOIN requests AS requestMaster
        ON requestMaster.requestNo = COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo)
      ${baseWhere ? `WHERE ${baseWhere}` : ""}
      GROUP BY purchase.purchaseOrderId, purchase.poNo, purchase.requestNo, purchase.status, purchase.currency,
        purchase.createdAt, purchase.updatedAt
      ORDER BY ${getPurchaseOrderBy(options.sortField, options.sortOrder)}
      ${options.exportAll ? "" : "LIMIT :limit OFFSET :offset"}
    `,
    params,
  );

  return {
    rows,
    total: normalizedTotal,
    page,
    pageSize: options.pageSize,
    totalPages,
    statusCounts: { draft: Number(counts?.draft ?? 0), confirmed: Number(counts?.confirmed ?? 0) },
  };
}

export async function listOrderFilterOptions(searchParams: URLSearchParams) {
  const mode = searchParams.get("mode") === "purchase" ? "purchase" : "requests";
  const field = searchParams.get("field")?.trim() ?? "";
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const expressions: Record<string, string> = mode === "purchase"
    ? {
        poNo: "purchase.poNo",
        requestNo: "COALESCE(NULLIF(purchase.requestNo, ''), requestItem.requestNo, '')",
        countryCode: "UPPER(TRIM(SUBSTRING_INDEX(requestMaster.countryCode, '-', 1)))",
        batchName: "COALESCE(requestMaster.batchName, '')",
        status: "purchase.status",
        currency: "purchase.currency",
        totalQuantity: "COALESCE((SELECT SUM(quantity) FROM requestitems quantityItem INNER JOIN purchaseorderitems quantityPurchaseItem ON quantityPurchaseItem.requestItemId = quantityItem.id WHERE quantityPurchaseItem.poNo = purchase.poNo), 0)",
        purchaseTotalAmount: "COALESCE((SELECT SUM(quantityAmountItem.quantity * COALESCE(amountPurchaseItem.unitPrice, COALESCE(amountPurchaseItem.taxExcludedUnitPrice, 0) + COALESCE(amountPurchaseItem.taxSurcharge, 0))) FROM purchaseorderitems amountPurchaseItem LEFT JOIN requestitems quantityAmountItem ON quantityAmountItem.id = amountPurchaseItem.requestItemId WHERE amountPurchaseItem.poNo = purchase.poNo), 0)",
        createdAt: formatTableDateExpression("purchase.createdAt"),
        updatedAt: formatTableDateExpression("purchase.updatedAt"),
      }
    : {
        requestNo: "req.requestNo",
        countryCode: "UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1)))",
        batchName: "req.batchName",
        status: "req.status",
        requestType: "COALESCE(NULLIF(req.requestType, ''), '整机')",
        totalQuantity: "COALESCE((SELECT SUM(quantity) FROM requestitems quantityItem WHERE quantityItem.requestNo = req.requestNo), 0)",
        plannedDeliveryDate: formatTableDateExpression("req.plannedDeliveryDate"),
        createdAt: formatTableDateExpression("req.createdAt"),
        updatedAt: formatTableDateExpression("req.updatedAt"),
      };
  const expression = expressions[field];
  if (!expression) return { options: [] as Array<{ value: string; count: number }> };

  const params: Row = {};
  const innerWhere: string[] = [];
  const statusTab = searchParams.get("statusTab") === "confirmed" ? "confirmed" : "draft";
  if (mode === "purchase") {
    const confirmed = "purchase.status LIKE '%确认%'";
    innerWhere.push(statusTab === "confirmed" ? confirmed : `NOT (${confirmed})`);
    const countryCode = normalizeCountryCode(searchParams.get("countryCode"));
    if (countryCode && field !== "countryCode") {
      innerWhere.push(buildPurchaseCountryWhere(countryCode, params));
    }
  } else {
    const confirmed = "req.status IN ('待下单', '已下单')";
    innerWhere.push(statusTab === "confirmed" ? confirmed : `NOT (${confirmed})`);
    const countryCode = normalizeCountryCode(searchParams.get("countryCode"));
    if (countryCode && field !== "countryCode") innerWhere.push(buildCountryWhere("req", countryCode, params));
  }

  const columnConditions: string[] = [];
  for (const [candidateField, candidateExpression] of Object.entries(expressions)) {
    if (candidateField === field) continue;
    const values = getFilterValues(searchParams, candidateField);
    if (!values.length) continue;
    const name = `option_${candidateField}`;
    params[name] = values;
    columnConditions.push(`valuesList.\`${candidateField}\` IN (:${name})`);
  }
  const selectColumns = Object.entries(expressions).map(([candidateField, candidateExpression]) => `${candidateExpression} AS \`${candidateField}\``).join(", ");
  if (keyword) params.optionKeyword = `%${keyword}%`;
  const currentValue = `valuesList.\`${field}\``;
  const outerWhere = [`${currentValue} IS NOT NULL`, `TRIM(CAST(${currentValue} AS CHAR)) <> ''`, keyword ? `${currentValue} LIKE :optionKeyword` : "", ...columnConditions].filter(Boolean).join(" AND ");
  const from = mode === "purchase"
    ? `FROM purchaseorders purchase
       LEFT JOIN purchaseorderitems item ON item.poNo = purchase.poNo
       LEFT JOIN requestitems requestItem ON requestItem.id = item.requestItemId
       LEFT JOIN requests requestMaster ON requestMaster.requestNo = COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo, NULLIF(purchase.requestNo, ''))`
    : `FROM requests req`;
  const identity = mode === "purchase" ? "purchase.purchaseOrderId" : "req.requestNo";
  const rows = await queryRows<{ value: string; count: number }>(
    `SELECT valuesList.\`${field}\` AS value, COUNT(*) AS count FROM (
       SELECT ${identity} AS identityKey, ${selectColumns}
       ${from}
       ${innerWhere.length ? `WHERE ${innerWhere.join(" AND ")}` : ""}
       GROUP BY identityKey, ${Object.keys(expressions).map((key) => `\`${key}\``).join(", ")}
     ) valuesList
     WHERE ${outerWhere}
     GROUP BY valuesList.\`${field}\`
     ORDER BY ${field === "batchName" ? `CASE WHEN TRIM(COALESCE(value, '')) REGEXP '^[A-Za-z]+[[:space:]]*-[[:space:]]*[0-9]+$' THEN 0 ELSE 1 END ASC, UPPER(TRIM(SUBSTRING_INDEX(TRIM(COALESCE(value, '')), '-', 1))) ASC, CAST(SUBSTRING_INDEX(TRIM(COALESCE(value, '')), '-', -1) AS UNSIGNED) ASC, value ASC` : "value ASC"}
     LIMIT 500`,
    params,
  );
  return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
}

function normalizeCountryCode(value: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return text.split(/\s*-\s*/, 1)[0].trim() || undefined;
}

function buildCountryWhere(alias: string, countryCode: string | undefined, params: Row) {
  if (!countryCode) return "";
  params.countryCode = countryCode;
  return `UPPER(TRIM(SUBSTRING_INDEX(${alias}.countryCode, '-', 1))) = UPPER(:countryCode)`;
}

function buildPurchaseCountryWhere(countryCode: string | string[] | undefined, params: Row, parameterName = "countryCode") {
  if (!countryCode || (Array.isArray(countryCode) && !countryCode.length)) return "";
  const values = (Array.isArray(countryCode) ? countryCode : [countryCode])
    .map((value) => normalizeCountryCode(String(value)))
    .filter(Boolean);
  if (!values.length) return "";
  params[parameterName] = values;
  return `EXISTS (
    SELECT 1
    FROM purchaseorderitems AS countryItem
    LEFT JOIN requestitems AS countryRequestItem ON countryRequestItem.id = countryItem.requestItemId
    LEFT JOIN requests AS countryRequest
      ON countryRequest.requestNo = COALESCE(NULLIF(countryItem.requestNo, ''), countryRequestItem.requestNo, NULLIF(purchase.requestNo, ''))
    WHERE countryItem.poNo = purchase.poNo
      AND UPPER(TRIM(SUBSTRING_INDEX(countryRequest.countryCode, '-', 1))) IN (:${parameterName})
  )`;
}

function buildRequestKeywordWhere(keyword: string | undefined, params: Row) {
  if (!keyword) return "";
  params.keyword = `%${keyword}%`;
  return "(req.requestNo LIKE :keyword OR req.contractNo LIKE :keyword OR req.batchName LIKE :keyword OR req.status LIKE :keyword OR req.countryCode LIKE :keyword)";
}

function buildPurchaseKeywordWhere(keyword: string | undefined, params: Row) {
  if (!keyword) return "";
  params.keyword = `%${keyword}%`;
  return `(
    purchase.poNo LIKE :keyword OR purchase.requestNo LIKE :keyword OR purchase.sourceRequestNos LIKE :keyword
    OR purchase.status LIKE :keyword OR purchase.currency LIKE :keyword
    OR EXISTS (
      SELECT 1
      FROM purchaseorderitems AS searchItem
      LEFT JOIN requestitems AS searchRequestItem ON searchRequestItem.id = searchItem.requestItemId
      LEFT JOIN requests AS searchRequest ON searchRequest.requestNo = COALESCE(NULLIF(searchItem.requestNo, ''), searchRequestItem.requestNo)
      WHERE searchItem.poNo = purchase.poNo
        AND (searchRequestItem.requestNo LIKE :keyword OR searchRequestItem.deviceCode LIKE :keyword OR searchRequest.batchName LIKE :keyword)
    )
  )`;
}

function getRequestOrderBy(sortField: string, sortOrder: "ASC" | "DESC") {
  const direction = sortOrder === "ASC" ? "ASC" : "DESC";
  const expressions: Record<string, string> = {
    requestNo: "req.requestNo",
    countryCode: "UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1)))",
    batchName: "req.batchName",
    requestType: "req.requestType",
    status: "req.status",
    plannedDeliveryDate: "req.plannedDeliveryDate",
    totalQuantity: "totalQuantity",
    createdAt: "req.createdAt",
    updatedAt: "req.updatedAt",
  };
  if (sortField === "batchName") return getNaturalBatchSort(expressions.batchName, direction, "req.createdAt DESC");
  return expressions[sortField] ? `${expressions[sortField]} ${direction}, req.createdAt DESC` : `CASE WHEN TRIM(COALESCE(req.batchName, '')) REGEXP '^[A-Za-z]+-[0-9]+$' THEN 0 ELSE 1 END ASC, CAST(SUBSTRING_INDEX(TRIM(COALESCE(req.batchName, '')), '-', -1) AS UNSIGNED) DESC, UPPER(SUBSTRING_INDEX(TRIM(COALESCE(req.batchName, '')), '-', 1)) ASC, req.createdAt DESC`;
}

function getPurchaseOrderBy(sortField: string, sortOrder: "ASC" | "DESC") {
  const direction = sortOrder === "ASC" ? "ASC" : "DESC";
  const expressions: Record<string, string> = {
    poNo: "purchase.poNo",
    requestNo: "requestNo",
    countryCode: "countryCode",
    batchName: "batchName",
    status: "purchase.status",
    currency: "purchase.currency",
    totalQuantity: "totalQuantity",
    purchaseTotalAmount: "purchaseTotalAmount",
    createdAt: "purchase.createdAt",
    updatedAt: "purchase.updatedAt",
  };
  if (sortField === "batchName") {
    const batchNameExpression = `SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT requestMaster.batchName ORDER BY
      CAST(SUBSTRING_INDEX(TRIM(COALESCE(requestMaster.batchName, '')), '-', -1) AS UNSIGNED) DESC,
      UPPER(TRIM(SUBSTRING_INDEX(TRIM(COALESCE(requestMaster.batchName, '')), '-', 1))) ASC
      SEPARATOR ','), ',', 1)`;
    return getNaturalBatchSort(batchNameExpression, direction, "purchase.createdAt DESC");
  }
  return expressions[sortField] ? `${expressions[sortField]} ${direction}, purchase.createdAt DESC` : `MAX(CASE WHEN TRIM(COALESCE(requestMaster.batchName, '')) REGEXP '^[A-Za-z]+-[0-9]+$' THEN 0 ELSE 1 END) ASC, MAX(CASE WHEN TRIM(COALESCE(requestMaster.batchName, '')) REGEXP '^[A-Za-z]+-[0-9]+$' THEN CAST(SUBSTRING_INDEX(TRIM(requestMaster.batchName), '-', -1) AS UNSIGNED) ELSE -1 END) DESC, MIN(UPPER(SUBSTRING_INDEX(TRIM(COALESCE(requestMaster.batchName, '')), '-', 1))) ASC, purchase.createdAt DESC`;
}

function getFilterValues(searchParams: URLSearchParams, field: string) {
  return Array.from(new Set(searchParams.getAll(`filter.${field}`).map((value) => value.trim()).filter(Boolean)));
}

function buildInFilter(field: string, values: string[], params: Row, name: string) {
  if (!values.length) return "";
  params[name] = values;
  return `${field} IN (:${name})`;
}

function buildRequestColumnFilters(searchParams: URLSearchParams, params: Row) {
  const mappings: Record<string, string> = {
    requestNo: "req.requestNo",
    countryCode: "req.countryCode",
    batchName: "req.batchName",
    status: "req.status",
    requestType: "COALESCE(NULLIF(req.requestType, ''), '整机')",
    totalQuantity: "COALESCE((SELECT SUM(quantity) FROM requestitems quantityItem WHERE quantityItem.requestNo = req.requestNo), 0)",
    plannedDeliveryDate: formatTableDateExpression("req.plannedDeliveryDate"),
    createdAt: formatTableDateExpression("req.createdAt"),
    updatedAt: formatTableDateExpression("req.updatedAt"),
  };
  return Object.entries(mappings).map(([field, expression]) => buildInFilter(expression, getFilterValues(searchParams, field), params, `column_${field}`)).filter(Boolean);
}

function buildPurchaseColumnFilters(searchParams: URLSearchParams, params: Row) {
  const filters: string[] = [];
  const countryCodes = getFilterValues(searchParams, "countryCode");
  if (countryCodes.length) filters.push(buildPurchaseCountryWhere(countryCodes, params, "column_countryCode"));
  for (const [field, expression] of [
    ["poNo", "purchase.poNo"], ["status", "purchase.status"], ["currency", "purchase.currency"],
    ["totalQuantity", "COALESCE((SELECT SUM(quantity) FROM requestitems quantityItem INNER JOIN purchaseorderitems quantityPurchaseItem ON quantityPurchaseItem.requestItemId = quantityItem.id WHERE quantityPurchaseItem.poNo = purchase.poNo), 0)"],
    ["purchaseTotalAmount", "COALESCE((SELECT SUM(quantityAmountItem.quantity * COALESCE(amountPurchaseItem.unitPrice, COALESCE(amountPurchaseItem.taxExcludedUnitPrice, 0) + COALESCE(amountPurchaseItem.taxSurcharge, 0))) FROM purchaseorderitems amountPurchaseItem LEFT JOIN requestitems quantityAmountItem ON quantityAmountItem.id = amountPurchaseItem.requestItemId WHERE amountPurchaseItem.poNo = purchase.poNo), 0)"],
    ["createdAt", formatTableDateExpression("purchase.createdAt")], ["updatedAt", formatTableDateExpression("purchase.updatedAt")],
  ] as const) {
    const filter = buildInFilter(expression, getFilterValues(searchParams, field), params, `column_${field}`);
    if (filter) filters.push(filter);
  }
  const requestNos = getFilterValues(searchParams, "requestNo");
  if (requestNos.length) {
    params.column_requestNo = requestNos;
    filters.push("COALESCE(NULLIF(purchase.requestNo, ''), requestItem.requestNo, '') IN (:column_requestNo)");
  }
  const batchNames = getFilterValues(searchParams, "batchName");
  if (batchNames.length) {
    params.column_batchName = batchNames;
    filters.push("requestMaster.batchName IN (:column_batchName)");
  }
  return filters;
}
