import { NextRequest, NextResponse } from "next/server";
import { listInternalServiceSnapshotFilterOptions, listInternalServiceSnapshots } from "@/lib/internal-service-fee-service";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.has("field")) return NextResponse.json(await listInternalServiceSnapshotFilterOptions(request.nextUrl.searchParams));
    return NextResponse.json(await listInternalServiceSnapshots(request.nextUrl.searchParams));
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "归档快照加载失败" }, { status: 500 }); }
}
