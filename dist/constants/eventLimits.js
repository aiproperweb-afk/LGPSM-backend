"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOOD_OPTION_MAX_LENGTH = exports.FOOD_TITLE_MAX_LENGTH = exports.EVENT_LOCATION_MAX_LENGTH = exports.EVENT_DESCRIPTION_MAX_LENGTH = exports.EVENT_TITLE_MAX_LENGTH = void 0;
// Event copy has to fit every invitation card design (the web forms count down from the same numbers).
// The Event model keeps its looser 100-character title cap so older, longer titles still load.
exports.EVENT_TITLE_MAX_LENGTH = 50;
exports.EVENT_DESCRIPTION_MAX_LENGTH = 180;
exports.EVENT_LOCATION_MAX_LENGTH = 50;
// Food preference questions and their choices: short enough to read in the invitee list and on the invitation page
exports.FOOD_TITLE_MAX_LENGTH = 40;
exports.FOOD_OPTION_MAX_LENGTH = 30;
