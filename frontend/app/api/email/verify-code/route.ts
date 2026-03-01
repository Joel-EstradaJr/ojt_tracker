// ============================================================
// Vercel API Route — /api/email/verify-code
//
// Proxies the verify-code request to the Railway backend with
// the correct /api path prefix. This is needed because the
// Next.js rewrite rule strips /api from the path.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const backendRes = await fetch(`${BACKEND_URL}/api/email/verify-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await backendRes.json().catch(() => ({}));

        return NextResponse.json(data, { status: backendRes.status });
    } catch (err) {
        console.error("verify-code proxy error:", err);
        return NextResponse.json(
            { error: "Failed to verify code." },
            { status: 500 }
        );
    }
}
