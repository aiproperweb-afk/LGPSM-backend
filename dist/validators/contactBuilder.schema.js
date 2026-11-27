"use strict";
// The Contact page builder's document contract: component types, allowed nesting, prop and style rules, sanitising and
// validation. This file has no imports on purpose. The backend validates saved pages with an exact copy of it
// (scripts/sync-contact-schema.mjs writes LGPSM-backend/src/validators/contactBuilder.schema.ts), so edit it here only.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isContainerType = exports.BINDING_TYPES = exports.CORE_BINDINGS = exports.COMMON_PROPS = exports.COMPONENTS = exports.HTML_TAGS = exports.FORM_CHILDREN = exports.GENERAL_CHILDREN = exports.FIELD_TYPES = exports.CARD_TYPES = exports.LAYOUT_TYPES = exports.CATEGORY_LABELS = exports.isColor = exports.HOVER_KEYS = exports.STYLE_SPEC = exports.FONT_STACKS = exports.LIMITS = exports.BREAKPOINT_MAX_WIDTH = exports.BREAKPOINTS = exports.BUILDER_SCHEMA_VERSION = exports.BUILDER_ID = void 0;
exports.breakpointForWidth = breakpointForWidth;
exports.isStyleValue = isStyleValue;
exports.isSafeLink = isSafeLink;
exports.isSafeImage = isSafeImage;
exports.videoSource = videoSource;
exports.mapEmbedSrc = mapEmbedSrc;
exports.sanitizeRichText = sanitizeRichText;
exports.childSlots = childSlots;
exports.visitNodes = visitNodes;
exports.isBuilderData = isBuilderData;
exports.validateBuilderData = validateBuilderData;
exports.formFields = formFields;
exports.countForms = countForms;
exports.publishProblems = publishProblems;
exports.toPublicData = toPublicData;
exports.BUILDER_ID = "contact";
exports.BUILDER_SCHEMA_VERSION = 2;
exports.BREAKPOINTS = ["desktop", "tablet", "mobile"];
/** Desktop-first: tablet and mobile rules apply below these widths and inherit everything they do not override. */
exports.BREAKPOINT_MAX_WIDTH = { tablet: 1023.98, mobile: 639.98 };
function breakpointForWidth(width) {
    if (width <= exports.BREAKPOINT_MAX_WIDTH.mobile)
        return "mobile";
    if (width <= exports.BREAKPOINT_MAX_WIDTH.tablet)
        return "tablet";
    return "desktop";
}
exports.LIMITS = {
    maxNodes: 400,
    maxDepth: 12,
    maxBytes: 400 * 1024,
    maxText: 4000,
    maxRichText: 20000,
    maxCustomValue: 1000,
};
// ─── Fonts ──────────────────────────────────────────────────────────────────────────────────────────────────────────
exports.FONT_STACKS = {
    inherit: "inherit",
    inter: "var(--font-inter), system-ui, sans-serif",
    "dm-sans": "var(--font-dm-sans), system-ui, sans-serif",
    "space-grotesk": "var(--font-space-grotesk), system-ui, sans-serif",
    caveat: "var(--font-caveat), cursive",
    system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};
const size = ["auto", "fit-content", "max-content", "min-content"];
const len = { kind: "length" };
const margin = { kind: "length", negative: true, keywords: ["auto"] };
const offset = { kind: "length", negative: true, keywords: ["auto"] };
const color = { kind: "color" };
const oneOf = (...values) => ({ kind: "enum", values });
const num = (min, max) => ({ kind: "number", min, max });
const justify = ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly", "start", "end", "stretch"];
const align = ["stretch", "flex-start", "center", "flex-end", "baseline", "start", "end"];
exports.STYLE_SPEC = {
    // layout
    display: oneOf("block", "flex", "grid", "inline-block", "inline-flex"),
    flexDirection: oneOf("row", "row-reverse", "column", "column-reverse"),
    flexWrap: oneOf("nowrap", "wrap", "wrap-reverse"),
    justifyContent: oneOf(...justify),
    alignItems: oneOf(...align),
    alignContent: oneOf(...justify),
    justifyItems: oneOf("stretch", "start", "center", "end"),
    gap: len,
    rowGap: len,
    columnGap: len,
    gridColumns: num(1, 12),
    gridTemplate: { kind: "tracks" },
    gridRows: num(1, 12),
    gridRowHeight: { kind: "length", keywords: ["auto", "min-content", "max-content"] },
    // item inside a flex or grid parent
    flexGrow: num(0, 20),
    flexShrink: num(0, 20),
    flexBasis: { kind: "length", keywords: size },
    alignSelf: oneOf("auto", ...align),
    justifySelf: oneOf("auto", "stretch", "start", "center", "end"),
    order: num(-50, 50),
    gridColumnSpan: num(1, 12),
    gridRowSpan: num(1, 12),
    horizontalAlign: oneOf("left", "center", "right", "stretch"),
    // typography
    fontFamily: oneOf(...Object.keys(exports.FONT_STACKS)),
    fontSize: len,
    fontWeight: oneOf("100", "200", "300", "400", "500", "600", "700", "800", "900"),
    fontStyle: oneOf("normal", "italic"),
    textDecoration: oneOf("none", "underline", "line-through", "underline line-through", "overline"),
    color,
    textBackground: color,
    textAlign: oneOf("left", "center", "right", "justify"),
    verticalAlign: oneOf("top", "middle", "bottom", "baseline"),
    lineHeight: { kind: "length", keywords: ["normal", "1", "1.1", "1.15", "1.2", "1.25", "1.3", "1.4", "1.5", "1.6", "1.75", "2", "2.5"] },
    letterSpacing: { kind: "length", negative: true, keywords: ["normal"] },
    wordSpacing: { kind: "length", negative: true, keywords: ["normal"] },
    textTransform: oneOf("none", "uppercase", "lowercase", "capitalize"),
    textShadow: { kind: "textShadow" },
    whiteSpace: oneOf("normal", "nowrap", "pre-wrap", "pre-line"),
    textOverflow: oneOf("clip", "ellipsis"),
    wordBreak: oneOf("normal", "break-word", "break-all"),
    listStyleType: oneOf("none", "disc", "circle", "square", "decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"),
    // dimensions
    width: { kind: "length", keywords: size },
    height: { kind: "length", keywords: size },
    minWidth: { kind: "length", keywords: size },
    maxWidth: { kind: "length", keywords: [...size, "none"] },
    minHeight: { kind: "length", keywords: size },
    maxHeight: { kind: "length", keywords: [...size, "none"] },
    aspectRatio: { kind: "ratio" },
    // spacing
    marginTop: margin,
    marginRight: margin,
    marginBottom: margin,
    marginLeft: margin,
    paddingTop: len,
    paddingRight: len,
    paddingBottom: len,
    paddingLeft: len,
    // background
    backgroundColor: color,
    backgroundOpacity: num(0, 100),
    backgroundImage: { kind: "image" },
    backgroundGradient: { kind: "gradient" },
    backgroundPosition: oneOf("center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"),
    backgroundSize: oneOf("auto", "cover", "contain"),
    backgroundRepeat: oneOf("no-repeat", "repeat", "repeat-x", "repeat-y"),
    overlayColor: color,
    overlayOpacity: num(0, 100),
    // border
    borderStyle: oneOf("none", "solid", "dashed", "dotted", "double"),
    borderColor: color,
    borderTopWidth: len,
    borderRightWidth: len,
    borderBottomWidth: len,
    borderLeftWidth: len,
    borderTopLeftRadius: len,
    borderTopRightRadius: len,
    borderBottomRightRadius: len,
    borderBottomLeftRadius: len,
    // effects
    boxShadow: { kind: "shadow" },
    opacity: num(0, 100),
    overflow: oneOf("visible", "hidden", "auto", "clip"),
    rotate: num(-360, 360),
    scale: num(10, 300),
    translateX: { kind: "length", negative: true },
    translateY: { kind: "length", negative: true },
    transitionDuration: num(0, 3000),
    brightness: num(0, 200),
    // positioning
    position: oneOf("static", "relative", "absolute", "sticky"),
    top: offset,
    right: offset,
    bottom: offset,
    left: offset,
    zIndex: num(-10, 100),
    // media
    objectFit: oneOf("cover", "contain", "fill", "none", "scale-down"),
    objectPosition: oneOf("center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"),
    // form control states
    placeholderColor: color,
    focusBorderColor: color,
    focusBackgroundColor: color,
    // visibility
    hidden: { kind: "bool" },
};
exports.HOVER_KEYS = ["backgroundColor", "color", "borderColor", "boxShadow", "opacity", "scale", "translateY", "textDecoration", "brightness"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const LENGTH = /^-?(?:\d{1,5}(?:\.\d{1,3})?|\.\d{1,3})(?:px|%|rem|em|vw|vh|ch)$|^0$/;
const COLOR = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,3}|\d{1,3}%)\s*)?\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d{1,3}|\d{1,3}%)\s*)?\)|transparent|currentColor|inherit|white|black)$/i;
const isColor = (value) => typeof value === "string" && COLOR.test(value);
exports.isColor = isColor;
const within = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
function isStyleValue(key, value) {
    if (!Object.hasOwn(exports.STYLE_SPEC, key))
        return false;
    const spec = exports.STYLE_SPEC[key];
    switch (spec.kind) {
        case "length":
            return typeof value === "string" && ((spec.keywords?.includes(value) ?? false)
                || (LENGTH.test(value) && (spec.negative || !value.startsWith("-"))));
        case "color":
            return (0, exports.isColor)(value);
        case "enum":
            return typeof value === "string" && spec.values.includes(value);
        case "number":
            return within(value, spec.min, spec.max);
        case "ratio":
            return typeof value === "string" && /^(?:auto|[1-9]\d{0,3}(?:\.\d{1,3})?(?:\s?\/\s?[1-9]\d{0,3}(?:\.\d{1,3})?)?)$/.test(value);
        case "tracks":
            return typeof value === "string" && /^(?:\d{1,3}(?:\.\d{1,3})?)(?: \d{1,3}(?:\.\d{1,3})?){0,11}$/.test(value)
                && value.split(" ").every(part => Number(part) > 0);
        case "shadow":
        case "textShadow": {
            if (!isObject(value))
                return false;
            const allowed = spec.kind === "shadow" ? ["x", "y", "blur", "spread", "color", "inset"] : ["x", "y", "blur", "color"];
            return Object.keys(value).every(name => allowed.includes(name))
                && within(value.x, -200, 200) && within(value.y, -200, 200) && within(value.blur, 0, 300) && (0, exports.isColor)(value.color)
                && (value.spread === undefined || within(value.spread, -100, 100))
                && (value.inset === undefined || typeof value.inset === "boolean");
        }
        case "gradient":
            return isObject(value) && Object.keys(value).every(name => ["type", "angle", "from", "via", "to"].includes(name))
                && (value.type === "linear" || value.type === "radial") && within(value.angle, 0, 360)
                && (0, exports.isColor)(value.from) && (0, exports.isColor)(value.to) && (value.via === undefined || (0, exports.isColor)(value.via));
        case "image":
            return typeof value === "string" && value !== "" && isSafeImage(value);
        case "bool":
            return typeof value === "boolean";
    }
}
// ─── URLs ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function isHttpsUrl(value) {
    if (!/^https:\/\/[^\s<>"'`\\{}|^]+$/i.test(value) || value.length > 2000)
        return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
    }
    catch {
        return false;
    }
}
/** Link destinations: same-site paths, in-page anchors, https, mailto and tel. Nothing that can execute. */
function isSafeLink(value) {
    if (value === "")
        return true;
    if (value.length > 2000)
        return false;
    return /^#[A-Za-z][\w-]*$/.test(value)
        || /^\/(?![/\\])[^\s<>"'`\\]*$/.test(value)
        || /^mailto:[^\s<>"'`\\@]+@[^\s<>"'`\\]+$/i.test(value)
        || /^tel:\+?[\d().\- ]{3,30}$/i.test(value)
        || isHttpsUrl(value);
}
function isSafeImage(value) {
    if (value === "")
        return true;
    return /^media:[0-9a-fA-F]{24}$/.test(value)
        || /^\/images\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(value)
        || isHttpsUrl(value);
}
/** Only YouTube, Vimeo and direct https MP4/WebM files. Returns what to render, or null. */
function videoSource(value) {
    if (!isHttpsUrl(value))
        return null;
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    let youtube = null;
    if (host === "youtu.be")
        youtube = url.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
        youtube = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.replace(/^\/(?:embed|shorts)\//, "");
    }
    if (youtube !== null)
        return /^[\w-]{6,20}$/.test(youtube) ? { kind: "iframe", src: "https://www.youtube-nocookie.com/embed/" + youtube } : null;
    if (host === "vimeo.com" || host === "player.vimeo.com") {
        const id = /(\d{5,12})\/?$/.exec(url.pathname)?.[1];
        return id ? { kind: "iframe", src: "https://player.vimeo.com/video/" + id } : null;
    }
    return /\.(?:mp4|webm)$/i.test(url.pathname) ? { kind: "file", src: value } : null;
}
/** Map embeds are built here from an address or coordinates, so no arbitrary iframe address can be stored. */
function mapEmbedSrc(provider, query, zoom) {
    if (typeof query !== "string" || !query.trim())
        return null;
    const level = typeof zoom === "number" && zoom >= 1 && zoom <= 20 ? Math.round(zoom) : 15;
    if (provider === "osm") {
        const match = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(query);
        if (!match)
            return null;
        const lat = Number(match[1]), lng = Number(match[2]);
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
            return null;
        const span = 360 / 2 ** level;
        const bbox = [lng - span, lat - span / 2, lng + span, lat + span / 2].map(n => n.toFixed(5)).join(",");
        return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lng}`;
    }
    return `https://www.google.com/maps?q=${encodeURIComponent(query.trim())}&z=${level}&output=embed`;
}
// ─── Rich text ──────────────────────────────────────────────────────────────────────────────────────────────────────
const RICH_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "strike", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr", "a", "span"]);
const VOID_TAGS = new Set(["br", "hr"]);
const ALIGNABLE = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/g;
const escapeText = (text) => text
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeAttribute = (value) => value
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function cleanAttributes(tag, raw) {
    const attributes = new Map();
    for (const match of raw.matchAll(ATTRIBUTE))
        attributes.set(match[1].toLowerCase(), decodeAttribute(match[2] ?? match[3] ?? match[4] ?? ""));
    let output = "";
    if (tag === "a") {
        const href = attributes.get("href") ?? "";
        if (href && isSafeLink(href)) {
            output += ` href="${href.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
            if (attributes.get("target") === "_blank")
                output += ' target="_blank" rel="noopener noreferrer"';
        }
    }
    const declarations = [];
    for (const declaration of (attributes.get("style") ?? "").split(";")) {
        const separator = declaration.indexOf(":");
        if (separator < 0)
            continue;
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const value = declaration.slice(separator + 1).trim();
        if (tag === "span" && (property === "color" || property === "background-color") && (0, exports.isColor)(value))
            declarations.push(`${property}: ${value}`);
        if (ALIGNABLE.has(tag) && property === "text-align" && /^(?:left|center|right|justify)$/.test(value))
            declarations.push(`${property}: ${value}`);
    }
    if (declarations.length)
        output += ` style="${declarations.join("; ")}"`;
    return output;
}
/** Rebuilds the markup from an allow list: anything not recognised becomes plain text or is dropped. */
function sanitizeRichText(html) {
    const source = html
        .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
        .replace(/<(script|style|iframe|object|template|noscript|svg|math|textarea|title)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
    const open = [];
    let output = "";
    let last = 0;
    for (const match of source.matchAll(TAG)) {
        output += escapeText(source.slice(last, match.index));
        last = match.index + match[0].length;
        const closing = match[1] === "/";
        const tag = match[2].toLowerCase();
        if (!RICH_TAGS.has(tag))
            continue;
        if (VOID_TAGS.has(tag)) {
            if (!closing)
                output += `<${tag}>`;
            continue;
        }
        if (!closing) {
            open.push(tag);
            output += `<${tag}${cleanAttributes(tag, match[3] ?? "")}>`;
            continue;
        }
        const index = open.lastIndexOf(tag);
        if (index < 0)
            continue;
        while (open.length > index)
            output += `</${open.pop()}>`;
    }
    output += escapeText(source.slice(last));
    while (open.length)
        output += `</${open.pop()}>`;
    return output;
}
exports.CATEGORY_LABELS = {
    layout: "Layout", typography: "Typography", media: "Media", interactive: "Interactive", cards: "Cards", contact: "Contact",
};
exports.LAYOUT_TYPES = ["Section", "Container", "Row", "Column", "Flex", "Grid", "Columns", "Wrapper", "Spacer", "Divider"];
const TYPOGRAPHY_TYPES = ["Heading", "Subheading", "Paragraph", "RichText", "OrderedList", "UnorderedList", "Link", "Highlight", "Quote"];
const MEDIA_TYPES = ["Image", "Gallery", "Video", "Icon", "Logo", "BackgroundImage", "MapEmbed"];
const INTERACTIVE_TYPES = ["Button", "IconButton", "LinkButton", "Accordion", "Tabs", "FaqItem", "SocialLinks"];
exports.CARD_TYPES = ["Card", "ContactInfoCard", "AddressCard", "EmailCard", "PhoneCard", "OfficeCard", "BusinessHoursCard", "FeatureCard", "TeamCard", "TestimonialCard", "ContactDetails", "SocialSection"];
exports.FIELD_TYPES = ["TextInput", "EmailInput", "PhoneInput", "NumberInput", "Dropdown", "RadioGroup", "CheckboxField", "TextArea"];
/** What ordinary containers accept: everything except the parts that only make sense inside a form or a column set. */
exports.GENERAL_CHILDREN = [
    ...exports.LAYOUT_TYPES, ...TYPOGRAPHY_TYPES, ...MEDIA_TYPES, ...INTERACTIVE_TYPES, ...exports.CARD_TYPES, "ContactForm", "FormHeading", "BusinessHours",
];
exports.FORM_CHILDREN = [
    ...exports.FIELD_TYPES, "SubmitButton", "FormGroup", "FormHeading", "Heading", "Subheading", "Paragraph", "RichText", "Link", "Highlight", "Spacer", "Divider", "Icon", "Image",
];
exports.HTML_TAGS = ["div", "section", "article", "aside", "header", "footer", "nav", "dl", "dt", "dd"];
const text = { kind: "text", max: 300 };
const longText = { kind: "text", max: exports.LIMITS.maxText, multiline: true };
const link = { kind: "link" };
const image = { kind: "image" };
const bool = { kind: "bool" };
const style = { kind: "style" };
const pick = (...values) => ({ kind: "enum", values });
const range = (min, max) => ({ kind: "number", min, max });
const slot = (allow) => ({ kind: "slot", allow });
const target = pick("_self", "_blank");
const iconName = pick("location", "mail", "phone", "globe", "clock", "user", "users", "star", "check", "chat", "calendar", "arrow-right", "info", "heart", "building", "facebook", "instagram", "linkedin", "x", "youtube", "whatsapp");
const containerProps = {
    htmlTag: pick(...exports.HTML_TAGS),
    animation: pick("none", "up", "left", "right", "pop"),
    animationDelay: range(0, 2000),
    decoration: pick("none", "sunburst"),
    content: slot(exports.GENERAL_CHILDREN),
};
const textProps = { text: longText, href: link, target };
const container = (label, category, extra = {}) => ({ label, category, props: { ...containerProps, ...extra } });
const field = (label, bindings, extra = {}) => ({
    label, category: "contact", props: {
        binding: pick(...bindings), label: text, placeholder: text, helpText: text, required: bool, optionalText: text,
        labelStyle: style, controlStyle: style, helpStyle: style, ...extra,
    },
});
const listProps = { items: { kind: "array", max: 30, item: { text: longText, href: link } } };
const optionProps = { options: { kind: "array", max: 30, item: { label: text } } };
exports.COMPONENTS = {
    Section: container("Section", "layout"),
    Container: container("Container", "layout"),
    Row: container("Row", "layout"),
    Column: container("Column", "layout"),
    Flex: container("Flex container", "layout"),
    Grid: container("Grid container", "layout"),
    Columns: container("Multi-column layout", "layout", { content: slot(["Column"]) }),
    Wrapper: container("Wrapper", "layout"),
    Spacer: { label: "Spacer", category: "layout", props: {} },
    Divider: { label: "Divider", category: "layout", props: {} },
    Heading: { label: "Heading", category: "typography", props: { ...textProps, level: pick("h1", "h2", "h3", "h4", "h5", "h6"), srOnly: bool } },
    Subheading: { label: "Subheading", category: "typography", props: { ...textProps, level: pick("h1", "h2", "h3", "h4", "h5", "h6"), srOnly: bool } },
    Paragraph: { label: "Paragraph", category: "typography", props: { ...textProps, htmlTag: pick("p", "span", "div") } },
    RichText: { label: "Rich text", category: "typography", props: { html: { kind: "richtext" } } },
    OrderedList: { label: "Ordered list", category: "typography", props: listProps },
    UnorderedList: { label: "Unordered list", category: "typography", props: listProps },
    Link: { label: "Hyperlink", category: "typography", props: textProps },
    Highlight: { label: "Highlighted text", category: "typography", props: textProps },
    Quote: { label: "Quote", category: "typography", props: { text: longText, cite: text } },
    Image: { label: "Image", category: "media", props: { src: image, alt: text, caption: text, href: link, target, lockAspect: bool, imageStyle: style } },
    Logo: { label: "Logo", category: "media", props: { src: image, alt: text, caption: text, href: link, target, lockAspect: bool, imageStyle: style } },
    Gallery: { label: "Image gallery", category: "media", props: { images: { kind: "array", max: 24, item: { src: image, alt: text, caption: text } }, columns: range(1, 6), imageStyle: style } },
    Video: { label: "Video", category: "media", props: { url: { kind: "video" }, title: text, poster: image, lockAspect: bool } },
    Icon: { label: "Icon", category: "media", props: { icon: iconName, label: text, size: range(8, 200), strokeWidth: range(1, 4) } },
    BackgroundImage: container("Background image", "media"),
    MapEmbed: { label: "Map", category: "media", props: { provider: pick("google", "osm"), query: text, zoom: range(1, 20), title: text } },
    Button: { label: "Button", category: "interactive", props: { label: text, href: link, target, variant: pick("primary", "secondary", "outline", "ghost"), icon: pick("none", "arrow-right", "mail", "phone", "location", "calendar", "chat") } },
    IconButton: { label: "Icon button", category: "interactive", props: { icon: iconName, ariaText: text, href: link, target } },
    LinkButton: { label: "Link button", category: "interactive", props: { label: text, href: link, target } },
    Accordion: { label: "Accordion", category: "interactive", props: { content: slot(["FaqItem"]) } },
    FaqItem: { label: "FAQ item", category: "interactive", props: { question: text, open: bool, questionStyle: style, content: slot(exports.GENERAL_CHILDREN) } },
    Tabs: { label: "Tabs", category: "interactive", props: { tabs: { kind: "array", max: 8, item: { label: text, content: slot(exports.GENERAL_CHILDREN) } }, tabStyle: style } },
    SocialLinks: { label: "Social media links", category: "interactive", props: { links: { kind: "array", max: 12, item: { platform: iconName, label: text, href: link } }, size: range(12, 64), itemStyle: style } },
    Card: container("Card", "cards"),
    ContactInfoCard: container("Contact information card", "cards"),
    AddressCard: container("Address card", "cards"),
    EmailCard: container("Email card", "cards"),
    PhoneCard: container("Phone number card", "cards"),
    OfficeCard: container("Office location card", "cards"),
    BusinessHoursCard: container("Business hours card", "cards"),
    FeatureCard: container("Feature card", "cards"),
    TeamCard: container("Team member card", "cards"),
    TestimonialCard: container("Testimonial card", "cards"),
    ContactForm: { label: "Contact form", category: "contact", props: { formLabel: text, successMessage: text, errorMessage: text, invalidMessage: text, sendingLabel: text, content: slot(exports.FORM_CHILDREN) } },
    FormHeading: { label: "Contact form heading", category: "contact", props: { ...textProps, level: pick("h1", "h2", "h3", "h4", "h5", "h6"), srOnly: bool } },
    FormGroup: { label: "Form field group", category: "contact", props: { content: slot(exports.FORM_CHILDREN) } },
    TextInput: field("Text input", ["custom", "name"], { maxLength: range(1, 500) }),
    EmailInput: field("Email input", ["custom", "email"]),
    PhoneInput: field("Phone input", ["custom", "phone"]),
    NumberInput: field("Number input", ["custom"], { min: range(-1_000_000, 1_000_000), max: range(-1_000_000, 1_000_000) }),
    Dropdown: field("Dropdown", ["custom"], optionProps),
    RadioGroup: field("Radio button group", ["custom"], optionProps),
    CheckboxField: field("Checkbox", ["custom"], { checkboxText: text }),
    TextArea: field("Textarea", ["custom", "message"], { rows: range(1, 20), maxLength: range(1, 2000) }),
    SubmitButton: { label: "Submit button", category: "contact", props: { label: text } },
    ContactDetails: container("Contact details", "contact"),
    BusinessHours: { label: "Business hours", category: "contact", props: { rows: { kind: "array", max: 14, item: { day: text, hours: text } } } },
    SocialSection: container("Social media section", "contact"),
};
/** Props every component may carry in addition to its own. */
exports.COMMON_PROPS = {
    name: { kind: "text", max: 80 },
    hidden: bool,
    locked: bool,
    anchorId: { kind: "anchor" },
    ariaLabel: text,
    ariaLabelledBy: { kind: "anchor" },
    style,
};
/** The text a component of this type shows must be sent with the contact form: these bindings feed the existing API. */
exports.CORE_BINDINGS = ["name", "email", "message"];
exports.BINDING_TYPES = { name: "TextInput", email: "EmailInput", phone: "PhoneInput", message: "TextArea" };
const isContainerType = (type) => Object.hasOwn(exports.COMPONENTS, type) && exports.COMPONENTS[type].props.content?.kind === "slot";
exports.isContainerType = isContainerType;
/** Every nested slot of a node, including slots inside array items (tabs). */
function childSlots(node) {
    const spec = Object.hasOwn(exports.COMPONENTS, node.type) ? exports.COMPONENTS[node.type] : undefined;
    if (!spec)
        return [];
    const slots = [];
    for (const [name, rule] of Object.entries(spec.props)) {
        const value = node.props[name];
        if (rule.kind === "slot" && Array.isArray(value))
            slots.push({ path: name, allow: rule.allow, nodes: value });
        if (rule.kind === "array" && Array.isArray(value)) {
            value.forEach((item, index) => {
                for (const [key, itemRule] of Object.entries(rule.item)) {
                    const nested = isObject(item) ? item[key] : undefined;
                    if (itemRule.kind === "slot" && Array.isArray(nested))
                        slots.push({ path: `${name}.${index}.${key}`, allow: itemRule.allow, nodes: nested });
                }
            });
        }
    }
    return slots;
}
function visitNodes(nodes, visit, ancestors = []) {
    for (const node of nodes) {
        visit(node, ancestors);
        for (const child of childSlots(node))
            visitNodes(child.nodes, visit, [...ancestors, node]);
    }
}
function isBuilderData(value) {
    return isObject(value) && isObject(value.root) && isObject(value.root.props) && value.root.props.builder === exports.BUILDER_ID;
}
class Invalid extends Error {
    path;
    constructor(path, message) {
        super(message);
        this.path = path;
    }
}
const fail = (path, message) => { throw new Invalid(path, message); };
function collectMedia(value, walk) {
    if (value.startsWith("media:"))
        walk.media.add(value.slice(6).toLowerCase());
}
function cleanText(value, path, max) {
    if (typeof value !== "string")
        fail(path, "must be text");
    const result = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    if (result.length > max)
        fail(path, `must be at most ${max} characters`);
    if (/<\s*(?:\/?\s*[a-z][^>]*>|[!?])/i.test(result))
        fail(path, "HTML is not allowed in this field");
    return result;
}
function cleanStyle(value, path, walk) {
    if (!isObject(value))
        fail(path, "must be a style object");
    const result = {};
    for (const [layer, values] of Object.entries(value)) {
        if (!["desktop", "tablet", "mobile", "hover"].includes(layer))
            fail(`${path}.${layer}`, "unknown style layer");
        if (values === undefined || values === null)
            continue;
        if (!isObject(values))
            fail(`${path}.${layer}`, "must be an object");
        const cleaned = {};
        for (const [key, entry] of Object.entries(values)) {
            if (entry === undefined || entry === null || entry === "")
                continue;
            if (layer === "hover" && !exports.HOVER_KEYS.includes(key))
                fail(`${path}.${layer}.${key}`, "is not a hover property");
            if (!isStyleValue(key, entry))
                fail(`${path}.${layer}.${key}`, "has an unsupported value");
            if (key === "backgroundImage")
                collectMedia(entry, walk);
            cleaned[key] = entry;
        }
        if (Object.keys(cleaned).length)
            result[layer] = cleaned;
    }
    return result;
}
function cleanValue(value, rule, path, walk, depth) {
    switch (rule.kind) {
        case "text":
            return cleanText(value, path, rule.max ?? exports.LIMITS.maxText);
        case "richtext":
            if (typeof value !== "string" || value.length > exports.LIMITS.maxRichText)
                fail(path, "must be rich text of a reasonable length");
            return sanitizeRichText(value);
        case "link":
            if (typeof value !== "string" || !isSafeLink(value))
                fail(path, "must be a site path, #anchor, https, mailto or tel link");
            return value;
        case "image":
            if (typeof value !== "string" || !isSafeImage(value))
                fail(path, "must be an uploaded image, a path under /images/ or an https address");
            collectMedia(value, walk);
            return value;
        case "video":
            if (typeof value !== "string" || (value !== "" && !videoSource(value)))
                fail(path, "must be a YouTube, Vimeo or https MP4/WebM address");
            return value;
        case "enum":
            if (typeof value !== "string" || !rule.values.includes(value))
                fail(path, "has an unsupported option");
            return value;
        case "bool":
            if (typeof value !== "boolean")
                fail(path, "must be true or false");
            return value;
        case "number":
            if (!within(value, rule.min, rule.max))
                fail(path, `must be a number from ${rule.min} to ${rule.max}`);
            return value;
        case "anchor":
            if (typeof value !== "string" || !/^(?:[A-Za-z][\w-]{0,79})?$/.test(value))
                fail(path, "must start with a letter and use letters, numbers, - or _");
            return value;
        case "style":
            return cleanStyle(value, path, walk);
        case "slot":
            return cleanNodes(value, rule.allow, path, walk, depth + 1);
        case "array": {
            if (!Array.isArray(value) || value.length > rule.max)
                fail(path, `must be a list of at most ${rule.max} items`);
            return value.map((item, index) => {
                if (!isObject(item))
                    fail(`${path}[${index}]`, "must be an object");
                const result = {};
                for (const [key, entry] of Object.entries(item)) {
                    if (entry === undefined || entry === null)
                        continue;
                    if (!Object.hasOwn(rule.item, key))
                        fail(`${path}[${index}].${key}`, "is not a supported property");
                    result[key] = cleanValue(entry, rule.item[key], `${path}[${index}].${key}`, walk, depth);
                }
                return result;
            });
        }
    }
}
function cleanNodes(value, allow, path, walk, depth) {
    if (!Array.isArray(value))
        fail(path, "must be a list of components");
    if (depth > exports.LIMITS.maxDepth)
        fail(path, `components may be nested at most ${exports.LIMITS.maxDepth} levels`);
    return value.map((node, index) => {
        const at = `${path}[${index}]`;
        if (!isObject(node) || Object.keys(node).some(key => !["type", "props", "readOnly"].includes(key)) || !isObject(node.props))
            fail(at, "is not a component");
        const { type, props } = node;
        if (typeof type !== "string" || !Object.hasOwn(exports.COMPONENTS, type))
            fail(at, "uses an unsupported component type");
        if (!allow.includes(type))
            fail(at, `${exports.COMPONENTS[type].label} cannot be placed here`);
        if (++walk.count > exports.LIMITS.maxNodes)
            fail(at, `a page may contain at most ${exports.LIMITS.maxNodes} components`);
        const id = props.id;
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id))
            fail(at, "needs a valid component id");
        if (walk.ids.has(id))
            fail(at, `repeats the component id ${id}`);
        walk.ids.add(id);
        const spec = exports.COMPONENTS[type];
        const result = { id: id };
        for (const [key, entry] of Object.entries(props)) {
            if (key === "id" || entry === undefined || entry === null)
                continue;
            const rule = Object.hasOwn(spec.props, key) ? spec.props[key] : Object.hasOwn(exports.COMMON_PROPS, key) ? exports.COMMON_PROPS[key] : undefined;
            if (!rule)
                fail(`${at}.${key}`, "is not a supported property");
            result[key] = cleanValue(entry, rule, `${at}.${key}`, walk, depth);
        }
        return { type: type, props: result };
    });
}
/** Checks a whole saved document and returns a cleaned copy (rich text sanitised, empty values dropped). */
function validateBuilderData(input) {
    try {
        if (!isObject(input) || Object.keys(input).some(key => !["root", "content", "zones"].includes(key)))
            fail("data", "must contain root and content only");
        const data = input;
        if (new TextEncoder().encode(JSON.stringify(data)).length > exports.LIMITS.maxBytes)
            fail("data", "the page is too large to save");
        if (data.zones !== undefined && (!isObject(data.zones) || Object.keys(data.zones).length))
            fail("data.zones", "is not supported");
        if (!isBuilderData(data))
            fail("data.root", "is not a Contact builder document");
        const root = data.root.props;
        if (root.schemaVersion !== exports.BUILDER_SCHEMA_VERSION)
            fail("data.root.props.schemaVersion", "is not supported");
        const walk = { ids: new Set(), media: new Set(), count: 0 };
        const props = { builder: exports.BUILDER_ID, schemaVersion: exports.BUILDER_SCHEMA_VERSION };
        for (const [key, value] of Object.entries(root)) {
            if (key === "builder" || key === "schemaVersion" || value === undefined || value === null)
                continue;
            // Puck adds an id to the root props while editing; it is not stored.
            if (key === "id")
                continue;
            if (key !== "style")
                fail(`data.root.props.${key}`, "is not a supported property");
            props.style = cleanStyle(value, "data.root.props.style", walk);
        }
        const content = cleanNodes(data.content, exports.GENERAL_CHILDREN, "data.content", walk, 1);
        return { ok: true, data: { root: { props }, content }, mediaIds: [...walk.media] };
    }
    catch (error) {
        if (error instanceof Invalid)
            return { ok: false, path: error.path, message: error.message };
        return { ok: false, path: "data", message: "The page could not be read" };
    }
}
const isHiddenNode = (node) => node.props.hidden === true;
const hiddenOnSomeScreen = (node) => {
    const styles = node.props.style;
    return isHiddenNode(node) || exports.BREAKPOINTS.some(point => styles?.[point]?.hidden === true);
};
const toField = (node) => ({
    id: node.props.id,
    type: node.type,
    binding: typeof node.props.binding === "string" ? node.props.binding : "custom",
    label: (typeof node.props.label === "string" && node.props.label.trim()) || exports.COMPONENTS[node.type].label,
    required: node.props.required === true,
    options: Array.isArray(node.props.options)
        ? node.props.options.map(option => String(option?.label ?? "").trim()).filter(Boolean) : [],
    min: typeof node.props.min === "number" ? node.props.min : undefined,
    max: typeof node.props.max === "number" ? node.props.max : undefined,
    maxLength: typeof node.props.maxLength === "number" ? node.props.maxLength : undefined,
});
/** The visible fields of one form, as visitors receive it. Null when the page has no such form. */
function formFields(data, formId) {
    let form;
    visitNodes(data.content, (node, ancestors) => {
        if (node.type === "ContactForm" && node.props.id === formId && ![node, ...ancestors].some(isHiddenNode))
            form = node;
    });
    if (!form)
        return null;
    const fields = [];
    visitNodes(childSlots(form).flatMap(child => child.nodes), (node, ancestors) => {
        if (exports.FIELD_TYPES.includes(node.type) && ![node, ...ancestors].some(isHiddenNode))
            fields.push(toField(node));
    });
    return fields;
}
function countForms(data) {
    let count = 0;
    visitNodes(data.content, node => { if (node.type === "ContactForm")
        count += 1; });
    return count;
}
/** Problems that stop publishing. Drafts may be saved while these are unresolved. */
function publishProblems(data) {
    const problems = [];
    if (!data.content.length)
        problems.push("The page is empty. Add content before publishing.");
    const forms = [];
    visitNodes(data.content, (node, ancestors) => {
        if (node.type === "ContactForm")
            forms.push({ node, ancestors });
        if (exports.FIELD_TYPES.includes(node.type) && !ancestors.some(parent => parent.type === "ContactForm")) {
            problems.push(`${exports.COMPONENTS[node.type].label} must be inside a Contact form.`);
        }
    });
    forms.forEach(({ node: form, ancestors }, index) => {
        const title = forms.length > 1 ? `Contact form ${index + 1}` : "The contact form";
        const fields = [];
        let submit = 0;
        visitNodes(childSlots(form).flatMap(child => child.nodes), (node, nested) => {
            if (exports.FIELD_TYPES.includes(node.type))
                fields.push({ node, path: [...ancestors, form, ...nested, node] });
            if (node.type === "SubmitButton" && ![node, ...nested].some(hiddenOnSomeScreen))
                submit += 1;
        });
        if (!submit)
            problems.push(`${title} needs a submit button that is visible on every screen size.`);
        for (const binding of exports.CORE_BINDINGS) {
            const bound = fields.filter(entry => entry.node.props.binding === binding);
            if (bound.length !== 1) {
                problems.push(`${title} needs exactly one field connected to “${binding}” (found ${bound.length}).`);
                continue;
            }
            if (bound[0].node.props.required !== true)
                problems.push(`${title}: the “${binding}” field must stay required because the server requires it.`);
            if (bound[0].path.some(hiddenOnSomeScreen))
                problems.push(`${title}: the “${binding}” field, the form and their containers must be visible on every screen size.`);
        }
        if (fields.filter(entry => entry.node.props.binding === "phone").length > 1)
            problems.push(`${title} may have only one field connected to “phone”.`);
        for (const { node, path } of fields) {
            if (node.props.required === true && !path.some(isHiddenNode) && path.some(hiddenOnSomeScreen)) {
                problems.push(`${title}: “${toField(node).label}” is required, so it cannot be hidden on some screen sizes.`);
            }
            const binding = String(node.props.binding ?? "custom");
            if (binding !== "custom" && exports.BINDING_TYPES[binding] !== node.type)
                problems.push(`${title}: “${binding}” cannot be connected to a ${exports.COMPONENTS[node.type].label}.`);
            if ((node.type === "Dropdown" || node.type === "RadioGroup") && !toField(node).options.length)
                problems.push(`${title}: “${toField(node).label}” needs at least one option.`);
        }
        if (fields.length > 30)
            problems.push(`${title} may have at most 30 fields.`);
    });
    return problems;
}
/** What visitors receive: hidden components are removed and editor-only labels are dropped. */
function toPublicData(data) {
    const clean = (nodes) => nodes.filter(node => !isHiddenNode(node)).map(node => {
        const props = { ...node.props };
        delete props.name;
        delete props.locked;
        const spec = Object.hasOwn(exports.COMPONENTS, node.type) ? exports.COMPONENTS[node.type] : undefined;
        for (const [name, rule] of Object.entries(spec?.props ?? {})) {
            const value = props[name];
            if (rule.kind === "slot" && Array.isArray(value))
                props[name] = clean(value);
            if (rule.kind === "array" && Array.isArray(value)) {
                props[name] = value.map(item => {
                    const copy = { ...item };
                    for (const [key, itemRule] of Object.entries(rule.item))
                        if (itemRule.kind === "slot" && Array.isArray(copy[key]))
                            copy[key] = clean(copy[key]);
                    return copy;
                });
            }
        }
        return { type: node.type, props };
    });
    return { root: data.root, content: clean(data.content) };
}
