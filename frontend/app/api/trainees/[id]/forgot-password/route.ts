// ============================================================
// Vercel API Route — /api/trainees/:id/forgot-password
//
// Intercepts forgot-password requests so email delivery happens
// on Vercel instead of Railway (which blocks SMTP).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";
const INTERNAL_KEY = process.env.EMAIL_INTERNAL_KEY || "";

export async function POST(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { id } = params;

        // 1. Call Railway backend to generate code & get trainee info
        const backendRes = await fetch(`${BACKEND_URL}/api/trainees/${id}/forgot-password`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Key": INTERNAL_KEY,
            },
        });

        if (!backendRes.ok) {
            const body = await backendRes.json().catch(() => ({}));
            return NextResponse.json(
                { error: (body as Record<string, string>).error || "Failed to process request." },
                { status: backendRes.status }
            );
        }

        const data = (await backendRes.json()) as {
            message: string;
            maskedEmail: string;
            code?: string;
            displayName?: string;
            email?: string;
        };

        // If the backend returned a code, send the email from Vercel
        if (data.code && data.email && data.displayName) {
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
          <p style="color: #475569; font-size: 14px;">Hi <strong>${data.displayName}</strong>,</p>
          <p style="color: #475569; font-size: 14px;">
            You requested a password reset. Use the verification code below to proceed.
            This code expires in <strong>10 minutes</strong>.
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 12px 24px; background: #f1f5f9; border-radius: 8px; color: #0f172a;">
              ${data.code}
            </span>
          </div>
          <p style="color: #94a3b8; font-size: 12px;">
            If you did not request this, you can safely ignore this email.
          </p>
        </div>
      `;

            await transporter.sendMail({
                from: `"OJT Progress Tracker" <${process.env.SMTP_EMAIL}>`,
                to: data.email,
                subject: "Password Reset Code — OJT Progress Tracker",
                html,
            });
        }

        // Return only safe fields to the client (no code, no raw email)
        return NextResponse.json({
            message: data.message,
            maskedEmail: data.maskedEmail,
        });
    } catch (err) {
        console.error("forgot-password API route error:", err);
        return NextResponse.json(
            { error: "Failed to send verification code. Please try again." },
            { status: 500 }
        );
    }
}
