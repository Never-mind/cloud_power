import { NextRequest, NextResponse } from "next/server";
import { listAvailablePrepaymentLineFilterOptions, listAvailablePrepaymentLines } from "@/lib/prepayment-service";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has("field")) {
    return NextResponse.json(await listAvailablePrepaymentLineFilterOptions(request.nextUrl.searchParams));
  }
  return NextResponse.json(await listAvailablePrepaymentLines({
    page: Number(request.nextUrl.searchParams.get("page") ?? 1),
    pageSize: Number(request.nextUrl.searchParams.get("pageSize") ?? 20),
    keyword: request.nextUrl.searchParams.get("keyword") ?? "",
    countryCode: request.nextUrl.searchParams.get("countryCode") ?? "",
    requestType: request.nextUrl.searchParams.get("requestType") ?? "",
    searchParams: request.nextUrl.searchParams,
  }));
}
