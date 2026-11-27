"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const database_1 = __importDefault(require("../config/database"));
const cmsPage_service_1 = require("../services/cmsPage.service");
const mongoose_1 = __importDefault(require("mongoose"));
const Page_1 = require("../models/Page");
async function run() {
    const file = process.argv[2];
    if (!file)
        throw new Error('Provide a JSON seed file: pnpm seed:cms <path-to-pages.json>');
    const absolutePath = path_1.default.resolve(process.cwd(), file);
    const parsed = JSON.parse(fs_1.default.readFileSync(absolutePath, 'utf8'));
    if (!Array.isArray(parsed))
        throw new Error('The CMS seed file must contain a JSON array of populated pages.');
    await (0, database_1.default)();
    await Page_1.Page.createIndexes();
    const results = await cmsPage_service_1.cmsPageService.seedPages(parsed);
    for (const result of results) {
        console.log(`${result.inserted ? 'Seeded' : 'Kept existing'} CMS page: ${result.slug}`);
    }
}
run()
    .catch((error) => {
    console.error('CMS page seeding failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
})
    .finally(async () => {
    await mongoose_1.default.disconnect();
});
