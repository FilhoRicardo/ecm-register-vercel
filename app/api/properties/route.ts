import { NextResponse } from "next/server";
import { listProperties } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listProperties());
}
