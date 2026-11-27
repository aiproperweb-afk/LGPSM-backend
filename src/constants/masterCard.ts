/**
 * "Master card only" mode: the shared designs are the master card and the cards made since for particular event types
 * (services/cardTemplates/themes.ts). The designs from before the master card are not listed or drawn: an event made with one gets the
 * master card. Nothing was deleted: set MASTER_CARD_ONLY=false in the environment to bring them back. (The automated tests keep the full
 * set of designs unless a test turns the mode on with MASTER_CARD_ONLY=true.)
 */
export function masterCardOnly(): boolean {
  const v = process.env.MASTER_CARD_ONLY;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return process.env.NODE_ENV !== 'test';
}

/**
 * A design an administrator uploaded and published for everyone (its wording is replaced by each event's details). It is offered in
 * "master card only" mode too: that mode retires the older built-in designs, not the cards the administrator adds.
 */
export const SHARED_UPLOAD_FILTER = { cardDesign: 'CUSTOM', isSystemTemplate: true, isPublished: true, 'templateData.dynamicDetails': true } as const;

export function isSharedUpload(template: { cardDesign?: string | null; isSystemTemplate?: boolean; isPublished?: boolean; templateData?: { dynamicDetails?: boolean } | null } | null | undefined): boolean {
  return !!template && template.cardDesign === 'CUSTOM' && template.isSystemTemplate === true && template.isPublished === true && template.templateData?.dynamicDetails === true;
}
