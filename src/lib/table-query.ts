import { queryRows, type Row } from "./db";

export type TableFilterOption = { value: string; count: number };

/** Keep date and datetime filter values in the same YYYY-MM-DD format as the UI. */
export function formatTableDateExpression(expression: string) {
  return `DATE_FORMAT(${expression}, '%Y-%m-%d')`;
}

export function withDateOnlyExpressions(
  expressions: Record<string, string>,
  dateFields: readonly string[],
) {
  const dateFieldSet = new Set(dateFields);
  return Object.fromEntries(
    Object.entries(expressions).map(([field, expression]) => [
      field,
      dateFieldSet.has(field) ? formatTableDateExpression(expression) : expression,
    ]),
  ) as Record<string, string>;
}

export function getTableFilterValues(searchParams: URLSearchParams, field: string, queryPrefix = "filter") {
  return Array.from(new Set(searchParams.getAll(`${queryPrefix}.${field}`).map((value) => value.trim()).filter(Boolean)));
}

export function appendTableInFilter(
  conditions: string[],
  params: Row,
  expression: string,
  field: string,
  searchParams: URLSearchParams,
  paramPrefix = "filter",
  queryPrefix = "filter",
) {
  const values = getTableFilterValues(searchParams, field, queryPrefix);
  if (!values.length) return;
  const name = `${paramPrefix}_${field.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  params[name] = values;
  conditions.push(`${expression} IN (:${name})`);
}

export function getTableSort(searchParams: URLSearchParams, expressions: Record<string, string>) {
  const field = searchParams.get("sortField")?.trim() ?? "";
  const direction = searchParams.get("sortOrder") === "asc" ? "ASC" : searchParams.get("sortOrder") === "desc" ? "DESC" : "";
  if (field && direction && expressions[field]) {
    return `ORDER BY ${isBatchField(field) ? getNaturalBatchSort(expressions[field], direction) : `${expressions[field]} ${direction}`}`;
  }
  return "";
}

export function getNaturalBatchSort(expression: string, direction: "ASC" | "DESC" = "DESC", tieBreaker = "") {
  const suffixDirection = direction;
  const prefixDirection = direction === "ASC" ? "ASC" : "DESC";
  return `
    CASE WHEN TRIM(COALESCE(${expression}, '')) REGEXP '^[A-Za-z]+[[:space:]]*-[[:space:]]*[0-9]+$' THEN 0 ELSE 1 END ASC,
    UPPER(TRIM(SUBSTRING_INDEX(TRIM(COALESCE(${expression}, '')), '-', 1))) ${prefixDirection},
    CAST(SUBSTRING_INDEX(TRIM(COALESCE(${expression}, '')), '-', -1) AS UNSIGNED) ${suffixDirection}${tieBreaker ? `, ${tieBreaker}` : ""}
  `;
}

function isBatchField(field: string) {
  return field === "batchName" || field === "batchNo" || field === "batch";
}

export function getTableFilterOptionsOrderBy(field: string, expression: string) {
  return isBatchField(field)
    ? getNaturalBatchSort(expression, "ASC", "value ASC")
    : "value ASC";
}

export function appendTableFilterOptionConditions(
  where: string[],
  params: Row,
  expressions: Record<string, string>,
  searchParams: URLSearchParams,
  currentField: string,
  paramPrefix = "tableOptionFilter",
  queryPrefix = "filter",
) {
  for (const [field, expression] of Object.entries(expressions)) {
    if (field === currentField) continue;
    const values = getTableFilterValues(searchParams, field, queryPrefix);
    if (!values.length) continue;
    const name = `${paramPrefix}_${field.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    where.push(`${expression} IN (:${name})`);
    params[name] = values;
  }
}

/**
 * Returns distinct values from the same database-side candidate set used by a
 * list. The expression map is owned by the service, so request parameters can
 * never become SQL identifiers.
 */
export async function listSqlFilterOptions({
  from,
  expressions,
  searchParams,
  conditions = [],
  params = {},
  queryPrefix = "filter",
}: {
  from: string;
  expressions: Record<string, string>;
  searchParams: URLSearchParams;
  conditions?: string[];
  params?: Row;
  queryPrefix?: string;
}): Promise<{ options: TableFilterOption[] }> {
  const field = searchParams.get("field")?.trim() ?? "";
  const expression = expressions[field];
  if (!expression) return { options: [] };

  const where = [...conditions, `${expression} IS NOT NULL`, `TRIM(CAST(${expression} AS CHAR)) <> ''`];
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const optionParams: Row = { ...params };
  if (keyword) {
    where.push(`${expression} LIKE :tableOptionKeyword`);
    optionParams.tableOptionKeyword = `%${keyword}%`;
  }

  // Candidate values are calculated from the same result set as the table.
  // A different column narrows this set with AND semantics; values selected
  // in the current column are intentionally excluded so they can be changed.
  appendTableFilterOptionConditions(where, optionParams, expressions, searchParams, field, "tableOptionFilter", queryPrefix);

  const rows = await queryRows<{ value: string; count: number }>(
    `SELECT ${expression} AS value, COUNT(*) AS count FROM ${from}
     WHERE ${where.join(" AND ")}
     GROUP BY ${expression}
     ORDER BY ${getTableFilterOptionsOrderBy(field, expression)}
     LIMIT 500`,
    optionParams,
  );
  return { options: rows.map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) })) };
}
