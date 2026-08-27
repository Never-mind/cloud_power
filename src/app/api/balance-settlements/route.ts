import { NextRequest, NextResponse } from "next/server";
import { createInstanceSettlementDraft, listBalanceSettlementFilterOptions, listBalanceSettlements } from "@/lib/balance-settlement-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.has("field")) return NextResponse.json(await listBalanceSettlementFilterOptions(request.nextUrl.searchParams));
    return NextResponse.json(await listBalanceSettlements({
      countryCode: request.nextUrl.searchParams.get("countryCode") ?? "",
      status: request.nextUrl.searchParams.get("status") ?? "",
      keyword: request.nextUrl.searchParams.get("keyword") ?? "",
      page: Number(request.nextUrl.searchParams.get("page") ?? 1),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") ?? 20),
      searchParams: request.nextUrl.searchParams,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "\u7ed3\u5dee\u5355\u52a0\u8f7d\u5931\u8d25" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = await createInstanceSettlementDraft({
      pricingVersionId: String(body.pricingVersionId ?? ""),
      purchaseOrderItemIds: Array.isArray(body.purchaseOrderItemIds) ? body.purchaseOrderItemIds.map(String) : [],
      settlementRates: body.settlementRates && typeof body.settlementRates === "object" ? body.settlementRates : {},
      title: String(body.title ?? ""),
      notes: String(body.notes ?? ""),
      periodStart: String(body.periodStart ?? ""),
      periodEnd: String(body.periodEnd ?? ""),
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "\u751f\u6210\u7ed3\u5dee\u8349\u7a3f\u5931\u8d25" }, { status: 400 });
  }
}
