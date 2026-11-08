/**
 * Transactional email.
 *
 * Contract that matters for correctness: this module NEVER reports success unless
 * a provider accepted the message. When no provider is configured, sending is a
 * no-op that returns `{ delivered: false, reason: "not_configured" }`, and callers
 * surface that to the user honestly ("email delivery is not configured") instead
 * of pretending an invitation went out.
 *
 * Every outbound message is also written to `public.email_outbox`, so an operator
 * can see what the system attempted even when no provider is wired up.
 */
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";

export type EmailKind = "staff_invitation" | "password_reset" | "order_notification";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body; always sent alongside the HTML version. */
  text: string;
  html: string;
  kind: EmailKind;
  restaurantId?: string | null;
}

export interface EmailResult {
  delivered: boolean;
  /** Present when delivered is false. */
  reason?: "not_configured" | "provider_error" | "invalid_recipient";
  detail?: string;
  providerId?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
}

async function record(
  message: EmailMessage,
  status: "sent" | "failed" | "skipped",
  detail: string | null,
  providerId: string | null,
): Promise<void> {
  try {
    const db = await getDb();
    await db.query(
      `insert into public.email_outbox (kind, recipient, subject, restaurant_id, status, detail, provider_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [message.kind, message.to, message.subject, message.restaurantId ?? null, status, detail, providerId],
    );
  } catch (error) {
    // Logging an email must never break the user's action.
    console.error("[email] could not record outbox entry", error);
  }
}

/**
 * Sends one transactional message and records the real outcome.
 *
 * The body is never logged in production: invitations and reset links are
 * credentials. In development the link is printed so the flow can be exercised
 * without a provider.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const to = message.to.trim().toLowerCase();
  if (!isEmail(to)) {
    await record({ ...message, to }, "failed", "invalid recipient", null);
    return { delivered: false, reason: "invalid_recipient", detail: "That email address is not valid." };
  }

  const config = serverEnv.email;
  if (!config) {
    await record({ ...message, to }, "skipped", "no email provider configured", null);
    if (!serverEnv.isProduction) {
      console.info(`[email] provider not configured. Would have sent "${message.subject}" to ${to}`);
      console.info(`[email] body (dev only):\n${message.text}`);
    }
    return {
      delivered: false,
      reason: "not_configured",
      detail: "No email provider is configured, so nothing was sent.",
    };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const detail = `provider responded ${res.status}`;
      // The provider body can echo the API key in rare cases; keep it out of both
      // the outbox and the logs.
      await record({ ...message, to }, "failed", detail, null);
      console.error(`[email] send failed for ${message.kind}: ${detail}`);
      return { delivered: false, reason: "provider_error", detail };
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string };
    await record({ ...message, to }, "sent", null, body.id ?? null);
    return { delivered: true, providerId: body.id };
  } catch (error) {
    const detail = error instanceof Error ? error.name : "unknown";
    await record({ ...message, to }, "failed", detail, null);
    console.error(`[email] send threw for ${message.kind}: ${detail}`);
    return { delivered: false, reason: "provider_error", detail };
  }
}

/** True when a provider is wired up, for honest UI copy. */
export function emailDeliveryConfigured(): boolean {
  return serverEnv.email !== null;
}

/* -------------------------------------------------------------------------- */
/* Message templates                                                          */
/* -------------------------------------------------------------------------- */

function layout(title: string, body: string, cta?: { label: string; href: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:1px solid #e7e4dd">
      <tr><td style="padding:28px 28px 8px">
        <p style="margin:0 0 18px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9a6b4f">MenuPilot</p>
        <h1 style="margin:0 0 14px;font-size:19px;color:#181814">${title}</h1>
        <div style="font-size:14px;line-height:1.6;color:#4a4a44">${body}</div>
      </td></tr>
      ${
        cta
          ? `<tr><td style="padding:6px 28px 26px"><a href="${cta.href}" style="display:inline-block;background:#9a6b4f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">${cta.label}</a></td></tr>`
          : ""
      }
      <tr><td style="padding:0 28px 26px"><p style="margin:0;font-size:12px;color:#8a8a80">If you did not expect this email you can ignore it.</p></td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export function staffInvitationEmail(input: {
  restaurantName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresInDays: number;
}): Omit<EmailMessage, "to" | "kind"> {
  const title = `${input.inviterName} invited you to ${input.restaurantName}`;
  const text = [
    `${input.inviterName} invited you to join ${input.restaurantName} on MenuPilot as ${input.role}.`,
    "",
    `Accept the invitation: ${input.acceptUrl}`,
    "",
    `This link expires in ${input.expiresInDays} days.`,
  ].join("\n");
  return {
    subject: `Join ${input.restaurantName} on MenuPilot`,
    text,
    html: layout(
      title,
      `<p style="margin:0 0 12px">You have been invited as <strong>${input.role}</strong>.</p>
       <p style="margin:0">This invitation expires in ${input.expiresInDays} days.</p>`,
      { label: "Accept invitation", href: input.acceptUrl },
    ),
  };
}

export function passwordResetEmail(input: { resetUrl: string; minutes: number }): Omit<EmailMessage, "to" | "kind"> {
  const text = [
    "Someone asked to reset the password for your MenuPilot account.",
    "",
    `Set a new password: ${input.resetUrl}`,
    "",
    `This link expires in ${input.minutes} minutes and can be used once.`,
    "If this was not you, no action is needed — your password has not changed.",
  ].join("\n");
  return {
    subject: "Reset your MenuPilot password",
    text,
    html: layout(
      "Reset your password",
      `<p style="margin:0 0 12px">This link expires in ${input.minutes} minutes and can be used once.</p>
       <p style="margin:0">If this was not you, no action is needed.</p>`,
      { label: "Set a new password", href: input.resetUrl },
    ),
  };
}
