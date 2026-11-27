import fs from 'fs';
import path from 'path';
import connectDatabase from '../config/database';
import { cmsPageService } from '../services/cmsPage.service';
import mongoose from 'mongoose';
import { Page } from '../models/Page';

async function run() {
  const file = process.argv[2];
  if (!file) throw new Error('Provide a JSON seed file: pnpm seed:cms <path-to-pages.json>');
  const absolutePath = path.resolve(process.cwd(), file);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('The CMS seed file must contain a JSON array of populated pages.');

  await connectDatabase();
  await Page.createIndexes();
  const results = await cmsPageService.seedPages(parsed);
  for (const result of results) {
    console.log(`${result.inserted ? 'Seeded' : 'Kept existing'} CMS page: ${result.slug}`);
  }
}

run()
  .catch((error: unknown) => {
    console.error('CMS page seeding failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
