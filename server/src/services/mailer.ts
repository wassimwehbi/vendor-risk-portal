import nodemailer from 'nodemailer';
import { authConfig } from './auth';

/**
 * Sends a magic-link sign-in email. When SMTP is not configured (e.g. local /
 * offline dev) the link is logged to the server console instead, so the flow
 * still works without an email provider.
 */
export async function sendMagicLink(email: string, url: string): Promise<void> {
  if (!authConfig.smtpConfigured) {
    console.log(`[auth] (dev) magic sign-in link for ${email}: ${url}`);
    return;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({
    from: process.env.EMAIL_FROM || 'no-reply@vendor-risk-portal.local',
    to: email,
    subject: 'Your Vendor Risk Portal sign-in link',
    text: `Sign in to the Vendor Risk Portal:\n\n${url}\n\nThis link expires in 15 minutes. If you did not request it, ignore this email.`,
    html: `<p>Sign in to the Vendor Risk Portal:</p><p><a href="${url}">Sign in</a></p><p>This link expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
  });
}
