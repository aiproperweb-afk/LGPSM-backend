"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactController = void 0;
const contactBuilderSubmission_1 = require("../services/contactBuilderSubmission");
const contact_service_1 = require("../services/contact.service");
const RECEIVED_MESSAGE = 'Thanks — your message has been received. We will get back to you soon.';
exports.contactController = {
    // POST /api/v1/public/contact
    async submit(req, res) {
        // Honeypot filled in: an automated form-filler. Answer like a success but store and notify nothing.
        if (typeof req.body.website === 'string' && req.body.website.trim() !== '') {
            return res.status(200).json({
                success: true,
                message: RECEIVED_MESSAGE,
                data: { status: 'NEW', receivedAt: new Date().toISOString(), duplicate: false }
            });
        }
        try {
            const { name, email, phone, message, formId } = req.body;
            const details = await (0, contactBuilderSubmission_1.validatePublishedContactForm)(req.body);
            if (details.errors)
                return res.status(400).json({ success: false, message: 'Check the form fields and try again.', fieldErrors: details.errors });
            const receipt = await contact_service_1.contactService.submit({ name, email, phone, message, formId, customFields: details.fields }, { ip: req.ip, userAgent: req.get('user-agent') || undefined });
            return res.status(receipt.duplicate ? 200 : 201).json({
                success: true,
                message: RECEIVED_MESSAGE,
                data: {
                    id: receipt.id,
                    status: receipt.status,
                    receivedAt: receipt.receivedAt.toISOString(),
                    duplicate: receipt.duplicate
                }
            });
        }
        catch (error) {
            console.error('Contact submission failed:', error?.message || error);
            return res.status(500).json({
                success: false,
                error: 'Internal Server Error',
                message: 'We could not save your message right now. Please try again in a moment.'
            });
        }
    }
};
