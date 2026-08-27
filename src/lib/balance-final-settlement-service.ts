import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { execute, executeInTransaction, queryRows, queryRowsInTransaction, type Row, withTransaction } from "./db";
import { appendTableInFilter, formatTableDateExpression, getTableSort, listSqlFilterOptions } from "./table-query";

const DRAFT = "\u8349\u7a3f";
const CONFIRMED = "\u5df2\u786e\u8ba4";
const VOIDED = "\u5df2\u4f5c\u5e9f";

type SourceRow = Row & {
  settlementNo: string;
  title: string | null;
  countryCode: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  itemCount: number | string;
  capexDifferenceTotal: number | string;
  opexDifferenceTotal: number | string;
  differenceTotal: number | string;
  itemTypes: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function nextFinalSettlementNo() {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `JJS-${day}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function buildInParams(values: string[]) {
  const params: Row = {};
  const placeholders = values.map((value, index) => {
    const key = `sourceNo${index}`;
    params[key] = value;
    return `:${key}`;
  });
  return { params, placeholders: placeholders.join(", ") };
}

function validateScope(countryCode: unknown, currency: unknown, periodStart: unknown, periodEnd: unknown) {
  const country = requiredText(countryCode, "\u56fd\u5bb6");
  const settlementCurrency = requiredText(currency, "\u7ed3\u7b97\u5e01\u79cd").toUpperCase();
  const start = requiredText(dateValue(periodStart), "\u7ed3\u5dee\u671f\u95f4\u5f00\u59cb");
  const end = requiredText(dateValue(periodEnd), "\u7ed3\u5dee\u671f\u95f4\u7ed3\u675f");
  if (start > end) throw new Error("\u7ed3\u5dee\u671f\u95f4\u5f00\u59cb\u65e5\u4e0d\u80fd\u665a\u4e8e\u7ed3\u675f\u65e5");
  return { country, settlementCurrency, start, end };
}

function buildAvailableSourceQuery({
  countryCode,
  currency,
  periodStart,
  periodEnd,
  settlementNos,
  searchParams,
}: {
  countryCode: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  settlementNos?: string[];
  searchParams?: URLSearchParams;
}) {
  const params: Row = { confirmed: CONFIRMED, voided: VOIDED, countryCode, currency, periodStart, periodEnd };
  const conditions = [
    "source.status = :confirmed",
    "source.countryCode = :countryCode",
    "source.currency = :currency",
    "source.periodStart = :periodStart",
    "source.periodEnd = :periodEnd",
    `NOT EXISTS (
      SELECT 1 FROM balancesettlementfinalsources reserved
      INNER JOIN balancesettlementfinals finalSettlement ON finalSettlement.finalSettlementNo = reserved.finalSettlementNo
      WHERE reserved.sourceSettlementNo = source.settlementNo AND finalSettlement.status <> :voided
    )`,
  ];
  if (settlementNos?.length) {
    const selected = buildInParams(settlementNos);
    Object.assign(params, selected.params);
    conditions.push(`source.settlementNo IN (${selected.placeholders})`);
  }
  const filterExpressions: Record<string, string> = {
    settlementNo: "source.settlementNo", title: "source.title", itemTypes: "(SELECT GROUP_CONCAT(DISTINCT itemType ORDER BY itemType SEPARATOR ', ') FROM balancesettlementitems itemFilter WHERE itemFilter.settlementNo = source.settlementNo)", countryCode: "source.countryCode", currency: "source.currency", periodStart: formatTableDateExpression("source.periodStart"), periodEnd: formatTableDateExpression("source.periodEnd"),
    itemCount: "source.itemCount", capexDifferenceTotal: "source.capexDifferenceTotal", opexDifferenceTotal: "source.opexDifferenceTotal", differenceTotal: "source.differenceTotal",
  };
  if (searchParams) for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(conditions, params, expression, field, searchParams, "balanceSource");
  return { params, conditions, filterExpressions };
}

async function findAvailableSources({
  countryCode,
  currency,
  periodStart,
  periodEnd,
  settlementNos,
  connection,
  page,
  pageSize,
  searchParams,
}: {
  countryCode: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  settlementNos?: string[];
  connection?: PoolConnection;
  page?: number;
  pageSize?: number;
  searchParams?: URLSearchParams;
}) {
  const { params, conditions, filterExpressions } = buildAvailableSourceQuery({ countryCode, currency, periodStart, periodEnd, settlementNos, searchParams });
  const sql =
    `
      SELECT source.settlementNo, source.title, source.countryCode, source.currency, source.periodStart, source.periodEnd,
             source.itemCount, source.capexDifferenceTotal, source.opexDifferenceTotal, source.differenceTotal,
             GROUP_CONCAT(DISTINCT NULLIF(item.itemType, '') ORDER BY item.itemType SEPARATOR ', ') AS itemTypes
      FROM balancesettlements source
      LEFT JOIN balancesettlementitems item ON item.settlementNo = source.settlementNo
      WHERE ${conditions.join(" AND ")}
      GROUP BY source.settlementNo, source.title, source.countryCode, source.currency, source.periodStart, source.periodEnd,
               source.itemCount, source.capexDifferenceTotal, source.opexDifferenceTotal, source.differenceTotal
      ${searchParams ? (getTableSort(searchParams, filterExpressions) || "ORDER BY source.confirmedAt DESC, source.createdAt DESC") : "ORDER BY source.confirmedAt DESC, source.createdAt DESC"}
      ${page && pageSize ? "LIMIT :limit OFFSET :offset" : ""}
    `;
  if (page && pageSize) {
    params.limit = pageSize;
    params.offset = (page - 1) * pageSize;
  }
  return connection
    ? queryRowsInTransaction<SourceRow>(connection, sql, params)
    : queryRows<SourceRow>(sql, params);
}

export async function listAvailableFinalSettlementSources(input: {
  countryCode?: string;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  page?: number;
  pageSize?: number;
  searchParams?: URLSearchParams;
}) {
  const scope = validateScope(input.countryCode, input.currency, input.periodStart, input.periodEnd);
  const pageSize = Math.min(100, Math.max(1, Math.floor(numberValue(input.pageSize ?? 20))));
  const countQuery = buildAvailableSourceQuery({ countryCode: scope.country, currency: scope.settlementCurrency, periodStart: scope.start, periodEnd: scope.end, searchParams: input.searchParams });
  const [{ total: totalValue }] = await queryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM balancesettlements source WHERE ${countQuery.conditions.join(" AND ")}`,
    countQuery.params,
  );
  const total = Number(totalValue ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(numberValue(input.page ?? 1))), totalPages);
  const rows = await findAvailableSources({
    countryCode: scope.country,
    currency: scope.settlementCurrency,
    periodStart: scope.start,
    periodEnd: scope.end,
    page,
    pageSize,
    searchParams: input.searchParams,
  });
  return { rows, total, page, pageSize, totalPages };
}

export async function listAvailableFinalSettlementSourceFilterOptions(input: {
  countryCode: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  searchParams: URLSearchParams;
}) {
  const scope = validateScope(input.countryCode, input.currency, input.periodStart, input.periodEnd);
  const expressions: Record<string, string> = {
    settlementNo: "source.settlementNo", title: "source.title", itemTypes: "(SELECT GROUP_CONCAT(DISTINCT itemType ORDER BY itemType SEPARATOR ', ') FROM balancesettlementitems itemFilter WHERE itemFilter.settlementNo = source.settlementNo)", countryCode: "source.countryCode", currency: "source.currency", periodStart: formatTableDateExpression("source.periodStart"), periodEnd: formatTableDateExpression("source.periodEnd"), itemCount: "source.itemCount", capexDifferenceTotal: "source.capexDifferenceTotal", opexDifferenceTotal: "source.opexDifferenceTotal", differenceTotal: "source.differenceTotal",
  };
  return listSqlFilterOptions({
    expressions,
    searchParams: input.searchParams,
    from: "balancesettlements source",
    conditions: [
      "source.status = :confirmed", "source.countryCode = :countryCode", "source.currency = :currency", "source.periodStart = :periodStart", "source.periodEnd = :periodEnd",
      "NOT EXISTS (SELECT 1 FROM balancesettlementfinalsources reserved INNER JOIN balancesettlementfinals finalSettlement ON finalSettlement.finalSettlementNo = reserved.finalSettlementNo WHERE reserved.sourceSettlementNo = source.settlementNo AND finalSettlement.status <> :voided)",
    ],
    params: { confirmed: CONFIRMED, voided: VOIDED, countryCode: scope.country, currency: scope.settlementCurrency, periodStart: scope.start, periodEnd: scope.end },
  });
}

export async function createFinalBalanceSettlement({
  title,
  countryCode,
  currency,
  periodStart,
  periodEnd,
  notes,
  sourceSettlementNos,
}: {
  title?: string;
  countryCode?: string;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string;
  sourceSettlementNos: string[];
}) {
  const scope = validateScope(countryCode, currency, periodStart, periodEnd);
  const selectedNos = [...new Set(sourceSettlementNos.map(text).filter(Boolean))];
  if (!selectedNos.length) throw new Error("\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u5f20\u5df2\u786e\u8ba4\u7684\u7ed3\u5dee\u6765\u6e90\u5355");
  const finalSettlementNo = nextFinalSettlementNo();
  await withTransaction(async (connection) => {
    // Lock the selected source masters first. Concurrent draft creation then serializes on the same source rows.
    const selected = buildInParams(selectedNos);
    await queryRowsInTransaction<Row>(
      connection,
      `SELECT settlementNo FROM balancesettlements WHERE settlementNo IN (${selected.placeholders}) FOR UPDATE`,
      selected.params,
    );
    const sources = await findAvailableSources({
      countryCode: scope.country,
      currency: scope.settlementCurrency,
      periodStart: scope.start,
      periodEnd: scope.end,
      settlementNos: selectedNos,
      connection,
    });
    if (sources.length !== selectedNos.length) {
      throw new Error("\u90e8\u5206\u6765\u6e90\u5355\u672a\u786e\u8ba4\u3001\u5df2\u88ab\u7ed3\u7b97\u5355\u5f15\u7528\uff0c\u6216\u4e0e\u5f53\u524d\u56fd\u5bb6\u3001\u5e01\u79cd\u3001\u7ed3\u5dee\u671f\u95f4\u4e0d\u4e00\u81f4");
    }

    const sourceCount = sources.length;
    const itemCount = sources.reduce((sum, source) => sum + numberValue(source.itemCount), 0);
    const capexDifferenceTotal = money(sources.reduce((sum, source) => sum + numberValue(source.capexDifferenceTotal), 0));
    const opexDifferenceTotal = money(sources.reduce((sum, source) => sum + numberValue(source.opexDifferenceTotal), 0));
    const differenceTotal = money(sources.reduce((sum, source) => sum + numberValue(source.differenceTotal), 0));

    await executeInTransaction(
      connection,
      `
        INSERT INTO balancesettlementfinals
          (finalSettlementNo, title, countryCode, currency, status, periodStart, periodEnd, sourceCount, itemCount,
           capexDifferenceTotal, opexDifferenceTotal, differenceTotal, notes)
        VALUES
          (:finalSettlementNo, :title, :countryCode, :currency, :status, :periodStart, :periodEnd, :sourceCount, :itemCount,
           :capexDifferenceTotal, :opexDifferenceTotal, :differenceTotal, :notes)
      `,
      {
        finalSettlementNo,
        title: text(title) || `${scope.country} ${scope.start}\u81f3${scope.end}\u7ed3\u5dee\u7ed3\u7b97\u5355`,
        countryCode: scope.country,
        currency: scope.settlementCurrency,
        status: DRAFT,
        periodStart: scope.start,
        periodEnd: scope.end,
        sourceCount,
        itemCount,
        capexDifferenceTotal,
        opexDifferenceTotal,
        differenceTotal,
        notes: text(notes),
      },
    );

    for (const source of sources) {
      await executeInTransaction(
        connection,
        `
          INSERT INTO balancesettlementfinalsources
            (id, finalSettlementNo, sourceSettlementNo, sourceTitle, sourceItemTypes, countryCode, currency,
             periodStart, periodEnd, itemCount, capexDifferenceTotal, opexDifferenceTotal, differenceTotal, sourceSnapshotJson)
          VALUES
            (:id, :finalSettlementNo, :sourceSettlementNo, :sourceTitle, :sourceItemTypes, :countryCode, :currency,
             :periodStart, :periodEnd, :itemCount, :capexDifferenceTotal, :opexDifferenceTotal, :differenceTotal, :sourceSnapshotJson)
        `,
        {
          id: `BFS-${randomUUID()}`,
          finalSettlementNo,
          sourceSettlementNo: source.settlementNo,
          sourceTitle: source.title,
          sourceItemTypes: source.itemTypes,
          countryCode: source.countryCode,
          currency: source.currency,
          periodStart: dateValue(source.periodStart),
          periodEnd: dateValue(source.periodEnd),
          itemCount: numberValue(source.itemCount),
          capexDifferenceTotal: numberValue(source.capexDifferenceTotal),
          opexDifferenceTotal: numberValue(source.opexDifferenceTotal),
          differenceTotal: numberValue(source.differenceTotal),
          sourceSnapshotJson: JSON.stringify(source),
        },
      );
    }
  });
  return getFinalBalanceSettlement(finalSettlementNo);
}

export async function listFinalBalanceSettlements({
  countryCode = "",
  currency = "",
  status = "",
  keyword = "",
  page = 1,
  pageSize = 20,
  searchParams,
}: {
  countryCode?: string;
  currency?: string;
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  searchParams?: URLSearchParams;
}) {
  const conditions: string[] = [];
  const params: Row = {};
  if (text(countryCode)) { conditions.push("countryCode = :countryCode"); params.countryCode = text(countryCode); }
  if (text(currency)) { conditions.push("currency = :currency"); params.currency = text(currency).toUpperCase(); }
  if (text(status)) { conditions.push("status = :status"); params.status = text(status); }
  if (text(keyword)) {
    conditions.push("(finalSettlementNo LIKE :keyword OR title LIKE :keyword OR notes LIKE :keyword)");
    params.keyword = `%${text(keyword)}%`;
  }
  const filterExpressions: Record<string, string> = {
    finalSettlementNo: "finalSettlementNo", title: "title", countryCode: "countryCode", currency: "currency", periodStart: formatTableDateExpression("periodStart"), periodEnd: formatTableDateExpression("periodEnd"), status: "status", sourceCount: "sourceCount", itemCount: "itemCount", capexDifferenceTotal: "capexDifferenceTotal", opexDifferenceTotal: "opexDifferenceTotal", differenceTotal: "differenceTotal", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  if (searchParams) for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(conditions, params, expression, field, searchParams, "balanceFinal");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [{ total: totalValue }] = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM balancesettlementfinals ${where}`, params);
  const total = Number(totalValue ?? 0);
  const safePageSize = Math.min(100, Math.max(1, Math.floor(numberValue(pageSize))));
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(numberValue(page))), totalPages);
  const rows = await queryRows<Row>(
    `SELECT * FROM balancesettlementfinals ${where} ${searchParams ? (getTableSort(searchParams, filterExpressions) || "ORDER BY createdAt DESC") : "ORDER BY createdAt DESC"} LIMIT :limit OFFSET :offset`,
    { ...params, limit: safePageSize, offset: (safePage - 1) * safePageSize },
  );
  return { rows, total, page: safePage, pageSize: safePageSize, totalPages };
}

export async function listFinalBalanceSettlementFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    finalSettlementNo: "finalSettlementNo", title: "title", countryCode: "countryCode", currency: "currency", periodStart: formatTableDateExpression("periodStart"), periodEnd: formatTableDateExpression("periodEnd"), status: "status", sourceCount: "sourceCount", itemCount: "itemCount", capexDifferenceTotal: "capexDifferenceTotal", opexDifferenceTotal: "opexDifferenceTotal", differenceTotal: "differenceTotal", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  return listSqlFilterOptions({ from: "balancesettlementfinals", expressions, searchParams });
}

export async function getFinalBalanceSettlement(finalSettlementNo: string) {
  const master = (await queryRows<Row>(
    "SELECT * FROM balancesettlementfinals WHERE finalSettlementNo = :finalSettlementNo LIMIT 1",
    { finalSettlementNo },
  ))[0];
  if (!master) return null;
  const sources = await queryRows<Row>(
    `SELECT * FROM balancesettlementfinalsources WHERE finalSettlementNo = :finalSettlementNo ORDER BY createdAt ASC, sourceSettlementNo ASC`,
    { finalSettlementNo },
  );
  return { master, sources };
}

export async function confirmFinalBalanceSettlement(finalSettlementNo: string) {
  const detail = await getFinalBalanceSettlement(finalSettlementNo);
  if (!detail) throw new Error("\u7ed3\u5dee\u7ed3\u7b97\u5355\u4e0d\u5b58\u5728");
  if (text(detail.master.status) === CONFIRMED) return detail;
  if (text(detail.master.status) !== DRAFT) throw new Error("\u53ea\u6709\u8349\u7a3f\u7ed3\u7b97\u5355\u53ef\u4ee5\u786e\u8ba4");
  if (!detail.sources.length) throw new Error("\u7ed3\u5dee\u7ed3\u7b97\u5355\u81f3\u5c11\u9700\u8981\u4e00\u5f20\u6765\u6e90\u5355");
  await execute(
    "UPDATE balancesettlementfinals SET status = :status, confirmedAt = NOW() WHERE finalSettlementNo = :finalSettlementNo",
    { status: CONFIRMED, finalSettlementNo },
  );
  return getFinalBalanceSettlement(finalSettlementNo);
}

export async function voidFinalBalanceSettlement(finalSettlementNo: string) {
  const detail = await getFinalBalanceSettlement(finalSettlementNo);
  if (!detail) throw new Error("\u7ed3\u5dee\u7ed3\u7b97\u5355\u4e0d\u5b58\u5728");
  if (text(detail.master.status) === CONFIRMED) {
    throw new Error("\u5df2\u786e\u8ba4\u7ed3\u7b97\u5355\u4e0d\u53ef\u4f5c\u5e9f\uff0c\u8bf7\u4fdd\u7559\u5ba1\u8ba1\u8bb0\u5f55");
  }
  if (text(detail.master.status) === VOIDED) return detail;
  await execute(
    "UPDATE balancesettlementfinals SET status = :status WHERE finalSettlementNo = :finalSettlementNo",
    { status: VOIDED, finalSettlementNo },
  );
  return getFinalBalanceSettlement(finalSettlementNo);
}

export async function getFinalBalanceSettlementSummary({ countryCode = "" }: { countryCode?: string }) {
  return queryRows<Row>(
    `
      SELECT * FROM balancesettlementfinals
      WHERE status = :status ${text(countryCode) ? "AND countryCode = :countryCode" : ""}
      ORDER BY periodEnd DESC, confirmedAt DESC, createdAt DESC
    `,
    text(countryCode) ? { status: CONFIRMED, countryCode: text(countryCode) } : { status: CONFIRMED },
  );
}
