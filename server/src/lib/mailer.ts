import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface Mail { to: string; subject: string; text: string; html?: string }
export interface Mailer { send(m: Mail): Promise<void>; enabled: boolean }

/** SMTP mailer. Without SMTP settings, mails are logged instead so admins can still copy links from the UI. */
export function createMailer(cfg: Config, log: (msg: string) => void = console.log): Mailer {
  if (!cfg.SMTP_HOST) {
    return { enabled: false, async send(m) { log(`[mail disabled] to=${m.to} subject="${m.subject}"`); } };
  }
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
  });
  return {
    enabled: true,
    async send(m) {
      await transport.sendMail({ from: cfg.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html ?? layout(m.text) });
    },
  };
}

/** Capturing mailer for tests. */
export function memoryMailer() {
  const outbox: Mail[] = [];
  return { enabled: true, outbox, async send(m: Mail) { outbox.push(m); } };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function layout(text: string) {
  const body = escapeHtml(text)
    .split('\n\n')
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#111">$1</a>').replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1b1b1b;max-width:520px;margin:0 auto;padding:24px">
<div style="font-weight:700;font-size:16px;margin-bottom:20px">SEG Workspace</div>${body}
<p style="margin-top:28px;color:#8a8a8a;font-size:12px">You received this because you have an account on SEG Workspace.</p></div>`;
}
