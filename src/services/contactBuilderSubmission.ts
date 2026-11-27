import { cmsPageRepository } from '../repositories/cmsPage.repository';
import { formFields, isBuilderData, validateBuilderData } from '../validators/contactBuilder.schema';
import type { SubmitContactInput } from '../validators/contact.validator';

type ExtraField = { id: string; label: string; value: string | boolean };

export async function validatePublishedContactForm(input: SubmitContactInput): Promise<{ errors?: Record<string, string>; fields?: ExtraField[] }> {
  if (!input.formId) return input.customFields?.length ? { errors: { form: 'Refresh the contact page and try again.' } } : {};
  const page = await cmsPageRepository.findPublishedBySlug('contact');
  const data = page?.publishedData;
  if (!isBuilderData(data)) return { errors: { form: 'Refresh the contact page and try again.' } };
  const validated = validateBuilderData(data);
  const fields = validated.ok ? formFields(validated.data, input.formId) : null;
  if (!fields) return { errors: { form: 'Refresh the contact page and try again.' } };
  const custom = fields.filter(field => field.binding === 'custom');
  const submitted = new Map((input.customFields ?? []).map(field => [field.id, field.value]));
  if (submitted.size !== (input.customFields?.length ?? 0) || [...submitted.keys()].some(id => !custom.some(field => field.id === id))) {
    return { errors: { form: 'The form changed. Refresh the contact page and try again.' } };
  }
  const errors: Record<string, string> = Object.create(null);
  const output: ExtraField[] = [];
  if (fields.some(field => field.binding === 'phone' && field.required) && !input.phone) errors.phone = 'Enter your phone number.';
  for (const field of custom) {
    const value = submitted.get(field.id);
    if (value === undefined || value === '') {
      if (field.required) errors[field.id] = 'This field is required.';
      continue;
    }
    const valid = field.type === 'CheckboxField' ? typeof value === 'boolean' && (!field.required || value)
      : typeof value === 'string' && value.length <= (field.maxLength ?? 1000) && (
        field.type === 'EmailInput' ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
        : field.type === 'PhoneInput' ? /^\+?[\d ()-]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ''))
        : field.type === 'NumberInput' ? /^-?\d+(\.\d+)?$/.test(value) && Number(value) >= (field.min ?? -Infinity) && Number(value) <= (field.max ?? Infinity)
        : field.type === 'Dropdown' || field.type === 'RadioGroup' ? field.options.includes(value)
        : true
      );
    if (!valid) errors[field.id] = 'Enter a valid value for this field.';
    else output.push({ id: field.id, label: field.label, value });
  }
  return Object.keys(errors).length ? { errors } : { fields: output };
}
