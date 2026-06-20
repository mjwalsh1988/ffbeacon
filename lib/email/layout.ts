/**
 * FF Beacon branded email shell (light, brand-accurate, Gmail-safe).
 *
 * Why this is a LIGHT email:
 *   The Gmail mobile app ignores the color-scheme meta tags and runs its own
 *   luminance remap. A dark email gets mangled (our near-black background turned
 *   white with muddy text). The robust, professional answer used across the
 *   industry is a LIGHT email: Gmail renders light emails as designed in light
 *   mode and produces a clean, coherent dark version in dark mode, instead of the
 *   broken half-inversion a dark email suffers. So this shell is a white card on a
 *   light-gray page with FF Beacon purple/cyan accents.
 *
 * What is image-based on purpose (Gmail never recolors IMAGES, only CSS/HTML):
 *   - the logo, served as a black-circle badge PNG (ff-beacon-logo-email.png), so
 *     the mark always sits on its intended backdrop, and
 *   - the social icons, served as brand purple-to-cyan gradient circle PNGs
 *     (/img/email/social-*.png), so they stay on-brand and crisp everywhere.
 *
 * Every cell also carries an explicit bgcolor attribute alongside inline CSS so a
 * client that drops CSS still paints the right surface. buildBrandedEmail()
 * returns { html, text }; pass inner content as escaped HTML plus a plain-text
 * body.
 */

import { SITE } from "@/lib/site";

const C = {
  pageBg: "#EDEFF4", // outer page background (light gray)
  card: "#FFFFFF", // content card
  ink: "#1B1F2A", // headings / strong text
  inkBody: "#454C5A", // body text
  inkSubtle: "#5B6271", // fine print
  line: "#E5E7EB", // hairline borders
  purple: "#7C3AED", // links / accents (AA contrast on white)
  purpleBright: "#A855F7", // gradient start
  cyan: "#22D3EE", // gradient end
  quoteBg: "#F6F4FF", // tinted echo card
  buttonFrom: "#7C3AED",
  buttonTo: "#9333EA",
  white: "#FFFFFF",
};

/** Absolute site origin for links/images in email (never a relative URL). */
function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? SITE.url ?? "https://ffbeacon.com";
  // Real inboxes can't reach localhost; fall back to the production origin.
  if (/localhost|127\.0\.0\.1/.test(raw)) return "https://ffbeacon.com";
  return raw.replace(/\/$/, "");
}

export const EMAIL_SITE_URL = siteUrl();
export const EMAIL_DISCORD_URL = `${EMAIL_SITE_URL}/join`;
export const EMAIL_TAGLINE = SITE.tagline; // "Your signal through the fantasy noise."

/** Escape a string for safe interpolation into HTML email markup. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A brand-gradient CTA button (bulletproof: VML-free, solid bgcolor fallback). */
export function emailButton(label: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;">
      <tr>
        <td align="center" bgcolor="${C.buttonFrom}" style="border-radius:10px;background-color:${C.buttonFrom};background-image:linear-gradient(135deg,${C.buttonFrom} 0%,${C.buttonTo} 100%);">
          <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${C.white};text-decoration:none;border-radius:10px;">${esc(label)}</a>
        </td>
      </tr>
    </table>`;
}

const SOCIALS: Array<{ label: string; href: string; icon: string }> = [
  { label: "Discord", href: EMAIL_DISCORD_URL, icon: "social-discord.png" },
  { label: "X", href: "https://x.com/ffbeacon", icon: "social-x.png" },
  { label: "TikTok", href: "https://tiktok.com/@ffbeacon", icon: "social-tiktok.png" },
  { label: "YouTube", href: "https://www.youtube.com/@FFBeacon", icon: "social-youtube.png" },
  { label: "Instagram", href: "https://instagram.com/ffbeacon", icon: "social-instagram.png" },
];

/** Centered row of image-based social icons (gradient circles). */
function socialRow(): string {
  const cells = SOCIALS.map(
    (s) => `
        <td style="padding:0 5px;">
          <a href="${esc(s.href)}" target="_blank" style="text-decoration:none;">
            <img src="${EMAIL_SITE_URL}/img/email/${s.icon}" width="38" height="38" alt="FF Beacon on ${esc(s.label)}" style="display:block;border:0;outline:none;text-decoration:none;width:38px;height:38px;" />
          </a>
        </td>`,
  ).join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
      <tr>${cells}</tr>
    </table>`;
}

/**
 * Wrap inner HTML in the full branded shell. `preheader` is the hidden inbox
 * preview line. `innerHtml` should be table-cell-safe HTML (paragraphs, tables).
 */
export function buildBrandedEmail(opts: {
  title: string;
  preheader: string;
  innerHtml: string;
  textBody: string;
}): { html: string; text: string } {
  // Logo with its black circle baked into the PNG. Gmail dark mode never recolors
  // images, so the mark always renders as the intended badge.
  const logo = `${EMAIL_SITE_URL}/img/ff-beacon-logo-email.png`;

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${esc(opts.title)}</title>
  <style>
    :root { color-scheme: light; supported-color-schemes: light; }
    body { margin:0; padding:0; width:100% !important; background-color:${C.pageBg}; }
    a { color:${C.purple}; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${C.pageBg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.pageBg};font-size:1px;line-height:1px;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.pageBg}" style="background-color:${C.pageBg};">
    <tr>
      <td align="center" bgcolor="${C.pageBg}" style="background-color:${C.pageBg};padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          <!-- Header / brand -->
          <tr>
            <td align="center" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.line};border-bottom:none;border-radius:16px 16px 0 0;padding:32px 24px 22px;">
              <img src="${logo}" width="78" alt="FF Beacon" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;width:78px;height:auto;" />
              <div style="height:5px;width:104px;margin:18px auto 0;border-radius:999px;background-color:${C.purpleBright};background-image:linear-gradient(135deg,${C.purpleBright} 0%,${C.cyan} 100%);"></div>
              <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-style:italic;color:${C.inkSubtle};">${esc(EMAIL_TAGLINE)}</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td bgcolor="${C.card}" style="background-color:${C.card};border-left:1px solid ${C.line};border-right:1px solid ${C.line};padding:6px 32px 30px;">
              ${opts.innerHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.line};border-top:none;border-radius:0 0 16px 16px;padding:8px 24px 30px;">
              <div style="height:1px;line-height:1px;font-size:1px;background-color:${C.line};margin:0 0 22px;">&nbsp;</div>
              ${socialRow()}
              <p style="margin:18px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;">
                <a href="${EMAIL_SITE_URL}" target="_blank" style="color:${C.purple};text-decoration:none;font-weight:bold;">ffbeacon.com</a>
              </p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${C.inkSubtle};">
                ${esc(EMAIL_TAGLINE)}<br />
                &copy; ${new Date().getFullYear()} FF Beacon. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${opts.textBody.trim()}

FF Beacon
${EMAIL_TAGLINE}
${EMAIL_SITE_URL}
Discord: ${EMAIL_DISCORD_URL}`;

  return { html, text };
}

/** A standard body paragraph. */
export function emailParagraph(html: string): string {
  return `<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${C.inkBody};">${html}</p>`;
}

/** A body heading. */
export function emailHeading(text: string): string {
  return `<h1 style="margin:22px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:${C.ink};">${esc(text)}</h1>`;
}

/**
 * A numbered step list (badge + title + body + link). `body` is raw HTML so a step
 * can include an inline link; pass only trusted static copy there. `title` and
 * `linkLabel` are escaped.
 */
export function emailStepList(
  steps: Array<{ title: string; body: string; linkLabel: string; href: string }>,
): string {
  return steps
    .map(
      (s, i) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;">
      <tr>
        <td valign="top" width="42" style="width:42px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" valign="middle" width="30" height="30" bgcolor="${C.purple}" style="width:30px;height:30px;border-radius:15px;background-color:${C.purple};color:${C.white};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:30px;">${i + 1}</td>
            </tr>
          </table>
        </td>
        <td valign="top">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:${C.ink};">${esc(s.title)}</p>
          <p style="margin:5px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${C.inkBody};">${s.body}</p>
          <p style="margin:7px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;"><a href="${esc(s.href)}" target="_blank" style="color:${C.purple};font-weight:bold;text-decoration:none;">${esc(s.linkLabel)}</a></p>
        </td>
      </tr>
    </table>`,
    )
    .join("");
}

/** A tinted "quote" card with a purple accent rule, echoing the visitor's input. */
export function emailQuoteCard(rows: Array<{ label: string; value: string }>): string {
  const body = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:11px 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;color:${C.purple};">${esc(r.label)}</td>
      </tr>
      <tr>
        <td style="padding:3px 18px 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:${C.ink};">${esc(r.value)}</td>
      </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.quoteBg}" style="margin:20px 0 0;background-color:${C.quoteBg};border:1px solid ${C.line};border-left:4px solid ${C.purpleBright};border-radius:10px;">
      ${body}
    </table>`;
}
