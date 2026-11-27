"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.masterCardOnly = masterCardOnly;
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
