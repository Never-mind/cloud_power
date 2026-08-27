import { queryRows, type Row } from "./db";
import { DEFAULT_PAGE_SIZE, normalizePageSize } from "./pagination";
import { formatTableDateExpression, getNaturalBatchSort } from "./table-query";

type ProductLineListResult = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type PageOptions = {
  exportAll: boolean;
  page: number;
  pageSize: number;
};

export async function listRequestProductLines(searchParams: URLSearchParams): Promise<ProductLineListResult> {
  const keyword = searchParams.get("keyword")?.trim();
  const countryCode = searchParams.get("countryCode")?.trim();
  const options = getPageOptions(searchParams);
  const params: Row = {};
  const whereParts = ["req.status IN ('待下单', '已下单')"];
  whereParts.push(...buildColumnFilters(searchParams, params, "request"));
  if (countryCode) {
    whereParts.push("UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1))) = UPPER(:countryCode)");
    params.countryCode = normalizeCountryCode(countryCode);
  }

  if (keyword) {
    whereParts.push(`(
      req.countryCode LIKE :keyword OR req.batchName LIKE :keyword OR ri.requestNo LIKE :keyword
      OR ri.deviceCode LIKE :keyword OR model.modelCode LIKE :keyword OR model.nameEn LIKE :keyword
      OR supplier.name LIKE :keyword OR supplier.supplierCode LIKE :keyword
    )`);
    params.keyword = `%${keyword}%`;
  }

  const where = `WHERE ${whereParts.join(" AND ")}`;
  const [{ total }] = await queryRows<{ total: number }>(
    `
      SELECT COUNT(*) AS total
      FROM requestitems AS ri
      INNER JOIN requests AS req ON req.requestNo = ri.requestNo
      LEFT JOIN instancemodels AS model ON model.deviceCode = ri.deviceCode
      LEFT JOIN suppliers AS supplier ON supplier.supplierId = ri.supplierId
      ${where}
    `,
    params,
  );

  const normalizedTotal = Number(total ?? 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / options.pageSize));
  const page = options.exportAll ? 1 : Math.min(options.page, totalPages);
  if (!options.exportAll) {
    params.limit = options.pageSize;
    params.offset = (page - 1) * options.pageSize;
  }

  const rows = await queryRows<Row>(
    `
      SELECT
        ri.id,
        UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1))) AS countryCode,
        req.batchName,
        ri.requestNo,
        ri.deviceCode,
        model.modelCode,
        model.nameEn,
        COALESCE(supplier.name, supplier.supplierCode, ri.supplierId) AS supplierName,
        ri.quantity,
        DATE_FORMAT(req.plannedDeliveryDate, '%Y-%m-%d') AS plannedDeliveryDate,
        DATE_FORMAT(req.createdAt, '%Y-%m-%d') AS createdAt,
        DATE_FORMAT(req.updatedAt, '%Y-%m-%d') AS updatedAt
      FROM requestitems AS ri
      INNER JOIN requests AS req ON req.requestNo = ri.requestNo
      LEFT JOIN instancemodels AS model ON model.deviceCode = ri.deviceCode
      LEFT JOIN suppliers AS supplier ON supplier.supplierId = ri.supplierId
      ${where}
      ORDER BY ${getColumnOrder(searchParams, "request")}
      ${options.exportAll ? "" : "LIMIT :limit OFFSET :offset"}
    `,
    params,
  );

  return { rows, total: normalizedTotal, page, pageSize: options.pageSize, totalPages };
}

export async function listPurchaseProductLines(searchParams: URLSearchParams): Promise<ProductLineListResult> {
  const keyword = searchParams.get("keyword")?.trim();
  const countryCode = searchParams.get("countryCode")?.trim();
  const options = getPageOptions(searchParams);
  const params: Row = {};
  const whereParts = ["purchase.status LIKE '%确认%'"];
  whereParts.push(...buildColumnFilters(searchParams, params, "purchase"));
  if (countryCode) {
    whereParts.push("UPPER(TRIM(SUBSTRING_INDEX(requestMaster.countryCode, '-', 1))) = UPPER(:countryCode)");
    params.countryCode = normalizeCountryCode(countryCode);
  }

  if (keyword) {
    whereParts.push(`(
      purchase.poNo LIKE :keyword OR purchase.requestNo LIKE :keyword OR purchase.sourceRequestNos LIKE :keyword
      OR requestItem.requestNo LIKE :keyword OR requestItem.deviceCode LIKE :keyword
      OR model.nameZh LIKE :keyword OR model.nameEn LIKE :keyword OR requestMaster.batchName LIKE :keyword
    )`);
    params.keyword = `%${keyword}%`;
  }

  const where = `WHERE ${whereParts.join(" AND ")}`;
  const [{ total }] = await queryRows<{ total: number }>(
    `
      SELECT COUNT(*) AS total
      FROM purchaseorderitems AS item
      INNER JOIN purchaseorders AS purchase
        ON purchase.poNo = item.poNo
      LEFT JOIN requestitems AS requestItem ON requestItem.id = item.requestItemId
      LEFT JOIN requests AS requestMaster
        ON requestMaster.requestNo = COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo)
      LEFT JOIN instancemodels AS model ON model.deviceCode = requestItem.deviceCode
      ${where}
    `,
    params,
  );

  const normalizedTotal = Number(total ?? 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / options.pageSize));
  const page = options.exportAll ? 1 : Math.min(options.page, totalPages);
  if (!options.exportAll) {
    params.limit = options.pageSize;
    params.offset = (page - 1) * options.pageSize;
  }

  const rows = await queryRows<Row>(
    `
      SELECT
        item.id,
        purchase.poNo,
        COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo, purchase.requestNo, '') AS requestNo,
        UPPER(TRIM(SUBSTRING_INDEX(requestMaster.countryCode, '-', 1))) AS countryCode,
        requestMaster.batchName,
        purchase.status,
        requestItem.deviceCode,
        model.nameZh,
        model.nameEn,
        requestItem.quantity,
        purchase.currency,
        COALESCE(item.taxExcludedUnitPrice, item.unitPrice, 0) AS taxExcludedUnitPrice,
        COALESCE(item.taxSurcharge, 0) AS taxSurcharge,
        COALESCE(item.unitPrice, COALESCE(item.taxExcludedUnitPrice, 0) + COALESCE(item.taxSurcharge, 0)) AS unitPrice,
        ROUND(
          COALESCE(requestItem.quantity, 0) * COALESCE(item.unitPrice, COALESCE(item.taxExcludedUnitPrice, 0) + COALESCE(item.taxSurcharge, 0)),
          4
        ) AS totalAmount
      FROM purchaseorderitems AS item
      INNER JOIN purchaseorders AS purchase
        ON purchase.poNo = item.poNo
      LEFT JOIN requestitems AS requestItem ON requestItem.id = item.requestItemId
      LEFT JOIN requests AS requestMaster
        ON requestMaster.requestNo = COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo)
      LEFT JOIN instancemodels AS model ON model.deviceCode = requestItem.deviceCode
      ${where}
      ORDER BY ${getColumnOrder(searchParams, "purchase")}
      ${options.exportAll ? "" : "LIMIT :limit OFFSET :offset"}
    `,
    params,
  );

  return { rows, total: normalizedTotal, page, pageSize: options.pageSize, totalPages };
}

export async function listProductLineFilterOptions(searchParams: URLSearchParams) {
  const mode = searchParams.get("mode") === "purchase" ? "purchase" : "request";
  const field = searchParams.get("field")?.trim() ?? "";
  const keyword = searchParams.get("optionKeyword")?.trim() || searchParams.get("keyword")?.trim() || "";
  const expressions: Record<string, string> = mode === "purchase"
    ? {
        poNo: "purchase.poNo",
        requestNo: "COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo, purchase.requestNo, '')",
        countryCode: "UPPER(TRIM(SUBSTRING_INDEX(requestMaster.countryCode, '-', 1)))",
        batchName: "requestMaster.batchName",
        status: "purchase.status",
        deviceCode: "requestItem.deviceCode",
        nameZh: "model.nameZh",
        nameEn: "model.nameEn",
        quantity: "requestItem.quantity",
        currency: "purchase.currency",
      }
    : {
        countryCode: "UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1)))",
        batchName: "req.batchName",
        requestNo: "ri.requestNo",
        deviceCode: "ri.deviceCode",
        modelCode: "model.modelCode",
        nameEn: "model.nameEn",
        supplierName: "COALESCE(supplier.name, supplier.supplierCode, ri.supplierId)",
        quantity: "ri.quantity",
        plannedDeliveryDate: formatTableDateExpression("req.plannedDeliveryDate"),
        createdAt: formatTableDateExpression("req.createdAt"),
        updatedAt: formatTableDateExpression("req.updatedAt"),
      };
  const expression = expressions[field];
  if (!expression) return { options: [] as Array<{ value: string; count: number }> };
  const params: Row = {};
  const whereParts = [`${expression} IS NOT NULL`, `TRIM(CAST(${expression} AS CHAR)) <> ''`];
  whereParts.push(...buildColumnFilters(searchParams, params, mode, field));
  const countryCode = searchParams.get("countryCode")?.trim();
  if (countryCode && field !== "countryCode") {
    params.optionCountryCode = normalizeCountryCode(countryCode);
    whereParts.push(`UPPER(TRIM(SUBSTRING_INDEX(${mode === "purchase" ? "requestMaster.countryCode" : "req.countryCode"}, '-', 1))) = UPPER(:optionCountryCode)`);
  }
  if (keyword) {
    params.optionKeyword = `%${keyword}%`;
    whereParts.push(`${expression} LIKE :optionKeyword`);
  }
  const sql = mode === "purchase"
    ? `
      SELECT ${expression} AS value, COUNT(*) AS count
      FROM purchaseorderitems AS item
      INNER JOIN purchaseorders AS purchase ON purchase.poNo = item.poNo
      LEFT JOIN requestitems AS requestItem ON requestItem.id = item.requestItemId
      LEFT JOIN requests AS requestMaster ON requestMaster.requestNo = COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo, purchase.requestNo)
      LEFT JOIN instancemodels AS model ON model.deviceCode = requestItem.deviceCode
      WHERE ${whereParts.join(" AND ")}
      GROUP BY ${expression} ORDER BY ${field === "batchName" ? "CAST(SUBSTRING_INDEX(TRIM(value), '-', -1) AS UNSIGNED), UPPER(SUBSTRING_INDEX(TRIM(value), '-', 1)), value" : "value"} LIMIT 500
    `
    : `
      SELECT ${expression} AS value, COUNT(*) AS count
      FROM requestitems AS ri
      INNER JOIN requests AS req ON req.requestNo = ri.requestNo
      LEFT JOIN instancemodels AS model ON model.deviceCode = ri.deviceCode
      LEFT JOIN suppliers AS supplier ON supplier.supplierId = ri.supplierId
      WHERE req.status IN ('待下单', '已下单') AND ${whereParts.join(" AND ")}
      GROUP BY ${expression} ORDER BY ${field === "batchName" ? "CAST(SUBSTRING_INDEX(TRIM(value), '-', -1) AS UNSIGNED), UPPER(SUBSTRING_INDEX(TRIM(value), '-', 1)), value" : "value"} LIMIT 500
    `;
  const rows = await queryRows<{ value: string; count: number }>(sql, params);
  return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
}

function getPageOptions(searchParams: URLSearchParams): PageOptions {
  const exportAll = searchParams.get("export") === "1";
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  return { exportAll, page: requestedPage, pageSize };
}

function getFilterValues(searchParams: URLSearchParams, field: string) {
  return Array.from(new Set(searchParams.getAll(`filter.${field}`).map((value) => value.trim()).filter(Boolean)));
}

function buildColumnFilters(searchParams: URLSearchParams, params: Row, mode: "request" | "purchase", excludedField = "") {
  const expressions: Record<string, string> = mode === "purchase"
    ? {
        poNo: "purchase.poNo",
        requestNo: "COALESCE(NULLIF(item.requestNo, ''), requestItem.requestNo, purchase.requestNo, '')",
        countryCode: "UPPER(TRIM(SUBSTRING_INDEX(requestMaster.countryCode, '-', 1)))",
        batchName: "requestMaster.batchName",
        status: "purchase.status",
        deviceCode: "requestItem.deviceCode",
        nameZh: "model.nameZh",
        nameEn: "model.nameEn",
        quantity: "requestItem.quantity",
        currency: "purchase.currency",
      }
    : {
        countryCode: "UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1)))",
        batchName: "req.batchName",
        requestNo: "ri.requestNo",
        deviceCode: "ri.deviceCode",
        modelCode: "model.modelCode",
        nameEn: "model.nameEn",
        supplierName: "COALESCE(supplier.name, supplier.supplierCode, ri.supplierId)",
        quantity: "ri.quantity",
        plannedDeliveryDate: formatTableDateExpression("req.plannedDeliveryDate"),
        createdAt: formatTableDateExpression("req.createdAt"),
        updatedAt: formatTableDateExpression("req.updatedAt"),
      };
  return Object.entries(expressions).map(([field, expression]) => {
    if (field === excludedField) return "";
    const values = getFilterValues(searchParams, field);
    if (!values.length) return "";
    const key = `column_${mode}_${field}`;
    params[key] = field === "countryCode" ? values.map(normalizeCountryCode) : values;
    return `${expression} IN (:${key})`;
  }).filter(Boolean);
}

function normalizeCountryCode(value: string) {
  return value.split(/\s*-\s*/, 1)[0].trim().toUpperCase();
}

function getColumnOrder(searchParams: URLSearchParams, mode: "request" | "purchase") {
  const field = searchParams.get("sortField")?.trim() ?? "";
  const direction = searchParams.get("sortOrder") === "asc" ? "ASC" : searchParams.get("sortOrder") === "desc" ? "DESC" : "";
  const expressions: Record<string, string> = mode === "purchase"
    ? {
        poNo: "purchase.poNo",
        requestNo: "requestNo",
        countryCode: "UPPER(TRIM(SUBSTRING_INDEX(requestMaster.countryCode, '-', 1)))",
        batchName: "batchName",
        status: "purchase.status",
        deviceCode: "requestItem.deviceCode",
        nameZh: "model.nameZh",
        nameEn: "model.nameEn",
        quantity: "requestItem.quantity",
        currency: "purchase.currency",
        taxExcludedUnitPrice: "item.taxExcludedUnitPrice",
        taxSurcharge: "item.taxSurcharge",
        unitPrice: "item.unitPrice",
        totalAmount: "totalAmount",
      }
    : {
        countryCode: "UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1)))",
        batchName: "req.batchName",
        requestNo: "ri.requestNo",
        deviceCode: "ri.deviceCode",
        modelCode: "model.modelCode",
        nameEn: "model.nameEn",
        supplierName: "supplierName",
        quantity: "ri.quantity",
        plannedDeliveryDate: "req.plannedDeliveryDate",
        createdAt: "req.createdAt",
        updatedAt: "req.updatedAt",
      };
  if (field === "batchName" && direction) return getNaturalBatchSort(expressions.batchName, direction, `${mode === "purchase" ? "item.id" : "ri.id"} ASC`);
  if (field && direction && expressions[field]) return `${expressions[field]} ${direction}, ${mode === "purchase" ? "item.id" : "ri.id"} ASC`;
  return mode === "purchase"
    ? `CASE WHEN TRIM(COALESCE(requestMaster.batchName, '')) REGEXP '^[A-Za-z]+[[:space:]]*-[[:space:]]*[0-9]+$' THEN 0 ELSE 1 END, CAST(SUBSTRING_INDEX(TRIM(requestMaster.batchName), '-', -1) AS UNSIGNED) DESC, UPPER(TRIM(SUBSTRING_INDEX(TRIM(requestMaster.batchName), '-', 1))) ASC, purchase.createdAt DESC, purchase.poNo ASC, item.id`
    : `CASE WHEN TRIM(COALESCE(req.batchName, '')) REGEXP '^[A-Za-z]+[[:space:]]*-[[:space:]]*[0-9]+$' THEN 0 ELSE 1 END, CAST(SUBSTRING_INDEX(TRIM(req.batchName), '-', -1) AS UNSIGNED) DESC, UPPER(TRIM(SUBSTRING_INDEX(TRIM(req.batchName), '-', 1))) ASC, req.updatedAt DESC, req.createdAt DESC, ri.id`;
}
