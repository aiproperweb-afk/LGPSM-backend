/**
 * Text messages (one-time codes). The provider is chosen with SMS_PROVIDER:
 *   msg91   MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID  (a DLT-approved OTP template that has the ##OTP## variable)
 *   twilio  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID
 *   console development only: the code is written to the server log instead of being sent
 * Without a complete configuration nothing is sent and mobile numbers simply stay unverified.
 */
export type SmsProvider = 'msg91' | 'twilio' | 'console';

const TIMEOUT_MS = 15_000;
const value = (name: string) => (process.env[name] || '').trim();

function provider(): SmsProvider | null {
  switch (value('SMS_PROVIDER').toLowerCase()) {
    case 'msg91':
      return value('MSG91_AUTH_KEY') && value('MSG91_OTP_TEMPLATE_ID') ? 'msg91' : null;
    case 'twilio':
      return value('TWILIO_ACCOUNT_SID') && value('TWILIO_AUTH_TOKEN') && (value('TWILIO_FROM_NUMBER') || value('TWILIO_MESSAGING_SERVICE_SID')) ? 'twilio' : null;
    case 'console':
      return process.env.NODE_ENV === 'production' ? null : 'console';
    default:
      return null;
  }
}

// only the provider's status and short reason are logged, never the code or our key
const failed = (name: string, detail: string): never => {
  console.error(`SMS delivery error (${name}):`, detail.slice(0, 200));
  throw new Error('FAILED_TO_SEND_SMS');
};

async function viaMsg91(phone: string, code: string) {
  const query = new URLSearchParams({ template_id: value('MSG91_OTP_TEMPLATE_ID'), mobile: phone, otp: code, otp_expiry: '10' });
  const res = await fetch(`https://control.msg91.com/api/v5/otp?${query}`, {
    method: 'POST',
    headers: { authkey: value('MSG91_AUTH_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // MSG91 answers 200 with {"type":"error"} for a refused request
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.type !== 'success') failed('msg91', `${res.status} ${body?.message ?? ''}`);
}

async function viaTwilio(phone: string, code: string) {
  const sid = value('TWILIO_ACCOUNT_SID');
  const form = new URLSearchParams({ To: `+${phone}`, Body: `Your EventQRapp verification code is ${code}. It expires in 10 minutes. Do not share it.` });
  if (value('TWILIO_MESSAGING_SERVICE_SID')) form.set('MessagingServiceSid', value('TWILIO_MESSAGING_SERVICE_SID'));
  else form.set('From', value('TWILIO_FROM_NUMBER'));
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${value('TWILIO_AUTH_TOKEN')}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    failed('twilio', `${res.status} ${body?.code ?? ''} ${body?.message ?? ''}`);
  }
}

export const smsService = {
  isConfigured: (): boolean => provider() !== null,

  /** Sends a one-time code to a normalised number (country code, digits only). Throws when it could not be handed to the provider. */
  async sendOtp(phone: string, code: string): Promise<void> {
    const chosen = provider();
    if (!chosen) throw new Error('SMS_NOT_CONFIGURED');
    if (chosen === 'console') {
      console.log(`[sms:console] code for ${phone}: ${code}`);
      return;
    }
    try {
      await (chosen === 'msg91' ? viaMsg91(phone, code) : viaTwilio(phone, code));
    } catch (error) {
      if (error instanceof Error && error.message === 'FAILED_TO_SEND_SMS') throw error;
      failed(chosen, error instanceof Error ? error.message : 'unknown error');
    }
  },
};
