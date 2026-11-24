import { env } from '../config/env';

/**
 * The address in front of this API's public files (card, QR and icons in emails), with no trailing slash, or null when it is not known.
 * PUBLIC_API_URL when set; otherwise the address Render gives every web service (RENDER_EXTERNAL_URL); otherwise, for a real https site,
 * `api.` in front of the website's own domain (FRONTEND_URL), which is where the apps already reach this API. A mail service used over
 * HTTPS can only show an image it can load from a public address, so without one the card and icons would be missing from the email.
 */
export const publicApiUrl = (): string | null => {
  const explicit = (env.PUBLIC_API_URL || process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(explicit)) return explicit;
  try {
    const site = new URL((env.FRONTEND_URL || process.env.FRONTEND_URL || '').trim());
    const host = site.hostname.replace(/^www\./i, '');
    if (site.protocol === 'https:' && host.includes('.') && !/^(localhost|127\.|\d+\.\d+\.\d+\.\d+$)/i.test(host)) return `https://api.${host}`;
  } catch {
    // no usable website address: images cannot be linked
  }
  return null;
};
