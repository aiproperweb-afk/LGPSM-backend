import { Role } from '../models/User';
import { smsService } from '../services/sms.service';

// An organizer account an administrator creates is not yet proved to belong to anyone: its owner verifies the email address and the
// mobile number from Account Settings before creating events or sending invitations. Accounts people sign up for themselves are verified
// during sign-up, and accounts from before this rule are left as they are.

export interface VerificationPending { email: boolean; phone: boolean }

/** What this account still has to verify, or null when nothing. The mobile number is only asked for while text messages can be sent. */
export function verificationPending(user: { role?: string; adminCreated?: boolean; emailConfirmedAt?: Date | null; isPhoneVerified?: boolean } | null | undefined): VerificationPending | null {
  if (!user || user.role !== Role.ORGANIZER || !user.adminCreated) return null;
  const pending = { email: !user.emailConfirmedAt, phone: !user.isPhoneVerified && smsService.isConfigured() };
  return pending.email || pending.phone ? pending : null;
}

export const verificationMessage = (pending: VerificationPending): string =>
  `Verify your ${[pending.email ? 'email address' : '', pending.phone ? 'mobile number' : ''].filter(Boolean).join(' and ')} in Account Settings before creating events or sending invitations.`;
