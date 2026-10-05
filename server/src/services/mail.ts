import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';

/**
 * Credential mail transport.
 *  - CAPTURE: stored in mail_capture only ("demo mail, not delivered externally").
 *  - SMTP: delivered through SMTP_URL (e.g. a provider, or Mailpit locally).
 * Delivery is never reported as sent unless the SMTP server accepted it.
 */
export type MailChannel = 'CAPTURE' | 'SMTP';

export function mailChannel(cfg: AppConfig): MailChannel {
  if (cfg.mail.mode === 'smtp') {
    if (!cfg.mail.smtpUrl) throw new AppError('MAIL_NOT_CONFIGURED', 'MAIL_MODE=smtp but SMTP_URL is not set.');
    return 'SMTP';
  }
  if (cfg.mail.mode === 'capture') return 'CAPTURE';
  throw new AppError('MAIL_NOT_CONFIGURED', 'No mail transport configured. Set MAIL_MODE=smtp with SMTP_URL (or MAIL_MODE=capture for demo / rehearsal).');
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export async function sendSmtp(cfg: AppConfig, to: string, subject: string, text: string) {
  transport ??= nodemailer.createTransport(cfg.mail.smtpUrl!);
  await transport.sendMail({ from: cfg.mail.from, to, subject, text });
}

export function credentialMail(args: { eventName: string; teamName: string; crewId: string; email: string; password: string; slotLabel: string; loginUrl: string; reset: boolean }) {
  const subject = `${args.eventName} — ${args.reset ? 'new temporary password' : 'your crew login'} (${args.crewId})`;
  const body = [
    `Hello ${args.teamName},`,
    '',
    args.reset ? 'An organizer issued a new temporary password for your crew. All previous devices were signed out.' : 'Your crew is registered for the debugging competition. These are your crew credentials (one login for the whole team).',
    '',
    `Crew ID:   ${args.crewId}`,
    `Login:     ${args.email}  (or the crew ID)`,
    `Password:  ${args.password}`,
    `Your slot: ${args.slotLabel}`,
    `Sign in:   ${args.loginUrl}`,
    '',
    'You will be asked to choose a new password at first sign-in. Up to four devices may be signed in at once.',
    'Keep these details within your crew.',
    '',
    `— ${args.eventName} organizers`,
  ].join('\n');
  return { subject, body };
}
