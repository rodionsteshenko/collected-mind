import { NextResponse } from "next/server";

import { readLog } from "@/lib/advisor/log";

export const runtime = "nodejs";

export async function GET() {
  const entries = await readLog();
  return NextResponse.json({ entries });
}
