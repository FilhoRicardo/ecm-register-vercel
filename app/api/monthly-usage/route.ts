import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    records: [],
    next: "Connect this route to monthly_utility_usage during the data migration phase."
  });
}
