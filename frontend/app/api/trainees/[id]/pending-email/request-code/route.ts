import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";
const INTERNAL_KEY = process.env.EMAIL_INTERNAL_KEY || "";

type RouteContext = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const traineeId = params.id;
    if (!traineeId) {
      return NextResponse.json({ error: "Trainee ID is required." }, { status: 400 });
    }

    const backendRes = await fetch(`${BACKEND_URL}/api/trainees/${traineeId}/pending-email/request-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
        Cookie: req.headers.get("cookie") || "",
      },
      credentials: "include",
      body: JSON.stringify({}),
    });

    const data = (await backendRes.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      code?: string;
      pendingEmail?: string;
      displayName?: string;
      expiresInHours?: number;
    };

    if (!backendRes.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to generate pending email verification code." },
        { status: backendRes.status }
      );
    }

    if (data.code && data.pendingEmail) {
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
          <p style="color: #475569; font-size: 14px;">Hi <strong>${data.displayName || "Trainee"}</strong>,</p>
          <p style="color: #475569; font-size: 14px;">
            An admin updated your account email. Enter the code below to verify and activate the new email address.
            This code expires in <strong>24 hours</strong>.
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 12px 24px; background: #f1f5f9; border-radius: 8px; color: #0f172a;">
              ${data.code}
            </span>
          </div>
          <p style="color: #94a3b8; font-size: 12px;">
            If this request was unexpected, contact your administrator.
          </p>
        </div>
      `;

      await transporter.sendMail({
        from: `"OJT Progress Tracker" <${process.env.SMTP_EMAIL}>`,
        to: data.pendingEmail,
        subject: "Verify Your Updated Email - OJT Progress Tracker",
        html,
      });
    }

    return NextResponse.json({
      message: data.message || "Verification code sent to pending email.",
      expiresInHours: data.expiresInHours || 24,
    });
  } catch (err) {
    console.error("pending-email request-code API route error:", err);
    return NextResponse.json(
      { error: "Failed to send pending email verification code." },
      { status: 500 }
    );
  }
}
