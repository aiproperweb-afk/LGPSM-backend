"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePublishedContactForm = validatePublishedContactForm;
const cmsPage_repository_1 = require("../repositories/cmsPage.repository");
const contactBuilder_schema_1 = require("../validators/contactBuilder.schema");
async function validatePublishedContactForm(input) {
    if (!input.formId)
        return input.customFields?.length ? { errors: { form: 'Refresh the contact page and try again.' } } : {};
    const page = await cmsPage_repository_1.cmsPageRepository.findPublishedBySlug('contact');
    const data = page?.publishedData;
    if (!(0, contactBuilder_schema_1.isBuilderData)(data))
        return { errors: { form: 'Refresh the contact page and try again.' } };
    const validated = (0, contactBuilder_schema_1.validateBuilderData)(data);
    const fields = validated.ok ? (0, contactBuilder_schema_1.formFields)(validated.data, input.formId) : null;
    if (!fields)
        return { errors: { form: 'Refresh the contact page and try again.' } };
    const custom = fields.filter(field => field.binding === 'custom');
    const submitted = new Map((input.customFields ?? []).map(field => [field.id, field.value]));
    if (submitted.size !== (input.customFields?.length ?? 0) || [...submitted.keys()].some(id => !custom.some(field => field.id === id))) {
        return { errors: { form: 'The form changed. Refresh the contact page and try again.' } };
    }
    const errors = Object.create(null);
    const output = [];
    if (fields.some(field => field.binding === 'phone' && field.required) && !input.phone)
        errors.phone = 'Enter your phone number.';
    for (const field of custom) {
        const value = submitted.get(field.id);
        if (value === undefined || value === '') {
            if (field.required)
                errors[field.id] = 'This field is required.';
            continue;
        }
        const valid = field.type === 'CheckboxField' ? typeof value === 'boolean' && (!field.required || value)
            : typeof value === 'string' && value.length <= (field.maxLength ?? 1000) && (field.type === 'EmailInput' ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
                : field.type === 'PhoneInput' ? /^\+?[\d ()-]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ''))
                    : field.type === 'NumberInput' ? /^-?\d+(\.\d+)?$/.test(value) && Number(value) >= (field.min ?? -Infinity) && Number(value) <= (field.max ?? Infinity)
                        : field.type === 'Dropdown' || field.type === 'RadioGroup' ? field.options.includes(value)
                            : true);
        if (!valid)
            errors[field.id] = 'Enter a valid value for this field.';
        else
            output.push({ id: field.id, label: field.label, value });
    }
    return Object.keys(errors).length ? { errors } : { fields: output };
}
