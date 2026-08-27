import { NextRequest, NextResponse } from "next/server";
import { createFinalBalanceSettlement, listFinalBalanceSettlementFilterOptions, listFinalBalanceSettlements } from "@/lib/balance-final-settlement-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.has("field")) return NextResponse.json(await listFinalBalanceSettlementFilterOptions(request.nextUrl.searchParams));
    return NextResponse.json({
      ...await listFinalBalanceSettlements({
        countryCode: request.nextUrl.searchParams.get("countryCode") ?? "",
        currency: request.nextUrl.searchParams.get("currency") ?? "",
        status: request.nextUrl.searchParams.get("status") ?? "",
        keyword: request.nextUrl.searchParams.get("keyword") ?? "",
        page: Number(request.nextUrl.searchParams.get("page") ?? 1),
        pageSize: Number(request.nextUrl.searchParams.get("pageSize") ?? 20),
        searchParams: request.nextUrl.searchParams,
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "\u7ed3\u5dee\u7ed3\u7b97\u5355\u52a0\u8f7d\u5931\u8d25" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await createFinalBalanceSettlement({
      title: String(body.title ?? ""),
      countryCode: String(body.countryCode ?? ""),
      currency: String(body.currency ?? "USD"),
      periodStart: String(body.periodStart ?? ""),
      periodEnd: String(body.periodEnd ?? ""),
      notes: String(body.notes ?? ""),
      sourceSettlementNos: Array.isArray(body.sourceSettlementNos) ? body.sourceSettlementNos.map(String) : [],
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "\u521b\u5efa\u7ed3\u5dee\u7ed3\u7b97\u5355\u5931\u8d25" }, { status: 400 });
  }
}
