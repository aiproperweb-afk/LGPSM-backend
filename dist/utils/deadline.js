"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deadlineLabel = deadlineLabel;
const env_1 = require("../config/env");
/** "31 Dec 2026, 4:00 PM" in the platform's time zone: how a payment deadline is written to people */
function deadlineLabel(date) {
    const d = date ? new Date(date) : null;
    if (!d || Number.isNaN(d.getTime()))
        return 'the event ends';
    return new Intl.DateTimeFormat('en-GB', { timeZone: env_1.env.APP_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/[  ]/g, ' ');
}
