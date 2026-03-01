// ============================================================
// Vercel API Route — /api/email/send-verification
//
// This Next.js API route intercepts email verification requests
// so that email delivery happens on Vercel (which does NOT block
// outbound SMTP) instead of Railway (which blocks SMTP).
//
// Flow:
// 1. Calls Railway backend to generate & store the verification code
// 2. Sends the email from Vercel via Gmail SMTP
// 3. Returns success to the client
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";
const INTERNAL_KEY = process.env.EMAIL_INTERNAL_KEY || "";

export async function POST(req: NextRequest) {
    try {
        const { email } = await req.json();

        if (!email || typeof email !== "string") {
            return NextResponse.json({ error: "Email is required." }, { status: 400 });
        }

        // 1. Call Railway backend to generate & store the verification code
        const backendRes = await fetch(`${BACKEND_URL}/api/email/send-verification`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Key": INTERNAL_KEY,
            },
            body: JSON.stringify({ email }),
        });

        if (!backendRes.ok) {
            const body = await backendRes.json().catch(() => ({}));
            return NextResponse.json(
                { error: (body as Record<string, string>).error || "Failed to generate verification code." },
                { status: backendRes.status }
            );
        }

        const { code } = (await backendRes.json()) as { code: string };

        // 2. Send the email from Vercel via Gmail SMTP
        const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 587,
            secure: false,
            auth: {
                user: process.env.SMTP_EMAIL,
                pass: process.env.SMTP_PASSWORD,
            },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 30_000,
        });

        const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #1e293b; margin-bottom: 8px;">OJT Progress Tracker</h2>
        <p style="color: #475569; font-size: 14px;">
          Please verify your email address by entering the code below.
          This code expires in <strong>10 minutes</strong>.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 12px 24px; background: #f1f5f9; border-radius: 8px; color: #0f172a;">
            ${code}
          </span>
        </div>
        <p style="color: #94a3b8; font-size: 12px;">
          If you did not request this, you can safely ignore this email.
        </p>
      </div>
    `;

        await transporter.sendMail({
            from: `"OJT Progress Tracker" <${process.env.SMTP_EMAIL}>`,
            to: email,
            subject: "Email Verification Code — OJT Progress Tracker",
            html,
        });

        return NextResponse.json({ message: "Verification code sent." });
    } catch (err) {
        console.error("send-verification API route error:", err);
        return NextResponse.json(
            { error: "Failed to send verification code." },
            { status: 500 }
        );
    }
}
