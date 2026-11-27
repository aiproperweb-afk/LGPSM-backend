# CMS page API

The backend stores Puck JSON snapshots in MongoDB. It does not install Puck or store rendered HTML, JavaScript, or image bytes in page documents.

## Page schema

| Fields | Storage and meaning |
|---|---|
| `name`, `slug`, `route` | Display name, lowercase lookup slug, and local frontend path. Slug and route have unique indexes. |
| `draftData`, `publishedData` | Structured Puck JSON. The published snapshot is optional until first publication. |
| `status` | `DRAFT` for an unpublished page or pending edit, `PUBLISHED` after publishing or restoring the live snapshot. |
| `schemaVersion`, `version`, `editVersion` | Content schema revision, publication counter, and edit counter. |
| `updatedBy`, `publishedBy`, `publishedAt` | User references and publication timestamp. Seeding sets the timestamp without a user actor. |
| `createdAt`, `updatedAt`, `componentStructureLocked` | Mongoose timestamps and a boolean policy for fixed layouts. |

The CMS contains only the public site content, including all seven client categories and the shared navbar and footer. The backend reports `cms: ready` in `/api/health` after startup seeding succeeds. Previously seeded workspace records are excluded from the supported contracts.

## Routes

All routes are under `/api/v1`:

| Method | Path | Access |
|---|---|---|
| `GET` | `/admin/pages` | Admin |
| `GET` | `/admin/pages/:id` | Admin |
| `PATCH` | `/admin/pages/:id/draft` | Admin |
| `POST` | `/admin/pages/:id/publish` | Admin |
| `POST` | `/admin/pages/:id/discard-draft` | Admin |
| `GET` | `/public/pages/:slug` | Public; published snapshot only |

Admin calls require `Authorization: Bearer <access-token>` for a user with the `ADMIN` role. Draft, publish, and discard calls require `If-Match: "<editVersion>"`, copied from the page response. A stale value returns `409 CMS_EDIT_CONFLICT`; missing values return `428 IF_MATCH_REQUIRED`.

Draft and publish request bodies are `{ "data": <PuckData> }`. The `data` value uses Puck's JSON shape: `root`, `content`, and optional `zones`. Saving a draft changes neither `publishedData` nor the public page; the admin `status` becomes `DRAFT` while the previous published snapshot remains publicly served. Publishing atomically replaces both snapshots, increments `version` and `editVersion`, and stores the publishing administrator and timestamp. Discard restores the draft from `publishedData`.

Example:

```http
PATCH /api/v1/admin/pages/65f000000000000000000001/draft
Authorization: Bearer <access-token>
If-Match: "2"
Content-Type: application/json

{"data":{"root":{"props":{}},"content":[{"type":"ContactContent","props":{"pageHeading":"Contact EventQRapp","informationHeading":"Contact Information","formHeading":"Contact Us","introduction":"Have questions or need more information? Get in touch with our team.","submitLabel":"Submit","id":"ContactContent"}}]}}
```

Successful responses use `{ "success": true, "data": ... }`. The public response exposes `name`, `slug`, `route`, `status`, `schemaVersion`, `version`, `publishedAt`, and `content`; it never includes drafts or editor metadata.

## Content constraints and media

Use `data.draftData` to initialize the editor and the latest successful write response's `data.editVersion` for the next mutation. On `409 CMS_EDIT_CONFLICT`, the response includes `currentVersion`. Reload the editor document and let the administrator reconcile their changes. Discard takes an empty request body. The public renderer uses `data.content` with the matching Puck configuration.

Example public response

```json
{
  "success": true,
  "data": {
    "name": "Contact",
    "slug": "contact",
    "route": "/contact",
    "status": "PUBLISHED",
    "schemaVersion": 1,
    "version": 1,
    "publishedAt": "2026-01-01T12:00:00.000Z",
    "content": {
      "root": {
        "props": {}
      },
      "content": [
        {
          "type": "ContactContent",
          "props": {
            "pageHeading": "Contact EventQRapp",
            "informationHeading": "Contact Information",
            "formHeading": "Contact Us",
            "introduction": "Have questions or need more information? Get in touch with our team.",
            "submitLabel": "Submit",
            "id": "ContactContent"
          }
        }
      ]
    }
  }
}
```

The checked-in v1 seed at `src/validators/cms-pages.v1.json` is generated from the frontend with `node scripts/export-cms-seed.mjs`. It is both the initial page data and the basis for validating the exact component order, IDs, props, and nested field shapes for the supported public pages and shared site sections. The validator enforces the 90 KiB limit, fixed arrays, approved internal CTA destinations, plain text, safe raster asset paths, and registered CMS media IDs. Changes to fields and initial content require regenerating the seed and testing the frontend and backend together. Incompatible field changes need a new schema version and an explicit database migration.

Administrators upload images through `POST /api/v1/media/upload`, with multipart fields `file` and `purpose=CMS_PAGE`. Persist the returned `media:<id>` key. Public images resolve through the standard media API redirect to the Hostinger media origin. CMS files use disk storage in the existing media directory. Draft and publish validate ownership of the media record by purpose and verify the bytes are available.

The backend seeds Home and Contact after connecting to MongoDB at startup. For manual initialization, run `npm run seed:cms -- src/validators/cms-pages.v1.json` with the approved database connection. The command creates indexes and initializes draft and published snapshots with an insert-only upsert. Repeating it preserves existing content, versions, and timestamps.

## Hostinger media

Set backend MEDIA_DIR to the absolute persistent filesystem path served at the root of https://media.eventqrapp.com. Set MEDIA_PUBLIC_URL=https://media.eventqrapp.com. The repository describes a shared directory and does not provision the Hostinger document root, mount, or file transfer. The server process must be able to write to that directory, and the Hostinger web server must serve the same files. If they run on separate machines, provide a durable writable shared mount or arrange an approved file transfer before enabling uploads. The application contains no Hostinger upload client.

Place the media directory outside the release tree and operating system temporary directory. Configure the deployment to retain the directory and all prior files, including files referenced by older publications. Use static-only hosting with script execution and directory listing disabled. The app writes normalized JPEG or PNG using an ObjectId filename at the root of that directory. A public image becomes reachable as soon as it is uploaded, which follows the existing public media policy. Draft page JSON remains private.

For local development, set MEDIA_DIR to a writable directory and leave MEDIA_PUBLIC_URL empty. The existing GET /api/v1/media/:id route streams the file locally. In production it sends a redirect to the media subdomain. The frontend may set the existing NEXT_PUBLIC_MEDIA_URL to https://media.eventqrapp.com; the production hostname is included in its image and CSP configuration by default.

Before rollout, check whether any real CMS media rows use S3 storage. If any exist, move the files into the Hostinger-backed directory and update the existing records to DISK with their flat filenames while retaining their IDs. Check a sample URL and image delivery before and after a redeployment in the approved environment.
