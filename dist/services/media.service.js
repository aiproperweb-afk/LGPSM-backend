"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaService = exports.MediaService = exports.MAX_UPLOAD_BYTES = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const sharp_1 = __importDefault(require("sharp"));
const s3_config_1 = __importDefault(require("../config/s3.config"));
const env_1 = require("../config/env");
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const os_1 = require("os");
const mongoose_1 = __importDefault(require("mongoose"));
const Media_1 = require("../models/Media");
const mediaStorage_1 = require("./mediaStorage");
exports.MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Longest edge kept per purpose; larger images are downscaled before storing
const MAX_EDGE = {
    [Media_1.MediaPurpose.TEMPLATE]: 1600,
    [Media_1.MediaPurpose.EVENT_LOGO]: 800,
    [Media_1.MediaPurpose.ORGANIZATION_LOGO]: 800,
    [Media_1.MediaPurpose.AVATAR]: 512,
    [Media_1.MediaPurpose.CMS_PAGE]: 1600
};
function isWithin(directory, parent) {
    const relative = path_1.default.relative(parent, directory);
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path_1.default.sep) && !path_1.default.isAbsolute(relative));
}
function requireCmsDiskStorage() {
    const directory = (0, mediaStorage_1.mediaDir)();
    const configuredPath = (process.env.MEDIA_DIR || '').trim();
    const publicBase = (process.env.MEDIA_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    const productionReady = directory && path_1.default.isAbsolute(configuredPath)
        && !isWithin(directory, path_1.default.resolve(__dirname, '../..')) && !isWithin(directory, (0, os_1.tmpdir)())
        && publicBase === 'https://media.eventqrapp.com';
    if (!directory || (env_1.env.NODE_ENV === 'production' && !productionReady)) {
        throw { statusCode: 503, code: 'CMS_MEDIA_STORAGE_UNAVAILABLE', exposeMessage: true,
            message: 'CMS image storage is unavailable. Check the media storage configuration.' };
    }
}
class MediaService {
    async hasCmsImage(id, storage, fileName) {
        return storage === 'DISK' && !!fileName && /^[0-9a-f]{24}$/.test(id)
            && [id + '.jpg', id + '.png'].includes(fileName) && (await (0, mediaStorage_1.readMediaFile)(fileName)) !== null;
    }
    async generatePresignedUrl(fileName, fileType) {
        const bucket = env_1.env.AWS_S3_BUCKET;
        if (!bucket) {
            // Uploads go through /media/upload and are kept in the database; direct-to-S3 upload exists only once a bucket is configured
            throw { statusCode: 503, code: 'STORAGE_NOT_CONFIGURED', exposeMessage: true, message: 'Direct upload to cloud storage is not configured on this server.' };
        }
        // Generate unique key
        const uniqueId = crypto_1.default.randomBytes(16).toString('hex');
        const extension = fileType === 'image/jpeg' ? 'jpg' : 'png';
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileKey = `events/${uniqueId}/${sanitizedFileName}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: fileKey,
            ContentType: fileType,
        });
        // 15 minutes expiration
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3_config_1.default, command, { expiresIn: 900 });
        return { uploadUrl, fileKey };
    }
    // Decodes the upload (rejecting anything that is not a real image), strips metadata, bounds the size
    // and stores a normalized copy. The original bytes are never served back.
    async storeImage(ownerId, purpose, buffer, originalName) {
        const image = (0, sharp_1.default)(buffer, { failOn: 'error', limitInputPixels: 40_000_000 });
        let meta;
        try {
            meta = await image.metadata();
        }
        catch {
            throw { statusCode: 400, message: 'The file is not a valid image' };
        }
        if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) {
            throw { statusCode: 400, message: 'Only JPG, PNG or WEBP images are supported' };
        }
        if (purpose === Media_1.MediaPurpose.CMS_PAGE)
            requireCmsDiskStorage();
        // PNG only when transparency matters; opaque images are far smaller as JPEG
        const keepAlpha = !!meta.hasAlpha;
        const pipeline = image.rotate().resize({ width: MAX_EDGE[purpose], height: MAX_EDGE[purpose], fit: 'inside', withoutEnlargement: true });
        const { data, info } = keepAlpha
            ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
            : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        const contentType = keepAlpha ? 'image/png' : 'image/jpeg';
        const record = { ownerId: new mongoose_1.default.Types.ObjectId(ownerId), purpose, contentType, size: info.size, width: info.width, height: info.height, originalName: originalName?.slice(0, 200) };
        let media;
        if ((0, mediaStorage_1.mediaDir)()) {
            // kept as a file; the database holds only the record. If the record cannot be saved the file is removed again.
            const id = new mongoose_1.default.Types.ObjectId();
            const fileName = await (0, mediaStorage_1.writeMediaFile)(String(id), contentType, data);
            try {
                media = await Media_1.Media.create({ ...record, _id: id, storage: 'DISK', fileName });
            }
            catch (err) {
                await (0, mediaStorage_1.removeMediaFile)(fileName);
                throw err;
            }
        }
        else {
            media = await Media_1.Media.create({ ...record, storage: 'DB', data });
        }
        const publicUrl = media.storage === 'DISK' ? await (0, mediaStorage_1.publicUrlFor)(media.fileName) : null;
        return {
            key: `media:${media._id}`,
            ...(publicUrl ? { publicUrl } : {}),
            contentType: media.contentType,
            width: info.width,
            height: info.height,
            size: info.size
        };
    }
    // The image's bytes wherever they are kept (database or file); null when there is no such image or its file is gone
    // For serving to browsers: the public address of the file when a media address is configured, otherwise the bytes
    async resolveForServing(id, usePublicUrl = true) {
        if (!mongoose_1.default.Types.ObjectId.isValid(id))
            return null;
        const media = await Media_1.Media.findById(id).select('contentType storage fileName purpose');
        if (usePublicUrl && media?.storage === 'DISK') {
            const publicUrl = await (0, mediaStorage_1.publicUrlFor)(media.fileName);
            if (publicUrl)
                return { contentType: media.contentType, publicUrl };
        }
        if (usePublicUrl && media?.storage === 'S3' && media.purpose !== Media_1.MediaPurpose.CMS_PAGE) {
            const publicUrl = this.publicS3Url(media.fileName);
            if (publicUrl)
                return { contentType: media.contentType, publicUrl };
        }
        const image = await this.getImage(id);
        return image ? { contentType: image.contentType, data: image.data } : null;
    }
    async getPublicUrl(id) {
        if (!mongoose_1.default.Types.ObjectId.isValid(id))
            return null;
        const media = await Media_1.Media.findById(id).select('storage fileName purpose');
        if (media?.storage === 'DISK')
            return (0, mediaStorage_1.publicUrlFor)(media.fileName);
        if (media?.storage === 'S3' && media.purpose !== Media_1.MediaPurpose.CMS_PAGE)
            return this.publicS3Url(media.fileName);
        return null;
    }
    async getImage(id) {
        if (!mongoose_1.default.Types.ObjectId.isValid(id))
            return null;
        const media = await Media_1.Media.findById(id).select('+data contentType updatedAt storage fileName purpose');
        if (!media)
            return null;
        let data;
        if (media.storage === 'DISK') {
            data = await (0, mediaStorage_1.readMediaFile)(media.fileName || '');
        }
        else if (media.storage === 'S3') {
            if (media.purpose === Media_1.MediaPurpose.CMS_PAGE || !env_1.env.AWS_S3_BUCKET || !media.fileName)
                return null;
            const object = await s3_config_1.default.send(new client_s3_1.GetObjectCommand({ Bucket: env_1.env.AWS_S3_BUCKET, Key: media.fileName }));
            const bytes = await object.Body?.transformToByteArray();
            data = bytes ? Buffer.from(bytes) : null;
        }
        else {
            data = media.data;
        }
        return data ? { contentType: media.contentType, updatedAt: media.updatedAt, data } : null;
    }
    publicS3Url(fileName) {
        const base = (env_1.env.AWS_CLOUDFRONT_DOMAIN || '').trim().replace(/\/+$/, '');
        if (!base || !fileName || !/^cms-pages\/[0-9a-f]{24}\.(jpg|png)$/.test(fileName))
            return null;
        try {
            const url = new URL(base);
            if (url.protocol !== 'https:' || url.username || url.password)
                return null;
            return `${base}/${fileName.split('/').map(encodeURIComponent).join('/')}`;
        }
        catch {
            return null;
        }
    }
}
exports.MediaService = MediaService;
exports.mediaService = new MediaService();
