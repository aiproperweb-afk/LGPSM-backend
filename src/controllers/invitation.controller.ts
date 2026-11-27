import { Request, Response } from 'express';
import { invitationService } from '../services/invitation.service';
import { DeliveryChannel } from '../models/Invitation';
import { shapePreview } from '../utils/previewImage';
import { pageParams } from '../utils/query';

// Per-guest outcome counts for a send or resend ("All" delivery skips guests with no usable contact)
const deliverySummary = (results: { status: string }[]) => ({
  sent: results.filter((r) => r.status === 'SENT').length,
  failed: results.filter((r) => r.status === 'FAILED').length,
  skipped: results.filter((r) => r.status === 'SKIPPED').length,
});

const paymentRequired = (req: Request, res: Response) => res.status(402).json({
  success: false, error: 'Payment Required', code: 'PAYMENT_REQUIRED',
  message: (req as any).user?.role === 'ADMIN'
    ? 'The organizer has to pay for these WhatsApp invitations first. Nothing was sent.'
    : 'Please pay the bill for these WhatsApp invitations first. Nothing was sent.'
});

export const invitationController = {
  async sendInvitations(req: Request, res: Response) {
    try {
      const eventId = req.params.eventId as string;
      const { inviteeIds, channel, channels } = req.body;
      const user = {
        userId: (req as any).user?.userId,
        role: (req as any).user?.role
      };

      let selectedChannel: DeliveryChannel = channel;
      if (!selectedChannel && Array.isArray(channels)) {
        const hasEmail = channels.includes('EMAIL');
        const hasWhatsApp = channels.includes('WHATSAPP');
        if (hasEmail && hasWhatsApp) {
          selectedChannel = DeliveryChannel.BOTH;
        } else if (hasWhatsApp) {
          selectedChannel = DeliveryChannel.WHATSAPP;
        } else if (hasEmail) {
          selectedChannel = DeliveryChannel.EMAIL;
        }
      }

      if (req.body.payLater && user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Only an administrator can choose Pay Later.' });
      const results = await invitationService.sendInvitations(eventId, user, inviteeIds, selectedChannel || DeliveryChannel.EMAIL, { payLater: req.body.payLater === true });
      return res.status(200).json({ success: true, message: 'Invitations processed successfully', results, summary: deliverySummary(results) });
    } catch (error: any) {
      if (error.message === 'EVENT_NOT_FOUND') return res.status(404).json({ error: 'Not Found', message: 'Event not found or access denied' });
      if (error.message === 'PAYMENT_REQUIRED') return paymentRequired(req, res);
      if (error.message === 'PRINT_ONLY_EVENT') return res.status(409).json({ success: false, error: 'Conflict', code: 'PRINT_ONLY_EVENT', message: 'This event is set to print only, so its cards are downloaded, not sent. Use Download Invitee Cards.' });
      if (error.message === 'EVENT_CANCELLED') return res.status(409).json({ success: false, error: 'Conflict', code: 'EVENT_CANCELLED', message: 'This event has been cancelled. Invitations can no longer be sent.' });
      if (error.message === 'EVENT_ENDED') return res.status(409).json({ success: false, error: 'Conflict', code: 'EVENT_ENDED', message: 'This event is over, so invitations can no longer be sent.' });
      if (error.message === 'INVALID_INVITEES') return res.status(400).json({ error: 'Bad Request', message: 'One or more invitees do not belong to this event' });
      console.error('Request failed:', error?.message);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong. Please try again.' });
    }
  },

  async resendInvitations(req: Request, res: Response) {
    try {
      const eventId = req.params.eventId as string;
      const { invitationIds, channel } = req.body;
      const user = {
        userId: (req as any).user?.userId,
        role: (req as any).user?.role
      };

      if (req.body.payLater && user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Only an administrator can choose Pay Later.' });
      const results = await invitationService.resendInvitations(eventId, user, invitationIds, channel, { payLater: req.body.payLater === true });
      return res.status(200).json({ success: true, message: 'Invitations resent successfully', results, summary: deliverySummary(results) });
    } catch (error: any) {
      if (error.message === 'EVENT_NOT_FOUND') return res.status(404).json({ error: 'Not Found', message: 'Event not found or access denied' });
      if (error.message === 'PRINT_ONLY_EVENT') return res.status(409).json({ success: false, error: 'Conflict', code: 'PRINT_ONLY_EVENT', message: 'This event is set to print only, so its cards are downloaded, not sent. Use Download Invitee Cards.' });
      if (error.message === 'EVENT_CANCELLED') return res.status(409).json({ success: false, error: 'Conflict', code: 'EVENT_CANCELLED', message: 'This event has been cancelled. Invitations can no longer be sent.' });
      if (error.message === 'EVENT_ENDED') return res.status(409).json({ success: false, error: 'Conflict', code: 'EVENT_ENDED', message: 'This event is over, so invitations can no longer be sent.' });
      if (error.message === 'PAYMENT_REQUIRED') return paymentRequired(req, res);
      if (error.message === 'INVALID_INVITATIONS') return res.status(400).json({ error: 'Bad Request', message: 'One or more invitations do not belong to this event' });
      console.error('Request failed:', error?.message);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong. Please try again.' });
    }
  },

  async getInvitations(req: Request, res: Response) {
    try {
      const eventId = req.params.eventId as string;
      const user = {
        userId: (req as any).user?.userId,
        role: (req as any).user?.role
      };
      const { page, limit } = pageParams(req.query, { limit: 20, max: 200 });

      const data = await invitationService.getInvitations(eventId, user, page, limit);
      return res.status(200).json(data);
    } catch (error: any) {
      if (error.message === 'EVENT_NOT_FOUND') return res.status(404).json({ error: 'Not Found', message: 'Event not found or access denied' });
      console.error('Request failed:', error?.message);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong. Please try again.' });
    }
  },

  async clearHistory(req: Request, res: Response) {
    try {
      const eventId = req.params.eventId as string;
      const user = {
        userId: (req as any).user?.userId,
        role: (req as any).user?.role
      };
      const data = await invitationService.clearHistory(eventId, user);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.message === 'EVENT_NOT_FOUND') return res.status(404).json({ error: 'Not Found', message: 'Event not found or access denied' });
      console.error('Request failed:', error?.message);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong. Please try again.' });
    }
  },

  async previewInvitationCard(req: Request, res: Response) {
    try {
      const eventId = req.params.eventId as string;
      const inviteeId = typeof req.query.inviteeId === 'string' ? req.query.inviteeId : undefined;
      const user = {
        userId: (req as any).user?.userId,
        role: (req as any).user?.role
      };

      const { png: pngBuffer, qr } = await invitationService.previewInvitationCard(eventId, user, inviteeId);
      const shaped = await shapePreview(pngBuffer, req.query);
      res.setHeader('Content-Type', shaped.contentType);
      // ISSUED: the QR is the guest's current check-in pass; SAMPLE: placeholder, not valid for check-in
      res.setHeader('X-Invitation-Qr', qr);
      // A sample card is asked for again each time (unchanged ones answer "not modified"), so an edited event never shows its old card;
      // a guest's own pass is never kept at all
      res.setHeader('Cache-Control', qr === 'SAMPLE' ? 'private, no-cache' : 'private, no-store');
      res.setHeader('Content-Disposition', `inline; filename="invitation-card-preview.${shaped.contentType === 'image/webp' ? 'webp' : 'png'}"`);
      return res.status(200).send(shaped.body);
    } catch (error: any) {
      if (error.message === 'EVENT_NOT_FOUND') return res.status(404).json({ error: 'Not Found', message: 'Event not found' });
      console.error('Request failed:', error?.message);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong. Please try again.' });
    }
  }
};

