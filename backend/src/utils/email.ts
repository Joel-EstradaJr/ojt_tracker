// ============================================================
// Email Utility — sends verification codes via Resend HTTP API.
// Railway blocks outbound SMTP on non-Pro plans, so we use
// Resend's HTTPS-based API instead of direct Gmail SMTP.
//
// Requires RESEND_API_KEY environment variable.
// Optionally RESEND_FROM to set the sender address (must be
// a verified domain on Resend, or use "onboarding@resend.dev"
// for testing).
// ============================================================

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Sender address — use a verified Resend domain, or the shared
// "onboarding@resend.dev" address for free-tier / testing.
const FROM =
  process.env.RESEND_FROM || "OJT Progress Tracker <onboarding@resend.dev>";

/**
 * Send a 6-digit password-reset verification code to the given email.
 */
export async function sendResetCode(
  to: string,
  code: string,
  displayName: string
): Promise<void> {
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

  const { error } = await resend.emails.send({
    from: FROM,
    to: [to],
    subject: "Password Reset Code — OJT Progress Tracker",
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

/**
 * Send a 6-digit email-ownership verification code (used during
 * trainee creation or when editing the trainee email address).
 */
export async function sendEmailVerificationCode(
  to: string,
  code: string
): Promise<void> {
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

  const { error } = await resend.emails.send({
    from: FROM,
    to: [to],
    subject: "Email Verification Code — OJT Progress Tracker",
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}