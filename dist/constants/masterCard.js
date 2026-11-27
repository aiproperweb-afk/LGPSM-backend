"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHARED_UPLOAD_FILTER = void 0;
exports.masterCardOnly = masterCardOnly;
exports.isSharedUpload = isSharedUpload;
/**
 * "Master card only" mode: the shared designs are the master card and the cards made since for particular event types
 * (services/cardTemplates/themes.ts). The designs from before the master card are not listed or drawn: an event made with one gets the
 * master card. Nothing was deleted: set MASTER_CARD_ONLY=false in the environment to bring them back. (The automated tests keep the full
 * set of designs unless a test turns the mode on with MASTER_CARD_ONLY=true.)
 */
function masterCardOnly() {
    const v = process.env.MASTER_CARD_ONLY;
    if (v === 'true')
        return true;
    if (v === 'false')
        return false;
    return process.env.NODE_ENV !== 'test';
}
/**
 * A design an administrator uploaded and published for everyone (its wording is replaced by each event's details). It is offered in
 * "master card only" mode too: that mode retires the older built-in designs, not the cards the administrator adds.
 */
exports.SHARED_UPLOAD_FILTER = { cardDesign: 'CUSTOM', isSystemTemplate: true, isPublished: true, 'templateData.dynamicDetails': true };
function isSharedUpload(template) {
    return !!template && template.cardDesign === 'CUSTOM' && template.isSystemTemplate === true && template.isPublished === true && template.templateData?.dynamicDetails === true;
}
