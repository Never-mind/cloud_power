import { execute, queryRows, type Row } from "./db";
import { firstDayOfMonth } from "./prepayment-workflow";
import { appendTableFilterOptionConditions, appendTableInFilter, getTableFilterOptionsOrderBy, getTableSort } from "./table-query";
import {
  buildPrepaymentWriteOffAdjustmentItems,
  type PrepaymentMonthlyWriteOffForAdjustment,
  type PrepaymentWriteOffAdjustmentItemDraft,
} from "./prepayment-adjustment-workflow";

export type PrepaymentAdjustmentPayload = {
  adjustmentNo: string;
  reason?: string;
  monthlyWriteOffIds: string[];
  adjustedAmounts: Record<string, number | string>;
};

export async function listAvailablePrepaymentWriteOffs(searchParams: URLSearchParams) {
  const { where, params } = buildMonthlyWhere(searchParams);
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get("pageSize") ?? 20) || 20)));
  const [{ total: totalValue }] = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM monthlyprepaymentwriteoffs ${where}`, params);
  const total = Number(totalValue ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await queryRows<Row>(
    `
      SELECT
        id,
        contractNo,
        contractLineId,
        DATE_FORMAT(writeOffMonth, '%Y-%m-%d') AS writeOffMonth,
        monthIndex,
        totalMonths,
        currency,
        originalAmount,
        monthlyAmount,
        lineType,
        countryCode,
        batchName,
        requestNo,
        poNo,
        deviceCode,
        modelCode,
        nameEn,
        quantity,
        sourceType,
        adjustmentNo
      FROM monthlyprepaymentwriteoffs
      ${where}
      ORDER BY writeOffMonth DESC, contractNo, contractLineId
      LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: pageSize, offset: (page - 1) * pageSize },
  );

  return { rows, total, page, pageSize, totalPages };
}

export async function listPrepaymentWriteOffAdjustments(searchParams: URLSearchParams) {
  const keyword = searchParams.get("keyword")?.trim();
  const status = searchParams.get("status")?.trim();
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page") ?? 1) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get("pageSize") ?? 20) || 20)));
  const whereParts: string[] = [];
  const params: Row = {};
  const filterExpressions: Record<string, string> = {
    adjustmentNo: "adjustmentNo", status: "status", countryCode: "countryCode", batchName: "batchName", contractNo: "contractNo", itemCount: "itemCount", differenceTotal: "differenceTotal", reason: "reason",
  };
  for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(whereParts, params, expression, field, searchParams, "prepaymentAdjustment");

  if (keyword) {
    whereParts.push(
      "(adjustmentNo LIKE :keyword OR contractNo LIKE :keyword OR batchName LIKE :keyword OR reason LIKE :keyword)",
    );
    params.keyword = `%${keyword}%`;
  }
  if (status) {
    whereParts.push("status = :status");
    params.status = status;
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const [{ total: totalValue }] = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM prepaymentwriteoffadjustments ${where}`, params);
  const total = Number(totalValue ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await queryRows<Row>(
    `
      SELECT
        adjustmentNo,
        status,
        countryCode,
        batchName,
        contractNo,
        itemCount,
        differenceTotal,
        reason,
        confirmedAt,
        createdAt,
        updatedAt
      FROM prepaymentwriteoffadjustments
      ${where}
      ${getTableSort(searchParams, filterExpressions) || "ORDER BY createdAt DESC"}
      LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: pageSize, offset: (page - 1) * pageSize },
  );

  return { rows, total, page, pageSize, totalPages };
}

export async function listPrepaymentAdjustmentFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    adjustmentNo: "adjustmentNo", status: "status", countryCode: "countryCode", batchName: "batchName", contractNo: "contractNo", itemCount: "itemCount", differenceTotal: "differenceTotal", reason: "reason",
  };
  const field = searchParams.get("field")?.trim() ?? "";
  const expression = expressions[field];
  if (!expression) return { options: [] as Array<{ value: string; count: number }> };
  const params: Row = {};
  const where = [`${expression} IS NOT NULL`, `TRIM(CAST(${expression} AS CHAR)) <> ''`];
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  if (keyword) { where.push(`${expression} LIKE :optionKeyword`); params.optionKeyword = `%${keyword}%`; }
  appendTableFilterOptionConditions(where, params, expressions, searchParams, field);
  const rows = await queryRows<{ value: string; count: number }>(`SELECT ${expression} AS value, COUNT(*) AS count FROM prepaymentwriteoffadjustments WHERE ${where.join(" AND ")} GROUP BY ${expression} ORDER BY ${getTableFilterOptionsOrderBy(field, expression)} LIMIT 500`, params);
  return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
}

export async function getPrepaymentWriteOffAdjustment(adjustmentNo: string) {
  const rows = await queryRows<Row>(
    `
      SELECT
        adjustmentNo,
        status,
        countryCode,
        batchName,
        contractNo,
        itemCount,
        differenceTotal,
        reason,
        confirmedAt,
        createdAt,
        updatedAt
      FROM prepaymentwriteoffadjustments
      WHERE adjustmentNo = :adjustmentNo
      LIMIT 1
    `,
    { adjustmentNo },
  );
  const adjustment = rows[0] ?? null;
  const items = adjustment
    ? await queryRows<Row>(
        `
          SELECT
            id,
            adjustmentNo,
            monthlyWriteOffId,
            contractNo,
            contractLineId,
            DATE_FORMAT(writeOffMonth, '%Y-%m-%d') AS writeOffMonth,
            countryCode,
            batchName,
            requestNo,
            poNo,
            deviceCode,
            modelCode,
            nameEn,
            quantity,
            currency,
            originalMonthlyAmount,
            adjustedMonthlyAmount,
            differenceAmount,
            DATE_FORMAT(createdAt, '%Y-%m-%d') AS createdAt,
            DATE_FORMAT(updatedAt, '%Y-%m-%d') AS updatedAt
          FROM prepaymentwriteoffadjustmentitems
          WHERE adjustmentNo = :adjustmentNo
          ORDER BY writeOffMonth, id
        `,
        { adjustmentNo },
      )
    : [];

  return { adjustment, items };
}

export async function savePrepaymentWriteOffAdjustment(payload: PrepaymentAdjustmentPayload) {
  const adjustmentNo = payload.adjustmentNo.trim();
  if (!adjustmentNo) throw new Error("调整单号不能为空");
  if (!payload.monthlyWriteOffIds.length) throw new Error("请选择需要调整的预付款月核销明细");

  const existing = await getPrepaymentWriteOffAdjustment(adjustmentNo);
  if (existing.adjustment && String(existing.adjustment.status) === "已确认") {
    throw new Error("已确认的调整单不可修改");
  }

  const monthlyRows = await getMonthlyWriteOffRowsByIds(payload.monthlyWriteOffIds);
  if (monthlyRows.length !== payload.monthlyWriteOffIds.length) {
    throw new Error("部分预付款月核销明细不存在，请刷新后重试");
  }

  const items = buildPrepaymentWriteOffAdjustmentItems({
    adjustmentNo,
    rows: monthlyRows,
    adjustedAmounts: payload.adjustedAmounts,
  });
  const first = monthlyRows[0];
  const differenceTotal = roundMoney(items.reduce((total, item) => total + item.differenceAmount, 0));

  await execute(
    `
      INSERT INTO prepaymentwriteoffadjustments
        (adjustmentNo, status, countryCode, batchName, contractNo, itemCount, differenceTotal, reason)
      VALUES
        (:adjustmentNo, '草稿', :countryCode, :batchName, :contractNo, :itemCount, :differenceTotal, :reason)
      ON DUPLICATE KEY UPDATE
        status = '草稿',
        countryCode = VALUES(countryCode),
        batchName = VALUES(batchName),
        contractNo = VALUES(contractNo),
        itemCount = VALUES(itemCount),
        differenceTotal = VALUES(differenceTotal),
        reason = VALUES(reason)
    `,
    {
      adjustmentNo,
      countryCode: first.countryCode ?? "",
      batchName: first.batchName ?? "",
      contractNo: first.contractNo ?? "",
      itemCount: items.length,
      differenceTotal,
      reason: payload.reason ?? "",
    },
  );
  await execute("DELETE FROM prepaymentwriteoffadjustmentitems WHERE adjustmentNo = :adjustmentNo", { adjustmentNo });
  for (const item of items) {
    await insertAdjustmentItem(item);
  }

  return getPrepaymentWriteOffAdjustment(adjustmentNo);
}

export async function deletePrepaymentWriteOffAdjustment(adjustmentNo: string) {
  const { adjustment } = await getPrepaymentWriteOffAdjustment(adjustmentNo);
  if (!adjustment) return;
  if (String(adjustment.status) === "已确认") throw new Error("已确认的调整单不可删除");

  await execute("DELETE FROM prepaymentwriteoffadjustmentitems WHERE adjustmentNo = :adjustmentNo", { adjustmentNo });
  await execute("DELETE FROM prepaymentwriteoffadjustments WHERE adjustmentNo = :adjustmentNo", { adjustmentNo });
}

export async function confirmPrepaymentWriteOffAdjustment(adjustmentNo: string) {
  const { adjustment, items } = await getPrepaymentWriteOffAdjustment(adjustmentNo);
  if (!adjustment) throw new Error("调整单不存在");
  if (String(adjustment.status) === "已确认") return { adjustment, items };
  if (!items.length) throw new Error("调整单明细不能为空");

  for (const item of items) {
    await execute(
      `
        UPDATE monthlyprepaymentwriteoffs
        SET monthlyAmount = :monthlyAmount,
            sourceType = '调整单',
            adjustmentNo = :adjustmentNo
        WHERE id = :monthlyWriteOffId
      `,
      {
        monthlyAmount: Number(item.adjustedMonthlyAmount ?? 0),
        adjustmentNo,
        monthlyWriteOffId: item.monthlyWriteOffId,
      },
    );
  }

  await execute(
    `
      UPDATE prepaymentwriteoffadjustments
      SET status = '已确认',
          confirmedAt = CURRENT_TIMESTAMP
      WHERE adjustmentNo = :adjustmentNo
    `,
    { adjustmentNo },
  );

  return getPrepaymentWriteOffAdjustment(adjustmentNo);
}

function buildMonthlyWhere(searchParams: URLSearchParams) {
  const keyword = searchParams.get("keyword")?.trim();
  const startMonth = searchParams.get("startMonth")?.trim();
  const endMonth = searchParams.get("endMonth")?.trim();
  const countryCode = searchParams.get("countryCode")?.trim();
  const batchName = searchParams.get("batchName")?.trim();
  const contractNo = searchParams.get("contractNo")?.trim();
  const deviceCode = searchParams.get("deviceCode")?.trim();
  const whereParts: string[] = [];
  const params: Row = {};

  if (keyword) {
    whereParts.push(
      "(contractNo LIKE :keyword OR countryCode LIKE :keyword OR batchName LIKE :keyword OR requestNo LIKE :keyword OR poNo LIKE :keyword OR deviceCode LIKE :keyword OR nameEn LIKE :keyword)",
    );
    params.keyword = `%${keyword}%`;
  }
  if (startMonth) {
    whereParts.push("writeOffMonth >= :startMonth");
    params.startMonth = firstDayOfMonth(startMonth);
  }
  if (endMonth) {
    whereParts.push("writeOffMonth <= :endMonth");
    params.endMonth = firstDayOfMonth(endMonth);
  }
  if (countryCode) {
    whereParts.push("countryCode = :countryCode");
    params.countryCode = countryCode;
  }
  if (batchName) {
    whereParts.push("batchName = :batchName");
    params.batchName = batchName;
  }
  if (contractNo) {
    whereParts.push("contractNo = :contractNo");
    params.contractNo = contractNo;
  }
  if (deviceCode) {
    whereParts.push("deviceCode = :deviceCode");
    params.deviceCode = deviceCode;
  }

  return {
    where: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    params,
  };
}

async function getMonthlyWriteOffRowsByIds(ids: string[]) {
  const params = Object.fromEntries(ids.map((id, index) => [`id${index}`, id]));
  const placeholders = ids.map((_, index) => `:id${index}`).join(", ");

  return queryRows<PrepaymentMonthlyWriteOffForAdjustment>(
    `
      SELECT
        id,
        contractNo,
        contractLineId,
        DATE_FORMAT(writeOffMonth, '%Y-%m-%d') AS writeOffMonth,
        currency,
        monthlyAmount,
        lineType,
        countryCode,
        batchName,
        requestNo,
        poNo,
        deviceCode,
        modelCode,
        nameEn,
        quantity
      FROM monthlyprepaymentwriteoffs
      WHERE id IN (${placeholders})
    `,
    params,
  );
}

async function insertAdjustmentItem(item: PrepaymentWriteOffAdjustmentItemDraft) {
  await execute(
    `
      INSERT INTO prepaymentwriteoffadjustmentitems
        (id, adjustmentNo, monthlyWriteOffId, contractNo, contractLineId, writeOffMonth,
         countryCode, batchName, requestNo, poNo, deviceCode, modelCode, nameEn, quantity,
         currency, originalMonthlyAmount, adjustedMonthlyAmount, differenceAmount)
      VALUES
        (:id, :adjustmentNo, :monthlyWriteOffId, :contractNo, :contractLineId, :writeOffMonth,
         :countryCode, :batchName, :requestNo, :poNo, :deviceCode, :modelCode, :nameEn, :quantity,
         :currency, :originalMonthlyAmount, :adjustedMonthlyAmount, :differenceAmount)
    `,
    item,
  );
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
