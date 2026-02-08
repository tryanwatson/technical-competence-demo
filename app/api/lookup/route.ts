import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/app/db";
import type { LookupResponse } from "@/app/lib/types";

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber } = await request.json();

    if (!phoneNumber) {
      return NextResponse.json(
        { error: "Missing required field: phoneNumber" },
        { status: 400 }
      );
    }

    const sql = getSql();
    const rows = await sql`
      SELECT tech_competence FROM users WHERE phone_number = ${phoneNumber}
    `;

    if (rows.length > 0) {
      const response: LookupResponse = {
        found: true,
        techCompetence: rows[0].tech_competence,
      };
      return NextResponse.json(response);
    }

    const response: LookupResponse = { found: false };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Lookup API error:", error);
    // Graceful degradation: treat DB failure as "not found" so user goes through IVR
    const response: LookupResponse = { found: false };
    return NextResponse.json(response);
  }
}
