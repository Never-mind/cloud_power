import { NextRequest, NextResponse } from "next/server";
import { listAvailableFinalSettlementSourceFilterOptions, listAvailableFinalSettlementSources } from "@/lib/balance-final-settlement-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.has("field")) return NextResponse.json(await listAvailableFinalSettlementSourceFilterOptions({
      countryCode: request.nextUrl.searchParams.get("countryCode") ?? "",
      currency: request.nextUrl.searchParams.get("currency") ?? "USD",
      periodStart: request.nextUrl.searchParams.get("periodStart") ?? "",
      periodEnd: request.nextUrl.searchParams.get("periodEnd") ?? "",
      searchParams: request.nextUrl.searchParams,
    }));
    return NextResponse.json({
      ...await listAvailableFinalSettlementSources({
        countryCode: request.nextUrl.searchParams.get("countryCode") ?? "",
        currency: request.nextUrl.searchParams.get("currency") ?? "USD",
        periodStart: request.nextUrl.searchParams.get("periodStart") ?? "",
        periodEnd: request.nextUrl.searchParams.get("periodEnd") ?? "",
        page: Number(request.nextUrl.searchParams.get("page") ?? 1),
        pageSize: Number(request.nextUrl.searchParams.get("pageSize") ?? 20),
        searchParams: request.nextUrl.searchParams,
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "\u7ed3\u5dee\u6765\u6e90\u5355\u52a0\u8f7d\u5931\u8d25" }, { status: 400 });
  }
}
