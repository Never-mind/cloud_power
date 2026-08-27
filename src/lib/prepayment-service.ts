import type { PoolConnection } from "mysql2/promise";
import {
  execute,
  executeInTransaction,
  queryRows,
  withTransaction,
  type Row,
} from "./db";
import { attachPartyCodes } from "./party-display";
import { DEFAULT_PAGE_SIZE, normalizePageSize } from "./pagination";
import { appendTableFilterOptionConditions, appendTableInFilter, formatTableDateExpression, getTableSort, listSqlFilterOptions } from "./table-query";
import {
  buildMonthlyWriteOffRows,
  buildPrepaymentDraft,
  filterAvailablePrepaymentLines,
  firstDayOfMonth,
  toPrepaymentContractLineStorage,
  type MonthlyWriteOffSourceLine,
  type PrepaymentContractLineDraft,
  type PrepaymentPurchaseLine,
} from "./prepayment-workflow";

type PurchaseLineRow = PrepaymentPurchaseLine & {
  purchaseStatus?: string | null;
  requestStatus?: string | null;
};

type PrepaymentLineRow = PrepaymentContractLineDraft & {
  status?: string | null;
};

export async function listAvailablePrepaymentLines(options: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  countryCode?: string;
  purchaseOrderItemIds?: string[];
  requestType?: string;
  searchParams?: URLSearchParams;
} = {}) {
  const requestedPage = Math.max(1, Math.floor(Number(options.page ?? 1) || 1));
  const conditions = [
    "po.status LIKE :purchaseStatus",
    "req.status <> :requestDraftStatus",
    `NOT EXISTS (
      SELECT 1 FROM prepaymentcontractitems pci
      INNER JOIN prepaymentcontracts pc ON pc.contractNo = pci.contractNo
      WHERE pci.purchaseOrderItemId = poi.id AND pc.status IN ('草稿', '已确认')
    )`,
    "COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机') = COALESCE(NULLIF(:requestType, ''), COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机'))",
  ];
  const params: Row = { purchaseStatus: "%确认%", requestDraftStatus: "草稿", requestType: options.requestType?.trim() || null };
  if (options.countryCode?.trim()) {
    conditions.push("req.countryCode = :countryCode");
    params.countryCode = options.countryCode.trim();
  }
  if (options.keyword?.trim()) {
    conditions.push("(req.countryCode LIKE :keyword OR req.batchName LIKE :keyword OR COALESCE(poi.requestNo, po.requestNo, ri.requestNo) LIKE :keyword OR poi.poNo LIKE :keyword OR ri.deviceCode LIKE :keyword OR im.modelCode LIKE :keyword OR im.nameEn LIKE :keyword)");
    params.keyword = `%${options.keyword.trim()}%`;
  }
  const filterExpressions: Record<string, string> = {
    countryCode: "req.countryCode", batchName: "req.batchName", requestNo: "COALESCE(poi.requestNo, po.requestNo, ri.requestNo)",
    poNo: "poi.poNo", deviceCode: "ri.deviceCode", requestType: "COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机')",
    modelCode: "im.modelCode", nameEn: "im.nameEn", quantity: "ri.quantity", currency: "po.currency", actualUnitPrice: "poi.unitPrice",
  };
  if (options.searchParams) {
    for (const [field, expression] of Object.entries(filterExpressions)) {
      appendTableInFilter(conditions, params, expression, field, options.searchParams, "availablePrepayment");
    }
  }
  const requestedSort = options.searchParams ? getTableSort(options.searchParams, filterExpressions) : "";
  const ids = Array.from(new Set((options.purchaseOrderItemIds ?? []).map(String).filter(Boolean)));
  // Explicit workflow selections are intentionally not restricted by the list cap.
  const pageSize = ids.length
    ? Math.max(ids.length, 1)
    : Math.min(100, Math.max(1, Math.floor(Number(options.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE)));
  if (ids.length) { conditions.push("poi.id IN (:purchaseOrderItemIds)"); params.purchaseOrderItemIds = ids; }
  const sourceFrom = `
    FROM purchaseorderitems poi
    LEFT JOIN purchaseorders po ON po.purchaseOrderId = poi.purchaseOrderId OR (poi.purchaseOrderId IS NULL AND po.poNo = poi.poNo)
    LEFT JOIN requestitems ri ON ri.id = poi.requestItemId
    LEFT JOIN requests req ON req.requestNo = COALESCE(poi.requestNo, po.requestNo, ri.requestNo)
    LEFT JOIN instancemodels im ON im.deviceCode = ri.deviceCode
    WHERE ${conditions.join(" AND ")}
  `;
  const [{ total: totalValue }] = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total ${sourceFrom}`, params);
  const total = Number(totalValue ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const purchaseLines = await queryRows<PurchaseLineRow>(
    `
      SELECT
        poi.id,
        poi.poNo,
        COALESCE(poi.requestNo, po.requestNo, ri.requestNo) AS requestNo,
        req.countryCode,
        req.batchName,
        poi.requestItemId,
        ri.deviceCode,
        COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机') AS requestType,
        im.modelCode,
        im.nameEn,
        ri.supplierId,
        ri.undertakingUnitId,
        ri.customerId,
        ri.quantity,
        po.currency,
        poi.unitPrice,
        po.status AS purchaseStatus,
        req.status AS requestStatus
      ${sourceFrom}
      ${requestedSort || "ORDER BY CASE WHEN TRIM(COALESCE(req.batchName, '')) REGEXP '^[A-Za-z]+[[:space:]]*-[[:space:]]*[0-9]+$' THEN 0 ELSE 1 END, CAST(SUBSTRING_INDEX(TRIM(req.batchName), '-', -1) AS UNSIGNED) DESC, UPPER(TRIM(SUBSTRING_INDEX(TRIM(req.batchName), '-', 1))) ASC, req.countryCode ASC, po.poNo ASC, poi.id"}
      LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: pageSize, offset: (page - 1) * pageSize },
  );
  return {
    rows: filterAvailablePrepaymentLines({ purchaseLines, occupiedPurchaseOrderItemIds: [] }),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function listAvailablePrepaymentLineFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    countryCode: "req.countryCode", batchName: "req.batchName", requestNo: "COALESCE(poi.requestNo, po.requestNo, ri.requestNo)",
    poNo: "poi.poNo", deviceCode: "ri.deviceCode", requestType: "COALESCE(NULLIF(poi.requestType, ''), NULLIF(ri.requestType, ''), NULLIF(req.requestType, ''), '整机')",
    modelCode: "im.modelCode", nameEn: "im.nameEn", quantity: "ri.quantity", currency: "po.currency", actualUnitPrice: "poi.unitPrice",
  };
  return listSqlFilterOptions({
    expressions,
    searchParams,
    from: `purchaseorderitems poi
      LEFT JOIN purchaseorders po ON po.purchaseOrderId = poi.purchaseOrderId OR (poi.purchaseOrderId IS NULL AND po.poNo = poi.poNo)
      LEFT JOIN requestitems ri ON ri.id = poi.requestItemId
      LEFT JOIN requests req ON req.requestNo = COALESCE(poi.requestNo, po.requestNo, ri.requestNo)
      LEFT JOIN instancemodels im ON im.deviceCode = ri.deviceCode`,
    conditions: [
      "po.status LIKE :availablePurchaseStatus",
      "req.status <> :availableRequestDraftStatus",
      `NOT EXISTS (
        SELECT 1 FROM prepaymentcontractitems pci
        INNER JOIN prepaymentcontracts pc ON pc.contractNo = pci.contractNo
        WHERE pci.purchaseOrderItemId = poi.id AND pc.status IN ('草稿', '已确认')
      )`,
    ],
    params: { availablePurchaseStatus: "%确认%", availableRequestDraftStatus: "草稿" },
  });
}

export async function createPrepaymentDraft({
  contractNo,
  effectiveDate,
  purchaseOrderItemIds,
  currency = "USD",
}: {
  contractNo: string;
  effectiveDate: string;
  purchaseOrderItemIds: string[];
  currency?: string;
}) {
  if (!contractNo.trim()) throw new Error("预付款合同号不能为空");
  if (!effectiveDate.trim()) throw new Error("合同生效日期不能为空");
  if (!purchaseOrderItemIds.length) {
    const contract = {
      contractNo: contractNo.trim(),
      status: "草稿",
      currency: currency.trim() || "USD",
      effectiveDate: firstDayOfMonth(effectiveDate),
      totalAmount: 0,
    };
    await execute(
      `
        INSERT INTO prepaymentcontracts
          (contractNo, status, currency, effectiveDate, totalAmount)
        VALUES
          (:contractNo, :status, :currency, :effectiveDate, :totalAmount)
      `,
      contract,
    );
    return contract;
  }

  const availableLines = await listAvailablePrepaymentLines({ purchaseOrderItemIds, pageSize: Math.max(purchaseOrderItemIds.length, 1) });
  const selected = availableLines.rows.filter((line) => purchaseOrderItemIds.includes(line.id));
  if (!selected.length) throw new Error("所选实例已被占用或不满足预付款合同生成条件");

  const draft = buildPrepaymentDraft({
    contractNo,
    effectiveDate: firstDayOfMonth(effectiveDate),
    purchaseLines: selected,
  });
  await assertPrepaymentInstanceOwnership(draft.lines);

  await withTransaction(async (connection) => {
    await executeInTransaction(
      connection,
      `
        INSERT INTO prepaymentcontracts
          (contractNo, status, currency, effectiveDate, totalAmount)
        VALUES
          (:contractNo, :status, :currency, :effectiveDate, :totalAmount)
      `,
      draft.contract,
    );

    for (const line of draft.lines) {
      await insertPrepaymentLine(line, connection);
    }
  });

  return draft.contract;
}

export async function getPrepaymentContract(contractNo: string) {
  const contracts = await queryRows<Row>(
    `
      SELECT
        contractNo,
        status,
        currency,
        DATE_FORMAT(effectiveDate, '%Y-%m-%d') AS effectiveDate,
        totalAmount,
        confirmedAt,
        createdAt,
        updatedAt
      FROM prepaymentcontracts
      WHERE contractNo = :contractNo
      LIMIT 1
    `,
    { contractNo },
  );
  const contract = contracts[0] ?? null;
  const lines = contract
    ? await queryRows<PrepaymentLineRow>(
        `
          SELECT
            contractItem.id,
            contractItem.contractNo,
            contractItem.lineType,
            contractItem.requestType,
            contractItem.purchaseOrderItemId,
            contractItem.requestItemId,
            contractItem.countryCode,
            contractItem.batchName,
            contractItem.requestNo,
            contractItem.poNo,
            contractItem.deviceCode,
            contractItem.modelCode,
            contractItem.nameEn AS nameEn,
            COALESCE(NULLIF(contractItem.supplierId, ''), ri.supplierId) AS supplierId,
            COALESCE(NULLIF(contractItem.undertakingUnitId, ''), ri.undertakingUnitId) AS undertakingUnitId,
            COALESCE(NULLIF(contractItem.customerId, ''), ri.customerId) AS customerId,
            contractItem.quantity,
            contractItem.actualCurrency,
            contractItem.actualUnitPrice,
            contractItem.actualTotalAmount,
            contractItem.contractCurrency,
            contractItem.contractUnitPrice,
            contractItem.contractTotalAmount,
            DATE_FORMAT(contractItem.writeOffStartMonth, '%Y-%m-%d') AS writeOffStartMonth,
            contractItem.feeName,
            contractItem.feeDescription
          FROM prepaymentcontractitems AS contractItem
          LEFT JOIN requestitems AS ri ON ri.id = contractItem.requestItemId
          WHERE contractItem.contractNo = :contractNo
          ORDER BY
            CASE WHEN TRIM(COALESCE(contractItem.batchName, '')) REGEXP '^[A-Za-z]+[[:space:]]*-[[:space:]]*[0-9]+$' THEN 0 ELSE 1 END,
            CAST(SUBSTRING_INDEX(TRIM(contractItem.batchName), '-', -1) AS UNSIGNED) DESC,
            UPPER(TRIM(SUBSTRING_INDEX(TRIM(contractItem.batchName), '-', 1))) ASC,
            contractItem.countryCode ASC,
            contractItem.id
        `,
        { contractNo },
      )
    : [];

  return { contract, lines };
}

export async function updatePrepaymentDraft({
  contractNo,
  effectiveDate,
  lines,
}: {
  contractNo: string;
  effectiveDate: string;
  lines: PrepaymentContractLineDraft[];
}) {
  const { contract } = await getPrepaymentContract(contractNo);
  if (!contract) throw new Error("预付款合同不存在");
  if (String(contract.status) !== "草稿") throw new Error("已确认的预付款合同不可修改");

  const normalizedLines = lines.map((line, index) => ({
    ...line,
    id: line.id || `PPCI-${contractNo}-${String(index + 1).padStart(3, "0")}`,
    contractNo,
    writeOffStartMonth: firstDayOfMonth(line.writeOffStartMonth || effectiveDate),
    contractTotalAmount: Number(line.contractTotalAmount ?? 0),
    contractUnitPrice: Number(line.contractUnitPrice ?? 0),
  }));
  await assertPrepaymentInstanceOwnership(normalizedLines);
  const totalAmount = roundMoney(
    normalizedLines.reduce((total, line) => total + Number(line.contractTotalAmount ?? 0), 0),
  );
  const currency = normalizedLines[0]?.contractCurrency ?? String(contract.currency ?? "USD");

  await withTransaction(async (connection) => {
    await executeInTransaction(
      connection,
      `
        UPDATE prepaymentcontracts
        SET effectiveDate = :effectiveDate,
            currency = :currency,
            totalAmount = :totalAmount
        WHERE contractNo = :contractNo
      `,
      { contractNo, effectiveDate: firstDayOfMonth(effectiveDate), currency, totalAmount },
    );
    await executeInTransaction(
      connection,
      "DELETE FROM prepaymentcontractitems WHERE contractNo = :contractNo",
      { contractNo },
    );
    for (const line of normalizedLines) {
      await insertPrepaymentLine(line, connection);
    }
  });

  return getPrepaymentContract(contractNo);
}

export async function deletePrepaymentDraft(contractNo: string) {
  const { contract } = await getPrepaymentContract(contractNo);
  if (!contract) return;
  if (String(contract.status) !== "草稿") throw new Error("已确认的预付款合同不可删除");

  await execute("DELETE FROM prepaymentcontractitems WHERE contractNo = :contractNo", { contractNo });
  await execute("DELETE FROM prepaymentcontracts WHERE contractNo = :contractNo", { contractNo });
}

export async function confirmPrepaymentContract(contractNo: string) {
  const { contract, lines } = await getPrepaymentContract(contractNo);
  if (!contract) throw new Error("预付款合同不存在");
  if (String(contract.status) === "已确认") return getPrepaymentContract(contractNo);
  if (!lines.length) throw new Error("预付款合同明细不能为空");
  await assertPrepaymentInstanceOwnership(lines);

  const writeOffRows = buildMonthlyWriteOffRows(lines as MonthlyWriteOffSourceLine[]);
  await execute("DELETE FROM monthlyprepaymentwriteoffs WHERE contractNo = :contractNo", { contractNo });
  for (const row of writeOffRows) {
    await execute(
      `
        INSERT INTO monthlyprepaymentwriteoffs
          (id, contractNo, contractLineId, writeOffMonth, monthIndex, totalMonths, currency,
           originalAmount, monthlyAmount, lineType, requestType, countryCode, batchName, requestNo, poNo, deviceCode,
           modelCode, nameEn, supplierId, undertakingUnitId, customerId, quantity)
        VALUES
          (:id, :contractNo, :contractLineId, :writeOffMonth, :monthIndex, :totalMonths, :currency,
           :originalAmount, :monthlyAmount, :lineType, :requestType, :countryCode, :batchName, :requestNo, :poNo, :deviceCode,
           :modelCode, :nameEn, :supplierId, :undertakingUnitId, :customerId, :quantity)
      `,
      row,
    );
  }
  await execute(
    `
      UPDATE prepaymentcontracts
      SET status = '已确认',
          confirmedAt = CURRENT_TIMESTAMP
      WHERE contractNo = :contractNo
    `,
    { contractNo },
  );

  return getPrepaymentContract(contractNo);
}

export async function rollbackPrepaymentContract(contractNo: string) {
  const { contract } = await getPrepaymentContract(contractNo);
  if (!contract) throw new Error("预付款合同不存在");
  throw new Error("已确认的预付款合同不能删除或退回；如需更正，请通过预付款核销调整单处理");
}

export async function assertPrepaymentInstanceOwnership(lines: Array<Pick<PrepaymentContractLineDraft, "contractNo" | "lineType" | "purchaseOrderItemId">>) {
  const instanceLines = lines.filter((line) => line.lineType === "instance");
  const sourceContractByPurchaseItemId = new Map<string, string>();
  for (const line of instanceLines) {
    const purchaseOrderItemId = String(line.purchaseOrderItemId ?? "").trim();
    const contractNo = String(line.contractNo ?? "").trim();
    if (!purchaseOrderItemId) throw new Error("实例明细必须关联采购明细ID，不能重复占用预付款实例");
    const previousContractNo = sourceContractByPurchaseItemId.get(purchaseOrderItemId);
    if (previousContractNo && previousContractNo !== contractNo) {
      throw new Error(`采购明细 ${purchaseOrderItemId} 同时被导入到预付款合同 ${previousContractNo} 和 ${contractNo}`);
    }
    sourceContractByPurchaseItemId.set(purchaseOrderItemId, contractNo);
  }
  const purchaseOrderItemIds = Array.from(sourceContractByPurchaseItemId.keys());
  if (!purchaseOrderItemIds.length) return;

  const occupiedRows = await queryRows<{ purchaseOrderItemId: string; contractNo: string }>(
    `
      SELECT pci.purchaseOrderItemId, pci.contractNo
      FROM prepaymentcontractitems pci
      INNER JOIN prepaymentcontracts pc ON pc.contractNo = pci.contractNo
      WHERE pci.purchaseOrderItemId IN (:purchaseOrderItemIds)
        AND pc.status IN ('草稿', '已确认')
    `,
    { purchaseOrderItemIds },
  );
  const conflict = occupiedRows.find((row) =>
    String(row.contractNo) !== sourceContractByPurchaseItemId.get(String(row.purchaseOrderItemId)),
  );
  if (conflict) {
    throw new Error(`采购明细 ${conflict.purchaseOrderItemId} 已被预付款合同 ${conflict.contractNo} 占用，不能重复生成`);
  }
}

export async function listMonthlyPrepaymentWriteOffs(searchParams: URLSearchParams) {
  const keyword = searchParams.get("keyword")?.trim();
  const countryCode = searchParams.get("countryCode")?.trim();
  const batchName = searchParams.get("batchName")?.trim();
  const requestType = searchParams.get("requestType")?.trim();
  const startMonth = searchParams.get("startMonth")?.trim();
  const endMonth = searchParams.get("endMonth")?.trim();
  const exportAll = searchParams.get("export") === "1";
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = normalizePageSize(Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  const whereParts: string[] = [];
  const params: Row = {};
  const filterExpressions: Record<string, string> = {
    writeOffMonth: formatTableDateExpression("mpw.writeOffMonth"), contractNo: "mpw.contractNo", countryCode: "mpw.countryCode", batchName: "mpw.batchName",
    requestNo: "mpw.requestNo", poNo: "mpw.poNo", deviceCode: "mpw.deviceCode", requestType: "mpw.requestType", modelCode: "mpw.modelCode",
    nameEn: "mpw.nameEn", quantity: "mpw.quantity", currency: "mpw.currency", originalAmount: "mpw.originalAmount", monthlyAmount: "mpw.monthlyAmount",
    lineType: "mpw.lineType", sourceType: "mpw.sourceType", adjustmentNo: "mpw.adjustmentNo",
  };
  for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(whereParts, params, expression, field, searchParams, "monthlyPrepayment");

  if (keyword) {
    whereParts.push(
      `(mpw.contractNo LIKE :keyword OR mpw.countryCode LIKE :keyword OR mpw.batchName LIKE :keyword OR mpw.requestNo LIKE :keyword OR mpw.poNo LIKE :keyword OR mpw.deviceCode LIKE :keyword OR mpw.nameEn LIKE :keyword)`,
    );
    params.keyword = `%${keyword}%`;
  }
  if (countryCode) {
    whereParts.push("mpw.countryCode = :countryCode");
    params.countryCode = countryCode;
  }
  if (batchName) {
    whereParts.push("mpw.batchName = :batchName");
    params.batchName = batchName;
  }
  if (requestType) {
    whereParts.push("mpw.requestType = :requestType");
    params.requestType = requestType;
  }
  if (startMonth) {
    whereParts.push("mpw.writeOffMonth >= :startMonth");
    params.startMonth = firstDayOfMonth(startMonth);
  }
  if (endMonth) {
    whereParts.push("mpw.writeOffMonth <= :endMonth");
    params.endMonth = firstDayOfMonth(endMonth);
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const [{ total, totalAmount }] = await queryRows<{ total: number; totalAmount: number }>(
    `
      SELECT COUNT(*) AS total, COALESCE(SUM(mpw.monthlyAmount), 0) AS totalAmount
      FROM monthlyprepaymentwriteoffs AS mpw
      ${where}
    `,
    params,
  );
  const normalizedTotal = Number(total ?? 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / pageSize));
  const page = Math.min(requestedPage, totalPages);
  if (!exportAll) {
    params.limit = pageSize;
    params.offset = (page - 1) * pageSize;
  }
  const rows = await queryRows<Row>(
    `
      SELECT
        mpw.id,
        mpw.contractNo,
        mpw.contractLineId,
        DATE_FORMAT(mpw.writeOffMonth, '%Y-%m-%d') AS writeOffMonth,
        mpw.monthIndex,
        mpw.totalMonths,
        mpw.currency,
        mpw.originalAmount,
        mpw.monthlyAmount,
        mpw.lineType,
        mpw.countryCode,
        mpw.batchName,
        mpw.requestNo,
        mpw.poNo,
        purchaseItem.purchaseOrderId,
        mpw.deviceCode,
        mpw.requestType,
        mpw.modelCode,
        mpw.nameEn,
        COALESCE(NULLIF(mpw.supplierId, ''), ri.linkedSupplierId, riByBusinessKey.fallbackSupplierId) AS supplierId,
        COALESCE(NULLIF(mpw.undertakingUnitId, ''), ri.linkedUndertakingUnitId, riByBusinessKey.fallbackUndertakingUnitId) AS undertakingUnitId,
        COALESCE(NULLIF(mpw.customerId, ''), ri.linkedCustomerId, riByBusinessKey.fallbackCustomerId) AS customerId,
        mpw.quantity,
        mpw.sourceType,
        mpw.adjustmentNo,
        DATE_FORMAT(mpw.createdAt, '%Y-%m-%d') AS createdAt,
        DATE_FORMAT(mpw.updatedAt, '%Y-%m-%d') AS updatedAt
      FROM monthlyprepaymentwriteoffs AS mpw
      LEFT JOIN (
        SELECT id AS linkedContractLineId, requestItemId AS linkedRequestItemId, purchaseOrderItemId AS linkedPurchaseOrderItemId
        FROM prepaymentcontractitems
      ) AS contractItem ON contractItem.linkedContractLineId = mpw.contractLineId
      LEFT JOIN purchaseorderitems AS purchaseItem ON purchaseItem.id = contractItem.linkedPurchaseOrderItemId
      LEFT JOIN (
        SELECT id AS linkedRequestItemId, supplierId AS linkedSupplierId, undertakingUnitId AS linkedUndertakingUnitId, customerId AS linkedCustomerId
        FROM requestitems
      ) AS ri ON ri.linkedRequestItemId = contractItem.linkedRequestItemId
      LEFT JOIN (
        SELECT requestNo AS keyRequestNo, deviceCode AS keyDeviceCode, supplierId AS fallbackSupplierId, undertakingUnitId AS fallbackUndertakingUnitId, customerId AS fallbackCustomerId
        FROM requestitems
      ) AS riByBusinessKey
        ON riByBusinessKey.keyRequestNo = mpw.requestNo
        AND riByBusinessKey.keyDeviceCode = mpw.deviceCode
      ${where}
      ${getTableSort(searchParams, filterExpressions) || "ORDER BY mpw.writeOffMonth DESC, mpw.contractNo, mpw.contractLineId"}
      ${exportAll ? "" : "LIMIT :limit OFFSET :offset"}
    `,
    params,
  );

  return {
    rows: await attachPartyCodes(rows),
    total: normalizedTotal,
    totalAmount: Number(totalAmount ?? 0),
    page: exportAll ? 1 : page,
    pageSize,
    totalPages,
  };
}

export async function listMonthlyPrepaymentWriteOffFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    writeOffMonth: formatTableDateExpression("writeOffMonth"), contractNo: "contractNo", countryCode: "countryCode", batchName: "batchName", requestNo: "requestNo",
    poNo: "poNo", deviceCode: "deviceCode", requestType: "requestType", modelCode: "modelCode", nameEn: "nameEn", quantity: "quantity",
    currency: "currency", originalAmount: "originalAmount", monthlyAmount: "monthlyAmount", lineType: "lineType", sourceType: "sourceType", adjustmentNo: "adjustmentNo",
  };
  const field = searchParams.get("field")?.trim() ?? "";
  const expression = expressions[field];
  if (!expression) return { options: [] as Array<{ value: string; count: number }> };
  const params: Row = {};
  const where = [`${expression} IS NOT NULL`, `TRIM(CAST(${expression} AS CHAR)) <> ''`];
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  if (keyword) { where.push(`${expression} LIKE :optionKeyword`); params.optionKeyword = `%${keyword}%`; }
  appendTableFilterOptionConditions(where, params, expressions, searchParams, field);
  const rows = await queryRows<{ value: string; count: number }>(`SELECT ${expression} AS value, COUNT(*) AS count FROM monthlyprepaymentwriteoffs WHERE ${where.join(" AND ")} GROUP BY ${expression} ORDER BY value LIMIT 500`, params);
  return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
}

async function insertPrepaymentLine(
  line: PrepaymentContractLineDraft,
  connection?: PoolConnection,
) {
  const storageLine = toPrepaymentContractLineStorage(line);
  const sql =
    `
      INSERT INTO prepaymentcontractitems
        (id, contractNo, lineType, purchaseOrderItemId, requestItemId, countryCode, batchName, requestNo, poNo,
         requestType, deviceCode, modelCode, nameEn, supplierId, undertakingUnitId, customerId, quantity, actualCurrency, actualUnitPrice, actualTotalAmount,
         contractCurrency, contractUnitPrice, contractTotalAmount, writeOffStartMonth, feeName, feeDescription,
         prepaymentAmount, currency)
      VALUES
        (:id, :contractNo, :lineType, :purchaseOrderItemId, :requestItemId, :countryCode, :batchName, :requestNo, :poNo,
        :requestType, :deviceCode, :modelCode, :nameEn, :supplierId, :undertakingUnitId, :customerId, :quantity, :actualCurrency, :actualUnitPrice, :actualTotalAmount,
         :contractCurrency, :contractUnitPrice, :contractTotalAmount, :writeOffStartMonth, :feeName, :feeDescription,
         :contractTotalAmount, :contractCurrency)
    `;

  if (connection) {
    await executeInTransaction(connection, sql, storageLine);
    return;
  }
  await execute(sql, storageLine);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
