import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    records: [],
    next: "Connect this route to ecm_measured_savings during the data migration phase."
  });
}
