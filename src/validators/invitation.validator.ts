import { z } from 'zod';
import { DeliveryChannel } from '../models/Invitation';

export const sendInvitationSchema = z.object({
  body: z.object({
    inviteeIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid invitee ID format')).min(1, 'At least one inviteeId is required').max(5000, 'Too many guests in one request'),
    channel: z.nativeEnum(DeliveryChannel).optional(),
    channels: z.array(z.nativeEnum(DeliveryChannel)).optional(),
    // administrator only: send on WhatsApp now, the organizer pays by the event's end
    payLater: z.boolean().optional()
  }).refine((data) => !!data.channel || (!!data.channels && data.channels.length > 0), {
    message: 'Either channel or channels must be provided',
    path: ['channel']
  })
});

export const resendInvitationSchema = z.object({
  body: z.object({
    invitationIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid invitation ID format')).min(1, 'At least one invitationId is required').max(5000, 'Too many guests in one request'),
    channel: z.nativeEnum(DeliveryChannel).optional(),
    payLater: z.boolean().optional()
  })
});

