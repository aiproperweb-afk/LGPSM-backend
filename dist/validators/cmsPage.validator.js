"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsPublishBodySchema = exports.cmsDraftBodySchema = exports.cmsPageSeedSchema = exports.supportedCmsSlugs = exports.MAX_CMS_PAYLOAD_BYTES = void 0;
exports.withoutRetiredCmsSections = withoutRetiredCmsSections;
exports.supportsPageContract = supportsPageContract;
exports.isWorkspaceCmsPage = isWorkspaceCmsPage;
exports.validatePuckData = validatePuckData;
exports.validateCmsSeedInput = validateCmsSeedInput;
const zod_1 = require("zod");
const cms_pages_v1_json_1 = __importDefault(require("./cms-pages.v1.json"));
exports.MAX_CMS_PAYLOAD_BYTES = 90 * 1024;
const MAX_TEXT_LENGTH = 4000;
const contracts = new Map(cms_pages_v1_json_1.default.map(page => [page.slug, page]));
exports.supportedCmsSlugs = [...contracts.keys()];
function withoutRetiredCmsSections(data, slug) {
    if (slug !== 'home' || !data || typeof data !== 'object' || !('content' in data) || !Array.isArray(data.content))
        return data;
    const content = data.content.filter(section => section?.type !== 'Testimonials');
    return content.length === data.content.length ? data : { ...data, content };
}
function supportsPageContract(slug, route, schemaVersion) {
    const contract = contracts.get(slug);
    return contract?.route === route && contract.schemaVersion === schemaVersion;
}
const approvedLinks = new Set(['/signup', '/contact', '/#how-it-works', '/#features', '/#pricing', '/#faq']);
const slugSchema = zod_1.z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, numbers and hyphens');
function isWorkspaceCmsPage(slug) {
    return exports.supportedCmsSlugs.includes(slug) && slug.startsWith('workspace-');
}
const routeSchema = zod_1.z.string().trim().min(1).max(200).regex(/^\/(?:[A-Za-z0-9_-]+|\[id\])?(?:\/(?:[A-Za-z0-9_-]+|\[id\]))*$/, 'Route must be a local path without query strings');
exports.cmsPageSeedSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    slug: slugSchema,
    route: routeSchema,
    schemaVersion: zod_1.z.literal(1),
    data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    componentStructureLocked: zod_1.z.boolean().optional().default(false)
}).strict();
exports.cmsDraftBodySchema = zod_1.z.object({ data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()) }).strict();
exports.cmsPublishBodySchema = exports.cmsDraftBodySchema;
function fail(path, message) {
    throw { statusCode: 400, code: 'CMS_CONTENT_INVALID', message: `${path}: ${message}` };
}
function safeText(value, path, maxLength = MAX_TEXT_LENGTH) {
    if (typeof value !== 'string' || value.length > maxLength)
        fail(path, `must be text up to ${maxLength} characters`);
    if (/<\s*(?:\/?\s*[a-z][^>]*>|[!?])|javascript\s*:|vbscript\s*:|data\s*:/i.test(value)) {
        fail(path, 'HTML and executable content are not allowed');
    }
}
function object(value, path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        fail(path, 'must be an object');
    return value;
}
function exact(value, keys, path) {
    const record = object(value, path);
    if (Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) {
        fail(path, 'contains missing or unsupported properties');
    }
    return record;
}
function fields(value, sample, path, ids, key = '', optionalImage = false) {
    if (typeof sample === 'string') {
        safeText(value, path);
        if (key.endsWith('Href') && !approvedLinks.has(value))
            fail(path, 'destination is not approved');
        if (key === 'image') {
            if (optionalImage && value === '')
                return;
            if (/^media:[0-9a-fA-F]{24}$/.test(value))
                ids.add(value.slice(6).toLowerCase());
            else if (!/^\/images\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(value))
                fail(path, 'image reference is not approved');
        }
        return;
    }
    if (Array.isArray(sample)) {
        if (!Array.isArray(value))
            fail(path, 'must be an array');
        if (key === 'bullets') {
            if (value.length > 20)
                fail(path, 'maximum 20 bullets');
            value.forEach((item, index) => safeText(item, path + '[' + index + ']'));
        }
        else {
            if (value.length !== sample.length)
                fail(path, 'item count is fixed');
            sample.forEach((item, index) => fields(value[index], item, path + '[' + index + ']', ids, '', key === 'steps'));
        }
        return;
    }
    const defaults = object(sample, path);
    const record = exact(value, Object.keys(defaults), path);
    for (const [name, item] of Object.entries(defaults)) {
        if (key === 'labels')
            safeText(record[name], path + '.' + name);
        else
            fields(record[name], item, path + '.' + name, ids, name, optionalImage);
    }
}
function validatePuckData(input, slug) {
    const contract = contracts.get(slug);
    if (!contract)
        fail('data', 'page contract is unsupported');
    const data = object(input, 'data');
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > exports.MAX_CMS_PAYLOAD_BYTES)
        fail('data', 'payload exceeds maximum size');
    exact(data, data.zones === undefined ? ['root', 'content'] : ['root', 'content', 'zones'], 'data');
    exact(exact(data.root, ['props'], 'data.root').props, [], 'data.root.props');
    if (data.zones !== undefined)
        exact(data.zones, [], 'data.zones');
    const content = data.content;
    if (!Array.isArray(content) || content.length !== contract.data.content.length)
        fail('data.content', 'page section count is fixed');
    const mediaIds = new Set();
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
    return { data: data, mediaIds: [...mediaIds], structure: JSON.stringify(structure) };
}
function validateCmsSeedInput(input) {
    const parsed = exports.cmsPageSeedSchema.safeParse(input);
    if (!parsed.success || !supportsPageContract(parsed.data.slug, parsed.data.route, parsed.data.schemaVersion) || !parsed.data.componentStructureLocked) {
        throw { statusCode: 400, code: 'CMS_SEED_INVALID', message: 'Expected a supported fixed-layout v1 page.' };
    }
    const validated = validatePuckData(parsed.data.data, parsed.data.slug);
    return { ...parsed.data, data: validated.data, mediaIds: validated.mediaIds };
}
