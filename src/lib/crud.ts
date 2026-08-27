import { randomUUID } from "crypto";
import { execute, queryRows, type Row } from "./db";
import { attachPartyCodes } from "./party-display";
import type { EntityConfig } from "./modules";
import { DEFAULT_PAGE_SIZE, normalizePageSize } from "./pagination";
import { requireRequestType } from "./request-type";
import { formatTableDateExpression, getNaturalBatchSort } from "./table-query";

function quoteIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function getWritableFields(config: EntityConfig) {
  return config.formFields.map((field) => field.key);
}

function getInsertFields(config: EntityConfig) {
  return Array.from(new Set([config.primaryKey, ...getWritableFields(config)]));
}

const shipmentDisplayFields = new Set(["countryCode", "destinationAddress", "recipientName", "supplierCode", "undertakingUnitCode", "customerCode"]);
const partyCodeDisplayFields = new Set(["supplierCode", "undertakingUnitCode", "customerCode"]);

function isShipmentDelivered(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function withShipmentReceiptStatus(config: EntityConfig, body: Row) {
  if (config.key !== "shipments") return body;
  return { ...body, isReceived: isShipmentDelivered(body.deliveredAt) };
}

function normalizeEntityBody(config: EntityConfig, body: Row) {
  const nextBody = withShipmentReceiptStatus(config, body);
  if (["requests", "request-items", "purchase-order-items"].includes(config.key)) {
    return normalizePurchasePrices(config, {
      ...nextBody,
      requestType: requireRequestType(nextBody.requestType ?? "整机"),
    });
  }
  return normalizePurchasePrices(config, nextBody);
}

function normalizePurchasePrices(config: EntityConfig, nextBody: Row) {
  if (config.key !== "purchase-order-items") return nextBody;

  const taxExcludedUnitPrice = Number(nextBody.taxExcludedUnitPrice ?? nextBody.unitPrice ?? 0);
  const taxSurcharge = Number(nextBody.taxSurcharge ?? 0);
  return {
    ...nextBody,
    taxExcludedUnitPrice,
    taxSurcharge,
    unitPrice: taxExcludedUnitPrice + taxSurcharge,
  };
}

function withPrimaryKey(config: EntityConfig, body: Row) {
  if (body[config.primaryKey]) return body;
  return {
    ...body,
    [config.primaryKey]: `${config.key}-${randomUUID()}`,
  };
}

export async function listEntityRows(config: EntityConfig, searchParams: URLSearchParams) {
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  const keyword = searchParams.get("keyword")?.trim();
  const table = quoteIdentifier(config.table);
  const shipmentAlias = config.key === "shipments" ? "shipment" : "";
  const tableSource = shipmentAlias ? `${table} AS ${shipmentAlias}` : table;
  const fieldReference = (field: string) => shipmentAlias ? `${shipmentAlias}.${quoteIdentifier(field)}` : quoteIdentifier(field);
  const fields = Array.from(new Set([
    ...[...config.listFields, ...config.formFields].map((field) => field.key),
    ...(financePartyEntityKeys.has(config.key) ? ["supplierId", "undertakingUnitId", "customerId"] : []),
  ]));
  const displayOnlyFields = config.key === "request-items"
    ? new Set(["customerCode"])
    : config.key === "purchase-orders"
      ? new Set(["requestType"])
      : config.key === "service-fee-snapshots"
        ? new Set(["receivingUnitCode", "payerCustomerCode"])
    : config.key === "shipments"
    ? new Set([...shipmentDisplayFields, "requestType"])
    : financePartyEntityKeys.has(config.key)
      ? partyCodeDisplayFields
      : new Set<string>();
  const storageFields = fields.filter((field) => !displayOnlyFields.has(field));
  const fieldTypes = new Map(
    [...config.listFields, ...config.formFields].map((field) => [field.key, field.type]),
  );
  const selectedFields = storageFields
    .map((field) => {
      const reference = fieldReference(field);
      const type = fieldTypes.get(field);
      const selectedReference = type === "date" || type === "datetime"
        ? formatTableDateExpression(reference)
        : field === "countryCode"
          ? normalizeCountryExpression(reference)
          : reference;
      return `${selectedReference} AS ${quoteIdentifier(field)}`;
    })
    .concat(config.key === "purchase-orders"
      ? [`
          COALESCE((
            SELECT GROUP_CONCAT(DISTINCT COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机') ORDER BY COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机') SEPARATOR ' / ')
            FROM purchaseorderitems AS poi
            LEFT JOIN requestitems AS ri ON ri.id = poi.requestItemId
            LEFT JOIN requests AS req ON req.requestNo = COALESCE(poi.requestNo, ri.requestNo)
            WHERE poi.purchaseOrderId = purchaseorders.purchaseOrderId
          ), '整机') AS \`requestType\`
        `]
      : [])
    .join(", ");
  const whereParts: string[] = [];
  const params: Row = {};

  if (keyword) {
    const keywordFields = storageFields.slice(0, 5);
    whereParts.push(
      `(${keywordFields.map((field) => `${fieldReference(field)} LIKE :keyword`).join(" OR ")})`,
    );
    params.keyword = `%${keyword}%`;
  }

  for (const filter of config.filters) {
    if (filter.key === "keyword") continue;
    const value = searchParams.get(filter.key)?.trim();
    if (value) {
      if (config.key === "shipments" && filter.key === "receiptStatus") {
        if (value === "received") whereParts.push(`${fieldReference("deliveredAt")} IS NOT NULL`);
        if (value === "unreceived") whereParts.push(`${fieldReference("deliveredAt")} IS NULL`);
        continue;
      }
      if (config.key === "shipments" && filter.key === "countryCode") {
        whereParts.push(`
          EXISTS (
            SELECT 1
            FROM purchaseorderitems AS poi
            INNER JOIN requestitems AS ri ON ri.id = poi.requestItemId
            INNER JOIN requests AS req ON req.requestNo = ri.requestNo
            WHERE (
              poi.id = shipment.purchaseOrderItemId
              OR (
                NULLIF(shipment.poNo, '') IS NOT NULL
                AND NULLIF(shipment.deviceCode, '') IS NOT NULL
                AND poi.poNo = shipment.poNo
                AND ri.deviceCode = shipment.deviceCode
              )
            )
            AND UPPER(TRIM(SUBSTRING_INDEX(req.countryCode, '-', 1))) = UPPER(:countryCode)
          )
        `);
        params.countryCode = normalizeCountryCodeFilter(value);
        continue;
      }
      if (filter.key === "countryCode") {
        whereParts.push(`${getEntityFilterFieldExpression(config, filter.key, shipmentAlias)} = :${filter.key}`);
        params[filter.key] = normalizeCountryCodeFilter(value);
        continue;
      }
      if (filter.key === "requestType" && config.key === "purchase-orders") {
        whereParts.push(`
          EXISTS (
            SELECT 1
            FROM purchaseorderitems AS poi
            LEFT JOIN requestitems AS ri ON ri.id = poi.requestItemId
            LEFT JOIN requests AS req ON req.requestNo = COALESCE(poi.requestNo, ri.requestNo)
            WHERE poi.purchaseOrderId = purchaseorders.purchaseOrderId
              AND COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机') = :requestType
          )
        `);
        params.requestType = value;
        continue;
      }
      if (filter.key === "requestType" && config.key === "shipments") {
        whereParts.push(`
          EXISTS (
            SELECT 1
            FROM purchaseorderitems AS poi
            LEFT JOIN requestitems AS ri ON ri.id = poi.requestItemId
            LEFT JOIN requests AS req ON req.requestNo = COALESCE(poi.requestNo, ri.requestNo)
            WHERE (
              poi.id = shipment.purchaseOrderItemId
              OR (
                NULLIF(shipment.poNo, '') IS NOT NULL
                AND NULLIF(shipment.deviceCode, '') IS NOT NULL
                AND poi.poNo = shipment.poNo
                AND ri.deviceCode = shipment.deviceCode
              )
            )
            AND COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机') = :requestType
          )
        `);
        params.requestType = value;
        continue;
      }
      whereParts.push(`${fieldReference(filter.key)} = :${filter.key}`);
      params[filter.key] = value;
    }
  }

  if (
    (config.key === "purchase-order-sn-items" || config.key === "purchase-order-plan-items") &&
    searchParams.get("purchaseOrderId")?.trim()
  ) {
    whereParts.push("`purchaseOrderId` = :purchaseOrderId");
    params.purchaseOrderId = searchParams.get("purchaseOrderId")!.trim();
  }

  const filterableStorageFields = new Set(storageFields);
  for (const field of config.listFields) {
    const values = Array.from(new Set(searchParams.getAll(`filter.${field.key}`).map((value) => value.trim()).filter(Boolean)));
    if (!values.length) continue;
    const parameterName = `columnFilter_${field.key.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const expression = filterableStorageFields.has(field.key)
      ? getEntityFilterFieldExpression(config, field.key, shipmentAlias)
      : getEntityDisplayFieldExpression(config, field.key, shipmentAlias);
    if (!expression) continue;
    whereParts.push(`${expression} IN (:${parameterName})`);
    params[parameterName] = values;
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const orderBy = getEntityOrderBy(config, shipmentAlias, searchParams);
  const [{ total }] = await queryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${tableSource} ${where}`,
    params,
  );
  const normalizedTotal = Number(total ?? 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / pageSize));
  const page = Math.min(requestedPage, totalPages);
  params.limit = pageSize;
  params.offset = (page - 1) * pageSize;
  const rows = await queryRows(
    `SELECT ${selectedFields} FROM ${tableSource} ${where} ${orderBy} LIMIT :limit OFFSET :offset`,
    params,
  );

  const enrichedRows = config.key === "shipments"
    ? await enrichShipmentRows(rows)
    : config.key === "service-fee-snapshots"
      ? await enrichServiceFeeSnapshotParties(rows)
    : await enrichFinancialPartyRows(config.key, rows);
  return {
    rows: enrichedRows,
    total: normalizedTotal,
    page,
    pageSize,
    totalPages,
  };
}

function normalizeCountryCodeFilter(value: string) {
  return value.split(/\s*-\s*/, 1)[0].trim();
}

export function getEntityOrderBy(config: EntityConfig, shipmentAlias = "shipment", searchParams?: URLSearchParams) {
  const requestedSortField = searchParams?.get("sortField")?.trim() ?? "";
  const requestedSortOrder = searchParams?.get("sortOrder") === "asc" ? "ASC" : searchParams?.get("sortOrder") === "desc" ? "DESC" : "";
  const sortableFields = new Set(config.listFields.map((field) => field.key));
  const fields = new Set([
    ...config.listFields.map((field) => field.key),
    ...config.formFields.map((field) => field.key),
  ]);
  if (requestedSortField && requestedSortOrder && sortableFields.has(requestedSortField) && fields.has(requestedSortField)) {
    const sortReference = getEntitySortReference(config, requestedSortField, shipmentAlias);
    if (sortReference) {
      const tieBreaker = config.primaryKey === requestedSortField ? "" : `${fieldReferenceForSort(config, config.primaryKey, shipmentAlias)} ASC`;
      return `ORDER BY ${requestedSortField === "batchName"
        ? getNaturalBatchSort(sortReference, requestedSortOrder, tieBreaker)
        : `${sortReference} ${requestedSortOrder}${tieBreaker ? `, ${tieBreaker}` : ""}`}`;
    }
  }
  if (config.key === "shipments") {
    const prefix = shipmentAlias ? `${shipmentAlias}.` : "";
    return `
      ORDER BY
        CASE WHEN TRIM(COALESCE(${prefix}\`batchName\`, '')) REGEXP '^[A-Za-z]+-[0-9]+$' THEN 0 ELSE 1 END,
        CAST(SUBSTRING_INDEX(TRIM(${prefix}\`batchName\`), '-', -1) AS UNSIGNED) DESC,
        UPPER(SUBSTRING_INDEX(TRIM(${prefix}\`batchName\`), '-', 1)) ASC,
        ${prefix}\`createdAt\` DESC
    `;
  }
  if (config.key === "request-items") {
    const batchName = `(
      SELECT requestSort.batchName
      FROM requests AS requestSort
      WHERE requestSort.requestNo = requestitems.requestNo
      LIMIT 1
    )`;
    return getBatchOrderBy(batchName, "requestitems.requestNo ASC, requestitems.id ASC");
  }
  if (config.key === "purchase-order-items") {
    const batchName = `(
      SELECT requestSort.batchName
      FROM requestitems AS requestItemSort
      LEFT JOIN requests AS requestSort ON requestSort.requestNo = requestItemSort.requestNo
      WHERE requestItemSort.id = purchaseorderitems.requestItemId
        OR (
          NULLIF(purchaseorderitems.requestNo, '') IS NOT NULL
          AND requestItemSort.requestNo = purchaseorderitems.requestNo
        )
      LIMIT 1
    )`;
    return getBatchOrderBy(batchName, "purchaseorderitems.poNo ASC, purchaseorderitems.id ASC");
  }
  if (config.key === "billing-ledgers") {
    return getBatchOrderBy(
      "billinginstanceledgers.`batchName`",
      "billinginstanceledgers.`countryCode` ASC, billinginstanceledgers.`requestNo` ASC, billinginstanceledgers.`ledgerId` ASC",
    );
  }
  return config.defaultSort ? `ORDER BY ${config.defaultSort}` : "";
}

function fieldReferenceForSort(config: EntityConfig, field: string, shipmentAlias: string) {
  return shipmentAlias && config.key === "shipments"
    ? `${shipmentAlias}.${quoteIdentifier(field)}`
    : quoteIdentifier(field);
}

function getEntitySortReference(config: EntityConfig, field: string, shipmentAlias: string) {
  const displayOnlyFields = config.key === "shipments"
    ? shipmentDisplayFields
    : config.key === "service-fee-snapshots"
      ? new Set(["receivingUnitCode", "payerCustomerCode"])
      : config.key === "purchase-orders"
        ? new Set(["requestType"])
        : financePartyEntityKeys.has(config.key)
          ? partyCodeDisplayFields
          : new Set<string>();
  if (displayOnlyFields.has(field)) {
    const displayExpression = getEntityDisplayFieldExpression(config, field, shipmentAlias);
    if (displayExpression) return displayExpression;
    if (config.key === "purchase-orders" && field === "requestType") {
      return `(SELECT GROUP_CONCAT(DISTINCT COALESCE(NULLIF(typeItem.requestType, ''), NULLIF(typeRequestItem.requestType, ''), NULLIF(typeRequest.requestType, ''), '整机') ORDER BY COALESCE(NULLIF(typeItem.requestType, ''), NULLIF(typeRequestItem.requestType, ''), NULLIF(typeRequest.requestType, ''), '整机') SEPARATOR ' / ') FROM purchaseorderitems typeItem LEFT JOIN requestitems typeRequestItem ON typeRequestItem.id = typeItem.requestItemId LEFT JOIN requests typeRequest ON typeRequest.requestNo = COALESCE(typeItem.requestNo, typeRequestItem.requestNo) WHERE typeItem.purchaseOrderId = purchaseorders.purchaseOrderId)`;
    }
    return null;
  }
  if (field === "countryCode") return getEntityFilterFieldExpression(config, field, shipmentAlias);
  return fieldReferenceForSort(config, field, shipmentAlias);
}

export async function listEntityFilterOptions(
  config: EntityConfig,
  searchParams: URLSearchParams,
) {
  const field = searchParams.get("field")?.trim() ?? "";
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const fieldConfig = config.listFields.find((item) => item.key === field);
  if (!fieldConfig) return { options: [] as Array<{ value: string; count: number }> };

  if (config.key === "purchase-orders" && field === "requestType") {
    const params: Row = {};
    const keywordClause = keyword ? "AND COALESCE(NULLIF(typeItem.requestType, ''), NULLIF(typeRequestItem.requestType, ''), NULLIF(typeRequest.requestType, ''), '整机') LIKE :optionKeyword" : "";
    if (keyword) params.optionKeyword = `%${keyword}%`;
    const rows = await queryRows<{ value: string; count: number }>(
      `
        SELECT value, COUNT(*) AS count
        FROM (
          SELECT purchase.purchaseOrderId,
            COALESCE(NULLIF(typeItem.requestType, ''), NULLIF(typeRequestItem.requestType, ''), NULLIF(typeRequest.requestType, ''), '整机') AS value
          FROM purchaseorders purchase
          LEFT JOIN purchaseorderitems typeItem ON typeItem.purchaseOrderId = purchase.purchaseOrderId
          LEFT JOIN requestitems typeRequestItem ON typeRequestItem.id = typeItem.requestItemId
          LEFT JOIN requests typeRequest ON typeRequest.requestNo = COALESCE(typeItem.requestNo, typeRequestItem.requestNo)
          WHERE 1 = 1 ${keywordClause}
          GROUP BY purchase.purchaseOrderId, value
        ) valuesList
        GROUP BY value
        ORDER BY value
        LIMIT 500
      `,
      params,
    );
    return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
  }

  const displayOnlyFields = config.key === "shipments"
    ? shipmentDisplayFields
    : config.key === "service-fee-snapshots"
      ? new Set(["receivingUnitCode", "payerCustomerCode"])
      : financePartyEntityKeys.has(config.key)
        ? partyCodeDisplayFields
        : new Set<string>();
  const shipmentAlias = config.key === "shipments" ? "shipment" : "";
  const table = quoteIdentifier(config.table);
  const tableSource = shipmentAlias ? `${table} AS ${shipmentAlias}` : table;
  const reference = displayOnlyFields.has(field)
    ? getEntityDisplayFieldExpression(config, field, shipmentAlias)
    : getEntityFilterFieldExpression(config, field, shipmentAlias);
  if (!reference) return { options: [] as Array<{ value: string; count: number }> };
  const params: Row = {};
  const whereParts = [`${reference} IS NOT NULL`, `TRIM(${reference}) <> ''`];
  if (keyword) {
    whereParts.push(`${reference} LIKE :optionKeyword`);
    params.optionKeyword = `%${keyword}%`;
  }
  for (const filter of config.filters) {
    if (filter.key === "keyword" || filter.key === field) continue;
    const value = searchParams.get(filter.key)?.trim();
    if (!value) continue;
    if (config.key === "shipments" && filter.key === "countryCode") {
      const countryExpression = getEntityDisplayFieldExpression(config, "countryCode", shipmentAlias);
      if (countryExpression) {
        whereParts.push(`${countryExpression} = UPPER(TRIM(SUBSTRING_INDEX(:option_countryCode, '-', 1)))`);
        params.option_countryCode = value;
      }
      continue;
    }
    if (config.key === "shipments" && filter.key === "receiptStatus") {
      whereParts.push(value === "received" ? `${shipmentAlias}.deliveredAt IS NOT NULL` : `${shipmentAlias}.deliveredAt IS NULL`);
      continue;
    }
    if (filter.key === "countryCode") {
      whereParts.push(`${getEntityFilterFieldExpression(config, filter.key, shipmentAlias)} = :option_${filter.key}`);
      params[`option_${filter.key}`] = normalizeCountryCodeFilter(value);
      continue;
    }
    if (!config.formFields.some((item) => item.key === filter.key)) continue;
    whereParts.push(`${shipmentAlias ? `${shipmentAlias}.` : ""}${quoteIdentifier(filter.key)} = :option_${filter.key}`);
    params[`option_${filter.key}`] = value;
  }
  for (const candidate of config.listFields) {
    if (candidate.key === field) continue;
    const values = Array.from(new Set(searchParams.getAll(`filter.${candidate.key}`).map((value) => value.trim()).filter(Boolean)));
    if (!values.length) continue;
    const candidateReference = displayOnlyFields.has(candidate.key)
      ? getEntityDisplayFieldExpression(config, candidate.key, shipmentAlias)
      : getEntityFilterFieldExpression(config, candidate.key, shipmentAlias);
    if (!candidateReference) continue;
    const parameterName = `candidate_${candidate.key.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    whereParts.push(`${candidateReference} IN (:${parameterName})`);
    params[parameterName] = values;
  }
  const selectedValues = searchParams.getAll("selected").map((value) => value.trim()).filter(Boolean);
  if (selectedValues.length) {
    whereParts.push(`${reference} IN (:selectedValues)`);
    params.selectedValues = selectedValues;
  }
  const rows = await queryRows<{ value: string; count: number }>(
    `SELECT ${reference} AS value, COUNT(*) AS count FROM ${tableSource} WHERE ${whereParts.join(" AND ")} GROUP BY ${reference} ORDER BY value LIMIT 500`,
    params,
  );
  return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
}

function getEntityDisplayFieldExpression(config: EntityConfig, field: string, shipmentAlias = "") {
  const source = shipmentAlias ? `${shipmentAlias}.` : `${quoteIdentifier(config.table)}.`;
  if (config.key === "service-fee-snapshots") {
    if (field === "receivingUnitCode") {
      return `(SELECT unit.undertakingUnitCode FROM undertakingunits unit WHERE unit.undertakingUnitId = ${source}receivingUnitId LIMIT 1)`;
    }
    if (field === "payerCustomerCode") {
      return `(SELECT customer.customerCode FROM customers customer WHERE customer.customerId = ${source}payerCustomerId LIMIT 1)`;
    }
  }
  if (config.key === "shipments") {
    if (field === "countryCode") {
      const linkedCountry = `(SELECT req.countryCode
        FROM purchaseorderitems poi
        LEFT JOIN requestitems ri ON ri.id = poi.requestItemId
        LEFT JOIN requests req ON req.requestNo = COALESCE(NULLIF(poi.requestNo, ''), ri.requestNo)
        WHERE (
          poi.id = shipment.purchaseOrderItemId
          OR (
            NULLIF(shipment.poNo, '') IS NOT NULL
            AND NULLIF(shipment.deviceCode, '') IS NOT NULL
            AND poi.poNo = shipment.poNo
            AND ri.deviceCode = shipment.deviceCode
          )
        )
        ORDER BY (poi.id = shipment.purchaseOrderItemId) DESC, poi.id DESC
        LIMIT 1)`;
      return `UPPER(TRIM(SUBSTRING_INDEX(${linkedCountry}, '-', 1)))`;
    }
    if (field === "dcNameZh") return `(SELECT dc.nameZh FROM datacenters dc WHERE dc.dcCode = shipment.dcCode LIMIT 1)`;
    if (field === "destinationAddress") return `(SELECT location.fullAddress FROM deliverylocations location WHERE location.locationId = shipment.destinationLocationId LIMIT 1)`;
    if (field === "recipientName") return `(SELECT contact.name FROM deliverycontacts contact WHERE contact.contactId = shipment.recipientContactId LIMIT 1)`;
    if (["supplierCode", "undertakingUnitCode", "customerCode"].includes(field)) {
      const idField = field === "supplierCode" ? "supplierId" : field === "undertakingUnitCode" ? "undertakingUnitId" : "customerId";
      const tableName = field === "supplierCode" ? "suppliers" : field === "undertakingUnitCode" ? "undertakingunits" : "customers";
      const idColumn = field === "supplierCode" ? "supplierId" : field === "undertakingUnitCode" ? "undertakingUnitId" : "customerId";
      const codeColumn = field;
      return `(SELECT party.${codeColumn} FROM ${tableName} party INNER JOIN purchaseorderitems poi ON poi.poNo = shipment.poNo LEFT JOIN requestitems ri ON ri.id = poi.requestItemId WHERE (poi.id = shipment.purchaseOrderItemId OR (NULLIF(shipment.deviceCode, '') IS NOT NULL AND ri.deviceCode = shipment.deviceCode)) AND party.${idColumn} = ri.${idField} ORDER BY (poi.id = shipment.purchaseOrderItemId) DESC LIMIT 1)`;
    }
  }
  if (partyCodeDisplayFields.has(field)) {
    const idField = field === "supplierCode" ? "supplierId" : field === "undertakingUnitCode" ? "undertakingUnitId" : "customerId";
    const tableName = field === "supplierCode" ? "suppliers" : field === "undertakingUnitCode" ? "undertakingunits" : "customers";
    return `(SELECT party.${field} FROM ${tableName} party WHERE party.${idField} = ${source}${idField} LIMIT 1)`;
  }
  return "";
}

function filterableFieldReference(config: EntityConfig, field: string, shipmentAlias = "") {
  return shipmentAlias ? `${shipmentAlias}.${quoteIdentifier(field)}` : `${quoteIdentifier(config.table)}.${quoteIdentifier(field)}`;
}

function getEntityFilterFieldExpression(config: EntityConfig, field: string, shipmentAlias = "") {
  const reference = filterableFieldReference(config, field, shipmentAlias);
  const fieldConfig = config.listFields.find((item) => item.key === field);
  if (field === "countryCode") return normalizeCountryExpression(reference);
  return fieldConfig?.type === "date" || fieldConfig?.type === "datetime"
    ? formatTableDateExpression(reference)
    : reference;
}

function normalizeCountryExpression(reference: string) {
  return `UPPER(TRIM(SUBSTRING_INDEX(${reference}, '-', 1)))`;
}

function getBatchOrderBy(batchName: string, tieBreakers: string) {
  return `
    ORDER BY
      CASE WHEN TRIM(COALESCE(${batchName}, '')) REGEXP '^[A-Za-z]+-[0-9]+$' THEN 0 ELSE 1 END,
      CAST(SUBSTRING_INDEX(TRIM(COALESCE(${batchName}, '')), '-', -1) AS UNSIGNED) DESC,
      UPPER(SUBSTRING_INDEX(TRIM(COALESCE(${batchName}, '')), '-', 1)) ASC,
      ${tieBreakers}
  `;
}

const financePartyEntityKeys = new Set(["request-items", "billing-ledgers", "prepayment-contract-items", "monthly-billing-writeoffs", "monthly-prepayment-writeoffs", "service-fee-snapshot-items", "internal-service-fees"]);

async function enrichFinancialPartyRows(entityKey: string, rows: Row[]) {
  if (!financePartyEntityKeys.has(entityKey) || !rows.length) return rows;
  const requestNos = uniqueValues(rows, "requestNo");
  const requestItems = requestNos.length
    ? await queryRows<Row>(
      "SELECT requestNo, deviceCode, supplierId, undertakingUnitId, customerId FROM requestitems WHERE requestNo IN (:requestNos)",
      { requestNos },
    )
    : [];
  const partyByRequestDevice = new Map(
    requestItems.map((item) => [`${String(item.requestNo ?? "")}::${String(item.deviceCode ?? "")}`, item]),
  );
  const enrichedRows = rows.map((row) => {
    const party = partyByRequestDevice.get(`${String(row.requestNo ?? "")}::${String(row.deviceCode ?? "")}`);
    return {
      ...row,
      supplierId: row.supplierId || party?.supplierId || "",
      undertakingUnitId: row.undertakingUnitId || party?.undertakingUnitId || "",
      customerId: row.customerId || party?.customerId || "",
    };
  });
  return attachPartyCodes(enrichedRows);
}

async function enrichServiceFeeSnapshotParties(rows: Row[]) {
  if (!rows.length) return rows;
  const receivingUnitIds = uniqueValues(rows, "receivingUnitId");
  const payerCustomerIds = uniqueValues(rows, "payerCustomerId");
  const [units, customers] = await Promise.all([
    receivingUnitIds.length
      ? queryRows("SELECT undertakingUnitId, undertakingUnitCode FROM undertakingunits WHERE undertakingUnitId IN (:receivingUnitIds)", { receivingUnitIds })
      : [],
    payerCustomerIds.length
      ? queryRows("SELECT customerId, customerCode FROM customers WHERE customerId IN (:payerCustomerIds)", { payerCustomerIds })
      : [],
  ]);
  const unitCodeById = new Map(units.map((row) => [String(row.undertakingUnitId), String(row.undertakingUnitCode ?? row.undertakingUnitId ?? "")]));
  const customerCodeById = new Map(customers.map((row) => [String(row.customerId), String(row.customerCode ?? row.customerId ?? "")]));
  return rows.map((row) => ({
    ...row,
    receivingUnitCode: unitCodeById.get(String(row.receivingUnitId ?? "")) ?? String(row.receivingUnitId ?? ""),
    payerCustomerCode: customerCodeById.get(String(row.payerCustomerId ?? "")) ?? String(row.payerCustomerId ?? ""),
  }));
}

export async function getEntityRow(config: EntityConfig, id: string) {
  const table = quoteIdentifier(config.table);
  const primaryKey = quoteIdentifier(config.primaryKey);
  const rows = await queryRows(`SELECT * FROM ${table} WHERE ${primaryKey} = :id LIMIT 1`, { id });
  return rows[0] ?? null;
}

export async function createEntityRow(config: EntityConfig, body: Row) {
  const nextBody = normalizeEntityBody(config, withPrimaryKey(config, body));
  const fields = getInsertFields(config);
  const table = quoteIdentifier(config.table);
  const columns = fields.map(quoteIdentifier).join(", ");
  const values = fields.map((field) => `:${field}`).join(", ");
  const params = Object.fromEntries(fields.map((field) => [field, nextBody[field] ?? null]));

  await execute(`INSERT INTO ${table} (${columns}) VALUES (${values})`, params);
  return getEntityRow(config, String(nextBody[config.primaryKey]));
}

export async function updateEntityRow(config: EntityConfig, id: string, body: Row) {
  const fields = getWritableFields(config).filter((field) => field !== config.primaryKey);
  const table = quoteIdentifier(config.table);
  const primaryKey = quoteIdentifier(config.primaryKey);
  const assignments = fields.map((field) => `${quoteIdentifier(field)} = :${field}`).join(", ");
  const nextBody = normalizeEntityBody(config, body);
  if (config.key === "requests") await assertRequestTypeCanChange(id, String(nextBody.requestType));
  const params = Object.fromEntries(fields.map((field) => [field, nextBody[field] ?? null]));

  await execute(`UPDATE ${table} SET ${assignments} WHERE ${primaryKey} = :id`, {
    ...params,
    id,
  });
  return getEntityRow(config, id);
}

async function assertRequestTypeCanChange(requestNo: string, nextRequestType: string) {
  const current = await getEntityRow(getRequestConfig(), requestNo);
  if (!current || String(current.requestType ?? "整机") === nextRequestType) return;

  const rows = await queryRows<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM purchaseorderitems poi
      LEFT JOIN requestitems ri ON ri.id = poi.requestItemId
      WHERE COALESCE(NULLIF(poi.requestNo, ''), ri.requestNo) = :requestNo
    `,
    { requestNo },
  );
  if (Number(rows[0]?.count ?? 0) > 0) {
    throw new Error("该需求单已产生采购数据，不能直接修改整机/备件类型");
  }
}

function getRequestConfig(): EntityConfig {
  return {
    key: "requests",
    title: "需求单",
    table: "requests",
    primaryKey: "requestNo",
    navGroup: "客户需求",
    route: "/requests/orders",
    description: "",
    filters: [],
    listFields: [],
    formFields: [],
  };
}

export async function deleteEntityRow(config: EntityConfig, id: string) {
  const table = quoteIdentifier(config.table);
  const primaryKey = quoteIdentifier(config.primaryKey);
  await execute(`DELETE FROM ${table} WHERE ${primaryKey} = :id`, { id });
}

export async function replaceEntityRows(config: EntityConfig, rows: Row[]) {
  for (const row of rows) {
    await upsertEntityRow(config, row);
  }
}

export async function upsertEntityRow(config: EntityConfig, row: Row) {
  const existing = await getEntityRow(config, String(row[config.primaryKey]));
  if (existing) {
    await updateEntityRow(config, String(row[config.primaryKey]), row);
  } else {
    await createEntityRow(config, row);
  }
}

async function enrichShipmentRows(rows: Row[]): Promise<Row[]> {
  const dcCodes = uniqueValues(rows, "dcCode");
  const locationIds = uniqueValues(rows, "destinationLocationId");
  const contactIds = uniqueValues(rows, "recipientContactId");
  const poNos = uniqueValues(rows, "poNo");
  const deviceCodes = uniqueValues(rows, "deviceCode");
  const [datacenters, locations, contacts, purchaseOrders, purchaseLines, instanceModels] = await Promise.all([
    dcCodes.length ? queryRows("SELECT dcCode, nameZh FROM datacenters WHERE dcCode IN (:dcCodes)", { dcCodes }) : [],
    locationIds.length
      ? queryRows("SELECT locationId, fullAddress FROM deliverylocations WHERE locationId IN (:locationIds)", { locationIds })
      : [],
    contactIds.length ? queryRows("SELECT contactId, name FROM deliverycontacts WHERE contactId IN (:contactIds)", { contactIds }) : [],
    poNos.length ? queryRows("SELECT purchaseOrderId, poNo FROM purchaseorders WHERE poNo IN (:poNos)", { poNos }) : [],
    poNos.length
      ? queryRows("SELECT poi.id AS purchaseOrderItemId, poi.poNo, COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机') AS requestType, ri.deviceCode, ri.supplierId, ri.undertakingUnitId, ri.customerId, req.countryCode, req.batchName FROM purchaseorderitems poi LEFT JOIN requestitems ri ON ri.id = poi.requestItemId LEFT JOIN requests req ON req.requestNo = ri.requestNo WHERE poi.poNo IN (:poNos)", { poNos })
      : [],
    deviceCodes.length
      ? queryRows("SELECT deviceCode, nameEn FROM instancemodels WHERE deviceCode IN (:deviceCodes)", { deviceCodes })
      : [],
  ]);
  const datacenterByCode = new Map(datacenters.map((row) => [String(row.dcCode), row]));
  const locationById = new Map(locations.map((row) => [String(row.locationId), row]));
  const contactById = new Map(contacts.map((row) => [String(row.contactId), row]));
  const purchaseOrderByPoNo = new Map(purchaseOrders.map((row) => [String(row.poNo), row]));
  const instanceModelByDeviceCode = new Map(instanceModels.map((row) => [String(row.deviceCode), row]));
  const purchaseLineById = new Map(purchaseLines.map((row) => [String(row.purchaseOrderItemId), row]));
  const purchaseLineByPoDevice = new Map(purchaseLines.map((row) => [`${String(row.poNo)}::${String(row.deviceCode ?? "")}`, row]));
  const purchaseLinesByPoNo = new Map<string, Row[]>();
  for (const line of purchaseLines) {
    const poNo = String(line.poNo ?? "");
    purchaseLinesByPoNo.set(poNo, [...(purchaseLinesByPoNo.get(poNo) ?? []), line]);
  }

  const enriched = rows.map((row): Row => {
    const datacenter = datacenterByCode.get(String(row.dcCode ?? ""));
    const location = locationById.get(String(row.destinationLocationId ?? ""));
    const contact = contactById.get(String(row.recipientContactId ?? ""));
    const poNo = String(row.poNo ?? "");
    const matchingPoLines = purchaseLinesByPoNo.get(poNo) ?? [];
    const purchaseLine = purchaseLineById.get(String(row.purchaseOrderItemId ?? ""))
      ?? purchaseLineByPoDevice.get(`${poNo}::${String(row.deviceCode ?? "")}`)
      ?? (matchingPoLines.length === 1 ? matchingPoLines[0] : undefined);
    const instanceModel = instanceModelByDeviceCode.get(String(row.deviceCode ?? ""));
    return {
      ...row,
      // The logistics record keeps its original value, while the list and export always show the current model name.
      nameEn: instanceModel?.nameEn ?? row.nameEn,
      countryCode: purchaseLine?.countryCode ?? row.countryCode ?? "",
      batchName: purchaseLine?.batchName ?? row.batchName ?? "",
      requestType: purchaseLine?.requestType ?? row.requestType ?? "整机",
      dcNameZh: datacenter?.nameZh ?? row.dcNameZh ?? row.dcCode,
      destinationAddress: location?.fullAddress ?? row.snapshotDestinationAddress ?? row.destinationLocationId,
      recipientName: contact?.name ?? row.snapshotRecipientName ?? row.recipientContactId,
      purchaseOrderId: purchaseOrderByPoNo.get(String(row.poNo ?? ""))?.purchaseOrderId ?? null,
      supplierId: purchaseLine?.supplierId ?? row.supplierId ?? "",
      undertakingUnitId: purchaseLine?.undertakingUnitId ?? row.undertakingUnitId ?? "",
      customerId: purchaseLine?.customerId ?? row.customerId ?? "",
      isReceived: isShipmentDelivered(row.deliveredAt),
    };
  });
  return attachPartyCodes(enriched);
}

function uniqueValues(rows: Row[], key: string) {
  return Array.from(new Set(rows.map((row) => String(row[key] ?? "").trim()).filter(Boolean)));
}
