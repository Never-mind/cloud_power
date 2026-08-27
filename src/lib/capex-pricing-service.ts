import { randomUUID } from "node:crypto";
import { execute, queryRows, type Row } from "./db";
import { appendTableInFilter, formatTableDateExpression, getTableSort, listSqlFilterOptions } from "./table-query";

export const CAPEX_PRICING_STATUSES = ["草稿", "已确认", "已废止"] as const;

export type CapexPricingLineInput = {
  id?: string;
  deviceCode: string;
  b6Type?: string;
  priceCurrency?: string;
  contractCurrency?: string;
  baseCapexPrice?: number;
  exchangeRate?: number;
  deviceVatRate?: number;
  serviceVatRate?: number;
  brazilServiceTaxRate?: number;
  onsiteRmaRate?: number;
  fundingAnnualRate?: number;
  fundingMonths?: number;
  transportClearanceRate?: number;
  handlingRate?: number;
  otherTaxRate?: number;
  spareOccupancyMonths?: number | null;
  overseasSpareServiceAvailable?: boolean | number | null;
  spareRate?: number | null;
  spareSettlementMethod?: string;
};

export type CapexPricingVersionInput = {
  versionNo: string;
  countryCode: string;
  effectiveDate: string;
  sourceFileName?: string;
  notes?: string;
  items?: CapexPricingLineInput[];
};

export type B6TypeConfig = {
  b6Type: string;
  alias: string;
  scope: string;
  fundingCostIncluded: boolean;
  spareCostIncluded: boolean;
  defaultFundingMonths: number | null;
  defaultSpareOccupancyMonths: number | null;
  overseasSpareServiceAvailable: boolean | null;
  defaultSpareRate: number | null;
  spareSettlementMethod: string;
  slPricingInstruction: string;
  notes: string;
  status: string;
  sortOrder: number;
};

type CapexPricingDefaults = Required<Omit<CapexPricingLineInput, "id" | "deviceCode" | "b6Type" | "spareOccupancyMonths" | "overseasSpareServiceAvailable" | "spareRate" | "spareSettlementMethod">> & {
  spareScenario: string;
  spareOccupancyMonths: number | null;
  overseasSpareServiceAvailable: boolean | null;
  spareRate: number | null;
  spareSettlementMethod: string;
  requiresFundingMonthsInput: boolean;
  b6Rule: B6TypeConfig;
  sourceHints: Record<string, string>;
};

export type CapexPricingCalculation = {
  spareScenario: string;
  fundingRatio: number;
  fundingAmount: number;
  capexTotal: number;
  ddpPrice: number;
  opexAmount: number;
  rawCapexAnchorUsd: number;
  rawOpexAnchorUsd: number;
  capexAnchorUsd: number;
  opexAnchorUsd: number;
};

const DEFAULT_EXCHANGE_RATE = 0.1476642241;

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown, fallback: number | null = null) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableBoolean(value: unknown, fallback: boolean | null = null) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  if (typeof value === "boolean") return value;
  return Number(value) !== 0;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeDate(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  return text;
}

function isBrazil(countryCode: string) {
  return countryCode.trim().toUpperCase() === "BR" || countryCode.trim() === "巴西";
}

function isMexico(countryCode: string) {
  return countryCode.trim().toUpperCase() === "MX" || countryCode.trim() === "墨西哥";
}

function isChile(countryCode: string) {
  return countryCode.trim().toUpperCase() === "CL" || countryCode.trim() === "智利";
}

function defaultScenario(b6Type: string) {
  return b6Type.trim().toUpperCase() === "B65" ? "维保服务场景" : "备件场景";
}

function toB6TypeConfig(row: Row): B6TypeConfig {
  return {
    b6Type: String(row.b6Type ?? "").trim(),
    alias: String(row.alias ?? "").trim(),
    scope: String(row.scope ?? "").trim(),
    fundingCostIncluded: Boolean(row.fundingCostIncluded),
    spareCostIncluded: Boolean(row.spareCostIncluded),
    defaultFundingMonths: nullableNumber(row.defaultFundingMonths),
    defaultSpareOccupancyMonths: nullableNumber(row.defaultSpareOccupancyMonths),
    overseasSpareServiceAvailable: nullableBoolean(row.overseasSpareServiceAvailable),
    defaultSpareRate: nullableNumber(row.defaultSpareRate),
    spareSettlementMethod: String(row.spareSettlementMethod ?? "").trim(),
    slPricingInstruction: String(row.slPricingInstruction ?? "").trim(),
    notes: String(row.notes ?? "").trim(),
    status: String(row.status ?? "").trim(),
    sortOrder: toNumber(row.sortOrder),
  };
}

export async function listCapexPricingB6Types() {
  const rows = await queryRows<Row>(
    "SELECT * FROM b6typeconfigs WHERE status = '启用' ORDER BY sortOrder ASC, b6Type ASC",
  );
  return rows.map(toB6TypeConfig);
}

async function getB6TypeConfig(b6Type: string) {
  const requestedType = requiredText(b6Type, "B6类型");
  const rows = await queryRows<Row>(
    "SELECT * FROM b6typeconfigs WHERE status = '启用' AND (b6Type = :b6Type OR alias = :b6Type) LIMIT 1",
    { b6Type: requestedType },
  );
  return rows[0] ? toB6TypeConfig(rows[0]) : null;
}

export function calculateCapexOpexPricing(input: CapexPricingLineInput & { countryCode: string }): CapexPricingCalculation {
  const baseCapexPrice = toNumber(input.baseCapexPrice);
  const exchangeRate = toNumber(input.exchangeRate);
  const fundingAnnualRate = toNumber(input.fundingAnnualRate);
  const fundingMonths = Math.max(0, Math.trunc(toNumber(input.fundingMonths)));
  const onsiteRmaRate = toNumber(input.onsiteRmaRate);
  const transportClearanceRate = toNumber(input.transportClearanceRate);
  const handlingRate = toNumber(input.handlingRate);
  const otherTaxRate = toNumber(input.otherTaxRate);
  const brazilServiceTaxRate = isBrazil(input.countryCode) ? toNumber(input.brazilServiceTaxRate) : 0;
  const fundingRatio = round((fundingAnnualRate * fundingMonths) / 12, 10);
  const fundingAmount = round(baseCapexPrice * fundingRatio);
  const capexTotal = round(baseCapexPrice * (1 + onsiteRmaRate) + fundingAmount);
  const ddpPrice = round(capexTotal * (1 + transportClearanceRate) * (1 + handlingRate + otherTaxRate));
  const opexAmount = round(ddpPrice - capexTotal);
  const rawCapexAnchorUsd = round(capexTotal * exchangeRate);
  const rawOpexAnchorUsd = round(opexAmount * exchangeRate);
  const taxFactor = 1 + brazilServiceTaxRate;

  return {
    spareScenario: String(input.spareSettlementMethod ?? "").trim() || defaultScenario(String(input.b6Type ?? "")),
    fundingRatio,
    fundingAmount,
    capexTotal,
    ddpPrice,
    opexAmount,
    rawCapexAnchorUsd,
    rawOpexAnchorUsd,
    capexAnchorUsd: round(rawCapexAnchorUsd / taxFactor),
    opexAnchorUsd: round(rawOpexAnchorUsd / taxFactor),
  };
}

export async function getCapexPricingDefaults(countryCode: string, b6Type = "B62-A7"): Promise<CapexPricingDefaults> {
  const normalizedCountryCode = requiredText(countryCode, "国家");
  const b6Rule = await getB6TypeConfig(b6Type);
  if (!b6Rule) throw new Error(`B6类型 ${b6Type} 未在B6类型规则中启用，请先维护规则。`);
  const rows = await queryRows<{ code: string; vatRate: number | null }>(
    "SELECT code, vatRate FROM countries WHERE code = :countryCode LIMIT 1",
    { countryCode: normalizedCountryCode },
  );
  const countryVatRate = toNumber(rows[0]?.vatRate);
  const brazil = isBrazil(normalizedCountryCode);
  const mexico = isMexico(normalizedCountryCode);
  const chile = isChile(normalizedCountryCode);
  const fallbackVatRate = mexico ? 0.16 : chile ? 0.19 : 0;

  return {
    priceCurrency: "CNY",
    contractCurrency: "USD",
    baseCapexPrice: 0,
    exchangeRate: DEFAULT_EXCHANGE_RATE,
    deviceVatRate: brazil ? 0 : countryVatRate || fallbackVatRate,
    serviceVatRate: brazil ? 0 : countryVatRate || fallbackVatRate,
    brazilServiceTaxRate: brazil ? 0.029 : 0,
    onsiteRmaRate: b6Rule.b6Type.trim().toUpperCase() === "B65" ? 0.0433 : 0,
    fundingAnnualRate: 0.04,
    fundingMonths: b6Rule.defaultFundingMonths ?? 0,
    transportClearanceRate: brazil ? 0.16 : 0.02,
    handlingRate: brazil ? 0.09 : 0,
    otherTaxRate: brazil ? 0.57 : 0,
    spareScenario: b6Rule.spareSettlementMethod || defaultScenario(b6Rule.b6Type),
    spareOccupancyMonths: b6Rule.defaultSpareOccupancyMonths,
    overseasSpareServiceAvailable: b6Rule.overseasSpareServiceAvailable,
    spareRate: b6Rule.defaultSpareRate,
    spareSettlementMethod: b6Rule.spareSettlementMethod,
    requiresFundingMonthsInput: b6Rule.defaultFundingMonths === null,
    b6Rule,
    sourceHints: {
      deviceVatRate: brazil ? "巴西锚定规则" : "国家管理-增值税税率",
      serviceVatRate: brazil ? "巴西锚定规则" : "国家管理-增值税税率",
      brazilServiceTaxRate: brazil ? "巴西锚定规则" : "国家规则：非巴西为 0",
      model: "实例型号管理",
      b6Type: "B6类型规则",
    },
  };
}

function normalizeLine(input: CapexPricingLineInput, defaults: CapexPricingDefaults): Required<CapexPricingLineInput> {
  const deviceCode = requiredText(input.deviceCode, "设备编码");
  const b6Type = defaults.b6Rule.b6Type;
  if (defaults.requiresFundingMonthsInput && (input.fundingMonths === null || input.fundingMonths === undefined || String(input.fundingMonths).trim() === "")) {
    throw new Error(`设备编码 ${deviceCode} 的B6类型 ${b6Type} 尚未维护默认资金占用月数，请填写后再保存。`);
  }
  if (input.baseCapexPrice === null || input.baseCapexPrice === undefined || String(input.baseCapexPrice).trim() === "") {
    throw new Error(`设备编码 ${deviceCode} 的整机价格不能为空`);
  }
  return {
    id: String(input.id ?? ""),
    deviceCode,
    b6Type,
    priceCurrency: String(input.priceCurrency ?? defaults.priceCurrency).trim() || defaults.priceCurrency,
    contractCurrency: String(input.contractCurrency ?? defaults.contractCurrency).trim() || defaults.contractCurrency,
    baseCapexPrice: toNumber(input.baseCapexPrice, defaults.baseCapexPrice),
    exchangeRate: toNumber(input.exchangeRate, defaults.exchangeRate),
    deviceVatRate: toNumber(input.deviceVatRate, defaults.deviceVatRate),
    serviceVatRate: toNumber(input.serviceVatRate, defaults.serviceVatRate),
    brazilServiceTaxRate: toNumber(input.brazilServiceTaxRate, defaults.brazilServiceTaxRate),
    onsiteRmaRate: toNumber(input.onsiteRmaRate, defaults.onsiteRmaRate),
    fundingAnnualRate: toNumber(input.fundingAnnualRate, defaults.fundingAnnualRate),
    fundingMonths: Math.max(0, Math.trunc(toNumber(input.fundingMonths, defaults.fundingMonths))),
    transportClearanceRate: toNumber(input.transportClearanceRate, defaults.transportClearanceRate),
    handlingRate: toNumber(input.handlingRate, defaults.handlingRate),
    otherTaxRate: toNumber(input.otherTaxRate, defaults.otherTaxRate),
    spareOccupancyMonths: nullableNumber(input.spareOccupancyMonths, defaults.spareOccupancyMonths),
    overseasSpareServiceAvailable: nullableBoolean(input.overseasSpareServiceAvailable, defaults.overseasSpareServiceAvailable),
    spareRate: nullableNumber(input.spareRate, defaults.spareRate),
    spareSettlementMethod: String(input.spareSettlementMethod ?? defaults.spareSettlementMethod).trim() || defaults.spareSettlementMethod,
  };
}

function getManualRuleOverrides(item: Required<CapexPricingLineInput>, rule: B6TypeConfig) {
  const overrides: string[] = [];
  if (rule.defaultFundingMonths !== null && item.fundingMonths !== rule.defaultFundingMonths) overrides.push("资金占用月数");
  if (rule.defaultSpareOccupancyMonths !== null && item.spareOccupancyMonths !== rule.defaultSpareOccupancyMonths) overrides.push("备件占用月数");
  if (rule.overseasSpareServiceAvailable !== null && item.overseasSpareServiceAvailable !== rule.overseasSpareServiceAvailable) overrides.push("海外备件服务");
  if (rule.defaultSpareRate !== null && item.spareRate !== rule.defaultSpareRate) overrides.push("备件费率");
  if (rule.spareSettlementMethod && item.spareSettlementMethod !== rule.spareSettlementMethod) overrides.push("备件结算方式");
  return overrides;
}

async function getInstanceModelSnapshots(deviceCodes: string[]) {
  const uniqueDeviceCodes = Array.from(new Set(deviceCodes.map((item) => item.trim()).filter(Boolean)));
  if (!uniqueDeviceCodes.length) return new Map<string, { modelCode: string; nameZh: string; nameEn: string; b6Type: string }>();
  const rows = await queryRows<{ deviceCode: string; modelCode: string | null; nameZh: string | null; nameEn: string | null; b6Type: string | null }>(
    "SELECT deviceCode, modelCode, nameZh, nameEn, b6Type FROM instancemodels WHERE deviceCode IN (:deviceCodes)",
    { deviceCodes: uniqueDeviceCodes },
  );
  return new Map(
    rows.map((row) => [
      row.deviceCode,
      { modelCode: String(row.modelCode ?? ""), nameZh: String(row.nameZh ?? ""), nameEn: String(row.nameEn ?? ""), b6Type: String(row.b6Type ?? "").trim() },
    ]),
  );
}

async function buildPersistedItems(versionId: string, countryCode: string, items: CapexPricingLineInput[]) {
  const modelsByDeviceCode = await getInstanceModelSnapshots(items.map((item) => item.deviceCode));
  const resolvedItems = items.map((item) => {
    const model = modelsByDeviceCode.get(item.deviceCode.trim());
    return { ...item, b6Type: String(item.b6Type ?? "").trim() || model?.b6Type || "" };
  });
  const defaultsByB6Type = new Map<string, CapexPricingDefaults>();
  for (const item of resolvedItems) {
    const b6Type = requiredText(item.b6Type, "B6类型");
    if (!defaultsByB6Type.has(b6Type)) {
      const defaults = await getCapexPricingDefaults(countryCode, b6Type);
      defaultsByB6Type.set(b6Type, defaults);
      defaultsByB6Type.set(defaults.b6Rule.b6Type, defaults);
    }
  }
  const normalizedItems = resolvedItems.map((item) => normalizeLine(item, defaultsByB6Type.get(requiredText(item.b6Type, "B6类型"))!));

  return normalizedItems.map((item, index) => {
    const calculation = calculateCapexOpexPricing({ ...item, countryCode });
    const model = modelsByDeviceCode.get(item.deviceCode);
    const defaults = defaultsByB6Type.get(item.b6Type)!;
    return {
      id: item.id || `CAPEX-ITEM-${randomUUID()}`,
      versionId,
      lineNo: index + 1,
      deviceCode: item.deviceCode,
      modelCode: model?.modelCode ?? "",
      nameZh: model?.nameZh ?? "",
      nameEn: model?.nameEn ?? "",
      b6Type: item.b6Type,
      spareScenario: calculation.spareScenario,
      spareOccupancyMonths: item.spareOccupancyMonths,
      overseasSpareServiceAvailable: item.overseasSpareServiceAvailable,
      spareRate: item.spareRate,
      spareSettlementMethod: item.spareSettlementMethod,
      priceCurrency: item.priceCurrency,
      contractCurrency: item.contractCurrency,
      baseCapexPrice: item.baseCapexPrice,
      exchangeRate: item.exchangeRate,
      deviceVatRate: item.deviceVatRate,
      serviceVatRate: item.serviceVatRate,
      brazilServiceTaxRate: isBrazil(countryCode) ? item.brazilServiceTaxRate : 0,
      onsiteRmaRate: item.onsiteRmaRate,
      fundingAnnualRate: item.fundingAnnualRate,
      fundingMonths: item.fundingMonths,
      fundingRatio: calculation.fundingRatio,
      fundingAmount: calculation.fundingAmount,
      capexTotal: calculation.capexTotal,
      transportClearanceRate: item.transportClearanceRate,
      handlingRate: item.handlingRate,
      otherTaxRate: item.otherTaxRate,
      ddpPrice: calculation.ddpPrice,
      opexAmount: calculation.opexAmount,
      rawCapexAnchorUsd: calculation.rawCapexAnchorUsd,
      rawOpexAnchorUsd: calculation.rawOpexAnchorUsd,
      capexAnchorUsd: calculation.capexAnchorUsd,
      opexAnchorUsd: calculation.opexAnchorUsd,
      sourceSnapshotJson: JSON.stringify({ formulaVersion: "1.0", defaults: defaults.sourceHints, calculation }),
      b6RuleSnapshotJson: JSON.stringify({
        rule: defaults.b6Rule,
        manualOverrides: getManualRuleOverrides(item, defaults.b6Rule),
        applied: {
          fundingMonths: item.fundingMonths,
          spareOccupancyMonths: item.spareOccupancyMonths,
          overseasSpareServiceAvailable: item.overseasSpareServiceAvailable,
          spareRate: item.spareRate,
          spareSettlementMethod: item.spareSettlementMethod,
        },
      }),
    };
  });
}

async function insertItems(versionId: string, countryCode: string, items: CapexPricingLineInput[]) {
  const persistedItems = await buildPersistedItems(versionId, countryCode, items);
  for (const item of persistedItems) {
    await execute(
      `
        INSERT INTO capexpricingitems (
          id, versionId, lineNo, deviceCode, modelCode, nameZh, nameEn, b6Type, spareScenario,
          spareOccupancyMonths, overseasSpareServiceAvailable, spareRate, spareSettlementMethod,
          priceCurrency, contractCurrency, baseCapexPrice, exchangeRate, deviceVatRate, serviceVatRate,
          brazilServiceTaxRate, onsiteRmaRate, fundingAnnualRate, fundingMonths, fundingRatio, fundingAmount,
          capexTotal, transportClearanceRate, handlingRate, otherTaxRate, ddpPrice, opexAmount,
          rawCapexAnchorUsd, rawOpexAnchorUsd, capexAnchorUsd, opexAnchorUsd, sourceSnapshotJson, b6RuleSnapshotJson
        ) VALUES (
          :id, :versionId, :lineNo, :deviceCode, :modelCode, :nameZh, :nameEn, :b6Type, :spareScenario,
          :spareOccupancyMonths, :overseasSpareServiceAvailable, :spareRate, :spareSettlementMethod,
          :priceCurrency, :contractCurrency, :baseCapexPrice, :exchangeRate, :deviceVatRate, :serviceVatRate,
          :brazilServiceTaxRate, :onsiteRmaRate, :fundingAnnualRate, :fundingMonths, :fundingRatio, :fundingAmount,
          :capexTotal, :transportClearanceRate, :handlingRate, :otherTaxRate, :ddpPrice, :opexAmount,
          :rawCapexAnchorUsd, :rawOpexAnchorUsd, :capexAnchorUsd, :opexAnchorUsd, :sourceSnapshotJson, :b6RuleSnapshotJson
        )
      `,
      item,
    );
  }
}

export async function listCapexPricingVersions(searchParams: URLSearchParams) {
  const keyword = searchParams.get("keyword")?.trim();
  const countryCode = searchParams.get("countryCode")?.trim();
  const status = searchParams.get("status")?.trim();
  const whereParts: string[] = [];
  const params: Row = {};
  if (keyword) {
    whereParts.push("(v.versionNo LIKE :keyword OR v.sourceFileName LIKE :keyword)");
    params.keyword = `%${keyword}%`;
  }
  if (countryCode) {
    whereParts.push("v.countryCode = :countryCode");
    params.countryCode = countryCode;
  }
  if (status) {
    whereParts.push("v.status = :status");
    params.status = status;
  }
  const filterExpressions: Record<string, string> = {
    versionNo: "v.versionNo", countryCode: "v.countryCode", effectiveDate: formatTableDateExpression("v.effectiveDate"), status: "v.status", itemCount: "(SELECT COUNT(*) FROM capexpricingitems iFilterCount WHERE iFilterCount.versionId = v.versionId)", sourceFileName: "v.sourceFileName", confirmedAt: formatTableDateExpression("v.confirmedAt"), createdAt: formatTableDateExpression("v.createdAt"), updatedAt: formatTableDateExpression("v.updatedAt"),
  };
  for (const [field, expression] of Object.entries(filterExpressions)) appendTableInFilter(whereParts, params, expression, field, searchParams, "capexVersion");
  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const pageSize = Math.min(100, Math.max(1, toNumber(searchParams.get("pageSize"), 20)));
  const requestedPage = Math.max(1, toNumber(searchParams.get("page"), 1));
  const [{ total: totalValue }] = await queryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM capexpricingversions v ${where}`,
    params,
  );
  const total = Number(totalValue ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await queryRows(
    `
      SELECT v.*, COUNT(i.id) AS itemCount
      FROM capexpricingversions v
      LEFT JOIN capexpricingitems i ON i.versionId = v.versionId
      ${where}
      GROUP BY v.versionId
      ${getTableSort(searchParams, filterExpressions) || "ORDER BY v.effectiveDate DESC, v.createdAt DESC"}
      LIMIT :limit OFFSET :offset
    `,
    { ...params, limit: pageSize, offset: (page - 1) * pageSize },
  );
  return { rows, total, page, pageSize, totalPages };
}

export async function listCapexPricingVersionFilterOptions(searchParams: URLSearchParams) {
  const expressions: Record<string, string> = {
    versionNo: "versionNo", countryCode: "countryCode", effectiveDate: formatTableDateExpression("effectiveDate"), status: "status", itemCount: "(SELECT COUNT(*) FROM capexpricingitems iFilterCount WHERE iFilterCount.versionId = capexpricingversions.versionId)", sourceFileName: "sourceFileName", confirmedAt: formatTableDateExpression("confirmedAt"), createdAt: formatTableDateExpression("createdAt"), updatedAt: formatTableDateExpression("updatedAt"),
  };
  return listSqlFilterOptions({ from: "capexpricingversions", expressions, searchParams });
}

export async function createCapexPricingVersion(input: CapexPricingVersionInput) {
  const versionNo = requiredText(input.versionNo, "价格版本号");
  const countryCode = requiredText(input.countryCode, "国家");
  const effectiveDate = requiredText(input.effectiveDate, "生效日期");
  const versionId = `CAPEX-VERSION-${randomUUID()}`;
  await execute(
    `
      INSERT INTO capexpricingversions (versionId, versionNo, countryCode, effectiveDate, status, sourceFileName, notes)
      VALUES (:versionId, :versionNo, :countryCode, :effectiveDate, '草稿', :sourceFileName, :notes)
    `,
    {
      versionId,
      versionNo,
      countryCode,
      effectiveDate,
      sourceFileName: String(input.sourceFileName ?? "").trim() || null,
      notes: String(input.notes ?? "").trim() || null,
    },
  );
  await insertItems(versionId, countryCode, input.items ?? []);
  return getCapexPricingVersion(versionId, new URLSearchParams({ page: "1", pageSize: "20" }));
}

export async function getCapexPricingVersion(versionId: string, searchParams: URLSearchParams) {
  const versions = await queryRows<Row>("SELECT * FROM capexpricingversions WHERE versionId = :versionId LIMIT 1", { versionId });
  const version = versions[0];
  if (!version) return null;
  const pageSize = Math.min(100, Math.max(1, toNumber(searchParams.get("pageSize"), 20)));
  const requestedPage = Math.max(1, toNumber(searchParams.get("page"), 1));
  const keyword = searchParams.get("keyword")?.trim();
  const where = keyword
    ? "WHERE versionId = :versionId AND (deviceCode LIKE :keyword OR modelCode LIKE :keyword OR nameEn LIKE :keyword OR b6Type LIKE :keyword)"
    : "WHERE versionId = :versionId";
  const params: Row = keyword ? { versionId, keyword: `%${keyword}%` } : { versionId };
  const [{ total }] = await queryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM capexpricingitems ${where}`, params);
  const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const items = await queryRows<Row>(
    `SELECT * FROM capexpricingitems ${where} ORDER BY lineNo ASC LIMIT :limit OFFSET :offset`,
    { ...params, limit: pageSize, offset: (page - 1) * pageSize },
  );
  return { version, rows: items, total: Number(total), page, pageSize, totalPages };
}

export async function saveCapexPricingVersion(versionId: string, input: CapexPricingVersionInput) {
  const current = await getCapexPricingVersion(versionId, new URLSearchParams({ page: "1", pageSize: "1" }));
  if (!current) throw new Error("价格版本不存在");
  if (String(current.version.status) !== "草稿") throw new Error("仅草稿版本允许修改");
  const versionNo = requiredText(input.versionNo, "价格版本号");
  const countryCode = requiredText(input.countryCode, "国家");
  const effectiveDate = requiredText(input.effectiveDate, "生效日期");
  await execute(
    `
      UPDATE capexpricingversions
      SET versionNo = :versionNo, countryCode = :countryCode, effectiveDate = :effectiveDate,
          sourceFileName = :sourceFileName, notes = :notes
      WHERE versionId = :versionId
    `,
    {
      versionId,
      versionNo,
      countryCode,
      effectiveDate,
      sourceFileName: String(input.sourceFileName ?? "").trim() || null,
      notes: String(input.notes ?? "").trim() || null,
    },
  );
  await execute("DELETE FROM capexpricingitems WHERE versionId = :versionId", { versionId });
  await insertItems(versionId, countryCode, input.items ?? []);
  return getCapexPricingVersion(versionId, new URLSearchParams({ page: "1", pageSize: "20" }));
}

export async function confirmCapexPricingVersion(versionId: string) {
  const current = await getCapexPricingVersion(versionId, new URLSearchParams({ page: "1", pageSize: "1" }));
  if (!current) throw new Error("价格版本不存在");
  if (String(current.version.status) === "已确认") return current;
  if (String(current.version.status) !== "草稿") throw new Error("已废止版本不能确认");
  if (current.total < 1) throw new Error("请至少维护一条价格明细后再确认");
  const invalidRuleRows = await queryRows<{ deviceCode: string; b6Type: string }>(
    "SELECT deviceCode, b6Type FROM capexpricingitems WHERE versionId = :versionId AND (b6RuleSnapshotJson IS NULL OR b6RuleSnapshotJson = '')",
    { versionId },
  );
  if (invalidRuleRows.length) {
    const samples = invalidRuleRows.slice(0, 5).map((row) => `${row.deviceCode}（${row.b6Type}）`).join("、");
    throw new Error(`以下明细尚未匹配B6类型规则，请编辑草稿并重新保存：${samples}`);
  }
  await execute("UPDATE capexpricingversions SET status = '已确认', confirmedAt = NOW() WHERE versionId = :versionId", { versionId });
  return getCapexPricingVersion(versionId, new URLSearchParams({ page: "1", pageSize: "20" }));
}

export async function cloneCapexPricingVersion(versionId: string, nextVersionNo: string, effectiveDate: string) {
  const current = await getCapexPricingVersion(versionId, new URLSearchParams({ page: "1", pageSize: "100" }));
  if (!current) throw new Error("价格版本不存在");
  const items = current.rows.map((row) => ({
    deviceCode: String(row.deviceCode ?? ""),
    b6Type: String(row.b6Type ?? ""),
    priceCurrency: String(row.priceCurrency ?? "CNY"),
    contractCurrency: String(row.contractCurrency ?? "USD"),
    baseCapexPrice: toNumber(row.baseCapexPrice),
    exchangeRate: toNumber(row.exchangeRate),
    deviceVatRate: toNumber(row.deviceVatRate),
    serviceVatRate: toNumber(row.serviceVatRate),
    brazilServiceTaxRate: toNumber(row.brazilServiceTaxRate),
    onsiteRmaRate: toNumber(row.onsiteRmaRate),
    fundingAnnualRate: toNumber(row.fundingAnnualRate),
    fundingMonths: toNumber(row.fundingMonths),
    spareOccupancyMonths: nullableNumber(row.spareOccupancyMonths),
    overseasSpareServiceAvailable: nullableBoolean(row.overseasSpareServiceAvailable),
    spareRate: nullableNumber(row.spareRate),
    spareSettlementMethod: String(row.spareSettlementMethod ?? ""),
    transportClearanceRate: toNumber(row.transportClearanceRate),
    handlingRate: toNumber(row.handlingRate),
    otherTaxRate: toNumber(row.otherTaxRate),
  }));
  return createCapexPricingVersion({
    versionNo: requiredText(nextVersionNo, "新价格版本号"),
    countryCode: String(current.version.countryCode ?? ""),
    effectiveDate: requiredText(effectiveDate, "生效日期"),
    sourceFileName: String(current.version.sourceFileName ?? ""),
    notes: `复制自 ${String(current.version.versionNo ?? "")}`,
    items,
  });
}

export async function getCapexPricingCalculation(versionId: string, itemId: string) {
  const rows = await queryRows<Row>(
    `
      SELECT i.*, v.versionNo, v.countryCode, v.effectiveDate, v.status
      FROM capexpricingitems i
      INNER JOIN capexpricingversions v ON v.versionId = i.versionId
      WHERE i.versionId = :versionId AND i.id = :itemId
      LIMIT 1
    `,
    { versionId, itemId },
  );
  const item = rows[0];
  if (!item) return null;
  const history = await queryRows<Row>(
    `
      SELECT v.versionId, v.versionNo, v.effectiveDate, v.status, i.capexAnchorUsd, i.opexAnchorUsd
      FROM capexpricingitems i
      INNER JOIN capexpricingversions v ON v.versionId = i.versionId
      WHERE v.countryCode = :countryCode
        AND i.deviceCode = :deviceCode
        AND i.b6Type = :b6Type
      ORDER BY v.effectiveDate DESC, v.createdAt DESC
      LIMIT 20
    `,
    { countryCode: item.countryCode, deviceCode: item.deviceCode, b6Type: item.b6Type },
  );
  return { item, history };
}

export function capexPricingTemplateColumns() {
  return [
    ["deviceCode", "设备编码"], ["b6Type", "B6类型"], ["baseCapexPrice", "整机价格（不含VAT）"],
    ["priceCurrency", "整机价格币种"], ["contractCurrency", "SL合同币种"], ["exchangeRate", "整机价转合同汇率"],
    ["deviceVatRate", "当地设备VAT"], ["serviceVatRate", "当地服务VAT"], ["onsiteRmaRate", "Onsite+RMA费率"],
    ["fundingAnnualRate", "资金占用年利率"], ["fundingMonths", "资金占用月数"], ["transportClearanceRate", "运保清关费率"],
    ["handlingRate", "总代过手费率"], ["otherTaxRate", "其他税费率"], ["brazilServiceTaxRate", "巴西服务税率"],
  ] as const;
}

export function buildCapexPricingTemplateRow(countryCode: string) {
  const brazil = isBrazil(countryCode);
  return {
    deviceCode: "",
    b6Type: "B62-A7",
    baseCapexPrice: "",
    priceCurrency: "CNY",
    contractCurrency: "USD",
    exchangeRate: DEFAULT_EXCHANGE_RATE,
    deviceVatRate: brazil ? 0 : "",
    serviceVatRate: brazil ? 0 : "",
    onsiteRmaRate: 0,
    fundingAnnualRate: 0.04,
    fundingMonths: 0,
    transportClearanceRate: brazil ? 0.16 : 0.02,
    handlingRate: brazil ? 0.09 : 0,
    otherTaxRate: brazil ? 0.57 : 0,
    brazilServiceTaxRate: brazil ? 0.029 : 0,
  };
}

export function formatCapexPricingItemForExport(item: Row) {
  return {
    ...item,
    effectiveDate: normalizeDate(item.effectiveDate),
  };
}
