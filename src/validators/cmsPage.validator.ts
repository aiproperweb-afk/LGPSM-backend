import { z } from 'zod';

import seed from './cms-pages.v1.json';

export const MAX_CMS_PAYLOAD_BYTES = 90 * 1024;
const MAX_TEXT_LENGTH = 4000;

const contracts = new Map(seed.map(page => [page.slug, page]));

export const supportedCmsSlugs = [...contracts.keys()];
export const editableCmsSlugs = seed.filter(page => page.editable !== false).map(page => page.slug);

export function supportsPageContract(slug: string, route: string, schemaVersion: number) {
  const contract = contracts.get(slug);
  return contract?.route === route && contract.schemaVersion === schemaVersion;
}
const approvedLinks = new Set(['/signup', '/contact', '/#how-it-works', '/#features', '/#pricing', '/#faq']);

const slugSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, numbers and hyphens');
const routeSchema = z.string().trim().min(1).max(200).regex(/^\/(?:(?:[A-Za-z0-9_-]+|\[id\])(?:\/(?:[A-Za-z0-9_-]+|\[id\]))*|#(?:navbar|footer))?$/, 'Route must be a local path without query strings');

export const cmsPageSeedSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  route: routeSchema,
  schemaVersion: z.literal(1),
  editable: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()),
  componentStructureLocked: z.boolean().optional().default(false)
}).strict();

export const cmsDraftBodySchema = z.object({ data: z.record(z.string(), z.unknown()) }).strict();
export const cmsPublishBodySchema = cmsDraftBodySchema;

export type PuckData = Record<string, unknown> & {
  root: { props: Record<string, unknown> };
  content: { type: string; props: Record<string, unknown> & { id: string } }[];
  zones?: Record<string, unknown[]>;
};

function fail(path: string, message: string): never {
  throw { statusCode: 400, code: 'CMS_CONTENT_INVALID', message: `${path}: ${message}` };
}

function safeText(value: unknown, path: string, maxLength = MAX_TEXT_LENGTH): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength) fail(path, `must be text up to ${maxLength} characters`);
  if (/<\s*(?:\/?\s*[a-z][^>]*>|[!?])|javascript\s*:|vbscript\s*:|data\s*:/i.test(value)) {
    fail(path, 'HTML and executable content are not allowed');
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: string[], path: string) {
  const record = object(value, path);
  if (Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) {
    fail(path, 'contains missing or unsupported properties');
  }
  return record;
}

function fields(value: unknown, sample: unknown, path: string, ids: Set<string>, key = '', optionalImage = false): void {
  if (typeof sample === 'string') {
    safeText(value, path);
    if (key.endsWith('Href') && !approvedLinks.has(value)) fail(path, 'destination is not approved');
    if (key === 'image' || key.endsWith('Image')) {
      if ((optionalImage || sample === '') && value === '') return;
      if (/^media:[0-9a-fA-F]{24}$/.test(value)) ids.add(value.slice(6).toLowerCase());
      else if (!/^\/images\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(value)) fail(path, 'image reference is not approved');
    }
    return;
  }
  if (Array.isArray(sample)) {
    if (!Array.isArray(value)) fail(path, 'must be an array');
    if (key === 'bullets') {
      if (value.length > 20) fail(path, 'maximum 20 bullets');
      value.forEach((item, index) => safeText(item, path + '[' + index + ']'));
    } else {
      if (value.length !== sample.length) fail(path, 'item count is fixed');
      sample.forEach((item, index) => fields(value[index], item, path + '[' + index + ']', ids, '', key === 'steps'));
    }
    return;
  }
  const defaults = object(sample, path);
  const record = exact(value, Object.keys(defaults), path);
  for (const [name, item] of Object.entries(defaults)) {
    if (key === 'labels') safeText(record[name], path + '.' + name);
    else fields(record[name], item, path + '.' + name, ids, name, optionalImage);
  }
}

export function validatePuckData(input: unknown, slug: string): { data: PuckData; mediaIds: string[]; structure: string } {
  const contract = contracts.get(slug);
  if (!contract) fail('data', 'page contract is unsupported');
  const data = object(input, 'data');
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_CMS_PAYLOAD_BYTES) fail('data', 'payload exceeds maximum size');
  exact(data, data.zones === undefined ? ['root', 'content'] : ['root', 'content', 'zones'], 'data');
  exact(exact(data.root, ['props'], 'data.root').props, [], 'data.root.props');
  if (data.zones !== undefined) exact(data.zones, [], 'data.zones');
  let content = data.content;
  if (slug === 'home' && Array.isArray(content) && content.length === contract.data.content.length - 1) {
    const index = contract.data.content.findIndex(section => section.type === 'Testimonials');
    // Legacy Home snapshots predate testimonials. Compare them using the same fixed section order.
    content = [...content.slice(0, index), contract.data.content[index], ...content.slice(index)];
  }
  if (!Array.isArray(content) || content.length !== contract.data.content.length) fail('data.content', 'page section count is fixed');
  const mediaIds = new Set<string>();
  const structure = contract.data.content.map((section, index) => {
    const path = 'data.content[' + index + ']';
    const item = exact(content[index], ['type', 'props'], path);
    const props = object(item.props, path + '.props');
    if (item.type !== section.type || props.id !== section.props.id) {
      fail(path, 'section type, id and ordering are fixed');
    }
    fields(props, section.props, path + '.props', mediaIds);
    return section.type;
  });
  return { data: data as PuckData, mediaIds: [...mediaIds], structure: JSON.stringify(structure) };
}

export function validateCmsSeedInput(input: unknown) {
  const parsed = cmsPageSeedSchema.safeParse(input);
  if (!parsed.success || !supportsPageContract(parsed.data.slug, parsed.data.route, parsed.data.schemaVersion) || !parsed.data.componentStructureLocked) {
    throw { statusCode: 400, code: 'CMS_SEED_INVALID', message: 'Expected a supported fixed-layout v1 page.' };
  }
  const validated = validatePuckData(parsed.data.data, parsed.data.slug);
  return { ...parsed.data, data: validated.data, mediaIds: validated.mediaIds };
}
