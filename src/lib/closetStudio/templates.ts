import {
  MIKE_WHITE_COLLECTION,
  MIKE_WHITE_DESIGNER_CREDIT,
  MIKE_WHITE_TEMPLATE_CREDIT,
  type DesignerCredit,
} from "../closet/mikeWhiteCollection";

/**
 * Closet Studio starter templates. Every Mike White design is a template,
 * and anything made from one carries MIKE_WHITE_TEMPLATE_CREDIT (firestore
 * rules enforce it on save — see closetDesignValid).
 */

export const STUDIO_SLOTS = ["shoes", "top", "bottom", "head", "deck"] as const;
export type StudioSlot = (typeof STUDIO_SLOTS)[number];

export interface StudioTemplate {
  id: string;
  name: string;
  slot: StudioSlot;
  artUrl: string;
  designer: DesignerCredit | null;
}

export const BLANK_TEMPLATE: StudioTemplate = {
  id: "",
  name: "Blank canvas",
  slot: "shoes",
  artUrl: "",
  designer: null,
};

export const STUDIO_TEMPLATES: readonly StudioTemplate[] = MIKE_WHITE_COLLECTION.map((item) => ({
  id: item.itemDefId,
  name: item.name,
  slot: "shoes",
  artUrl: item.artUrl,
  designer: MIKE_WHITE_DESIGNER_CREDIT,
}));

/** Credit line a design must carry, "" for original work. */
export function creditForTemplate(templateId: string): string {
  return templateId.startsWith("mike_white") ? MIKE_WHITE_TEMPLATE_CREDIT : "";
}

export function templateById(id: string): StudioTemplate {
  return STUDIO_TEMPLATES.find((t) => t.id === id) ?? BLANK_TEMPLATE;
}
