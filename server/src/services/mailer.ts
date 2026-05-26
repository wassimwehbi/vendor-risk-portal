import nodemailer from 'nodemailer';
import { authConfig } from './auth';

function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

const FROM = process.env.EMAIL_FROM || 'no-reply@vendor-risk-portal.local';

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/**
 * Generic transactional email send, shared by the magic-link / invite flows and
 * the R2 usage monitor. When SMTP is not configured (e.g. local / offline dev)
 * the message is logged to the console instead of sent, so every flow still
 * works without an email provider.
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  if (!authConfig.smtpConfigured) {
    const to = Array.isArray(msg.to) ? msg.to.join(', ') : msg.to;
    console.log(`[mail] (dev) SMTP not configured — would send "${msg.subject}" to ${to}`);
    return;
  }
  await transport().sendMail({ from: FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
}

/**
 * Sends a magic-link sign-in email. When SMTP is not configured the link is
 * logged to the server console instead, so the flow still works without an
 * email provider.
 */
export async function sendMagicLink(email: string, url: string): Promise<void> {
  if (!authConfig.smtpConfigured) {
    console.log(`[auth] (dev) magic sign-in link for ${email}: ${url}`);
    return;
  }
  await sendMail({
    to: email,
    subject: 'Your Vendor Risk Portal sign-in link',
    text: `Sign in to the Vendor Risk Portal:\n\n${url}\n\nThis link expires in 15 minutes. If you did not request it, ignore this email.`,
    html: `<p>Sign in to the Vendor Risk Portal:</p><p><a href="${url}">Sign in</a></p><p>This link expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
  });
}

/**
 * Sends a tenant invitation email with an accept link. Logged to the console
 * when SMTP is not configured so the admin can still copy the link.
 */
export async function sendInvite(email: string, url: string, tenantName: string): Promise<void> {
  if (!authConfig.smtpConfigured) {
    console.log(`[admin] (dev) invite link for ${email} -> ${tenantName}: ${url}`);
    return;
  }
  await sendMail({
    to: email,
    subject: `You've been invited to ${tenantName} on the Vendor Risk Portal`,
    text: `You've been invited to join ${tenantName} on the Vendor Risk Portal.\n\nAccept your invitation:\n${url}\n\nThis link expires in 7 days.`,
    html: `<p>You've been invited to join <strong>${tenantName}</strong> on the Vendor Risk Portal.</p><p><a href="${url}">Accept invitation</a></p><p>This link expires in 7 days.</p>`,
  });
}
