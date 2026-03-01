// ============================================================
// Email Utility — sends verification codes via Gmail SMTP
// using Nodemailer. Requires SMTP_EMAIL and SMTP_PASSWORD
// environment variables (use a Gmail App Password).
// ============================================================

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD, // Gmail App Password (16 chars, no spaces)
  },
});

/**
 * Send a 6-digit password-reset verification code to the given email.
 */
export async function sendResetCode(to: string, code: string, displayName: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #1e293b; margin-bottom: 8px;">OJT Progress Tracker</h2>
      <p style="color: #475569; font-size: 14px;">Hi <strong>${displayName}</strong>,</p>
      <p style="color: #475569; font-size: 14px;">
        You requested a password reset. Use the verification code below to proceed.
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
    to,
    subject: "Password Reset Code — OJT Progress Tracker",
    html,
  });
}
