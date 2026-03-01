// ============================================================
// Client-side input sanitisation & Zod-powered validation.
// ============================================================

import { z } from "zod";

// ── Sanitisation ─────────────────────────────────────────────
const DANGEROUS_RE = /[<>{}\[\]\\`~^|$=]/g;

/** Strip dangerous characters from an input value (used in onChange). */
export function sanitizeInput(value: string): string {
  return value.replace(DANGEROUS_RE, "");
}

// ── Unicode letter class ─────────────────────────────────────
const LETTER = "a-zA-Z\\u00C0-\\u024F\\u1E00-\\u1EFF\\u00F1\\u00D1";

// ── Regex patterns (mirrored from backend schemas) ───────────
const NAME_RE = new RegExp(
  `^[${LETTER}]` +
  `[${LETTER}\\s'.\\-,]*` +
  `[${LETTER}.]$`
);
const NAME_SINGLE_RE = new RegExp(`^[${LETTER}]$`);
const CONSECUTIVE_SPECIALS_RE = new RegExp(`[^${LETTER}]{2,}`);

const INSTITUTION_RE = new RegExp(
  `^[${LETTER}0-9]` +
  `[${LETTER}0-9\\s'.\\-,()&#/]*` +
  `[${LETTER}0-9.)]*$`
);
const INSTITUTION_SINGLE_RE = new RegExp(`^[${LETTER}0-9]$`);

const MIN_LETTERS_RE = new RegExp(`([${LETTER}].*){2,}`);

const PHONE_RE = /^[+]?[\d\s\-()]+$/;
const PHONE_DIGIT_RE = /\d/g;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

// ── Zod schema builders (same logic as backend) ──────────────

const nameField = (label: string, required: boolean) => {
  const base = z.string().trim().max(100, `${label} must be at most 100 characters.`);

  if (!required) {
    return base
      .refine(
        (v) => {
          if (!v) return true;
          if (v.length === 1) return NAME_SINGLE_RE.test(v);
          return NAME_RE.test(v);
        },
        { message: `${label} must start and end with a letter and contain only letters, spaces, hyphens, apostrophes, periods, or commas.` }
      )
      .refine(
        (v) => !v || !CONSECUTIVE_SPECIALS_RE.test(v),
        { message: `${label} cannot have consecutive punctuation or special characters.` }
      );
  }

  return base
    .min(1, `${label} is required.`)
    .refine(
      (v) => v.length >= 2 ? NAME_RE.test(v) : NAME_SINGLE_RE.test(v),
      { message: `${label} must start and end with a letter and contain only letters, spaces, hyphens, apostrophes, periods, or commas.` }
    )
    .refine(
      (v) => !CONSECUTIVE_SPECIALS_RE.test(v),
      { message: `${label} cannot have consecutive punctuation or special characters.` }
    );
};

const institutionField = (label: string) =>
  z.string().trim()
    .min(1, `${label} is required.`)
    .max(150, `${label} must be at most 150 characters.`)
    .refine(
      (v) => v.length >= 2 ? INSTITUTION_RE.test(v) : INSTITUTION_SINGLE_RE.test(v),
      { message: `${label} must start with a letter or number and contain only letters, numbers, spaces, hyphens, apostrophes, periods, commas, parentheses, &, #, or /.` }
    )
    .refine(
      (v) => MIN_LETTERS_RE.test(v),
      { message: `${label} must contain at least 2 letters.` }
    );

const contactNumberField = (label: string, required: boolean) => {
  const base = z.string().trim();
  if (!required) {
    return base.refine(
      (v) => {
        if (!v) return true;
        if (!PHONE_RE.test(v)) return false;
        const digits = v.match(PHONE_DIGIT_RE) || [];
        return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
      },
      { message: `${label} must contain only digits (may start with +), with 7–15 digits total.` }
    );
  }
  return base
    .min(1, `${label} is required.`)
    .refine((v) => PHONE_RE.test(v), { message: `${label} must contain only digits, +, -, (, ), and spaces.` })
    .refine(
      (v) => {
        const digits = v.match(PHONE_DIGIT_RE) || [];
        return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
      },
      { message: `${label} must have between 7 and 15 digits.` }
    );
};

const emailField = (label: string, required: boolean) => {
  const base = z.string().trim();
  if (!required) {
    return base.refine(
      (v) => !v || EMAIL_RE.test(v),
      { message: `${label} must be a valid email (e.g. name@example.com).` }
    );
  }
  return base
    .min(1, `${label} is required.`)
    .refine((v) => EMAIL_RE.test(v), { message: `${label} must be a valid email (e.g. name@example.com).` });
};

// No more than 3 consecutive non-letter, non-digit characters
const CONSECUTIVE_SYMBOLS_RE = /[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u00F1\u00D10-9]{4,}/;

// At least 20 Unicode letters
const MIN_20_LETTERS_RE = new RegExp(`([${LETTER}].*){20,}`);

// Must start with a letter
const STARTS_WITH_LETTER_RE = new RegExp(`^[${LETTER}]`);

const textField = (label: string, maxLen: number = 1000) =>
  z.string().trim()
    .min(1, `${label} is required.`)
    .max(maxLen, `${label} must be at most ${maxLen} characters.`)
    .refine(
      (v) => STARTS_WITH_LETTER_RE.test(v),
      { message: `${label} must begin with a letter.` }
    )
    .refine(
      (v) => MIN_20_LETTERS_RE.test(v),
      { message: `${label} must contain at least 20 letters.` }
    );

// ── Exported Zod schemas ─────────────────────────────────────

/** Supervisor sub-schema. */
export const supervisorInputSchema = z.object({
  lastName: nameField("Supervisor last name", true),
  firstName: nameField("Supervisor first name", true),
  middleName: nameField("Supervisor middle name", false).optional().default(""),
  suffix: z.string().trim().max(10).optional().default(""),
  contactNumber: contactNumberField("Supervisor contact number", false).optional().default(""),
  email: emailField("Supervisor email", false).optional().default(""),
}).refine(
  (s) => !!(s.contactNumber?.trim()) || !!(s.email?.trim()),
  { message: "At least one of contact number or email is required for each supervisor." }
);

/** Trainee creation schema. */
export const createTraineeSchema = z.object({
  lastName: nameField("Last name", true),
  firstName: nameField("First name", true),
  middleName: nameField("Middle name", false).optional().default(""),
  suffix: z.string().trim().max(10).optional().default(""),
  email: emailField("Email", true),
  contactNumber: contactNumberField("Contact number", true),
  school: institutionField("School"),
  companyName: institutionField("Company name"),
  requiredHours: z.coerce.number().int().min(1, "Required hours must be at least 1."),
  password: z.string().min(1, "Password is required."),
  supervisors: z.array(supervisorInputSchema).optional(),
});

/** Trainee update schema (no password). */
export const updateTraineeSchema = z.object({
  lastName: nameField("Last name", true),
  firstName: nameField("First name", true),
  middleName: nameField("Middle name", false).optional().default(""),
  suffix: z.string().trim().max(10).optional().default(""),
  email: emailField("Email", true),
  contactNumber: contactNumberField("Contact number", true),
  school: institutionField("School"),
  companyName: institutionField("Company name"),
  requiredHours: z.coerce.number().int().min(1, "Required hours must be at least 1."),
});

/** Standalone supervisor schema. */
export const supervisorSchema = z.object({
  lastName: nameField("Last name", true),
  firstName: nameField("First name", true),
  middleName: nameField("Middle name", false).optional().default(""),
  suffix: z.string().trim().max(10).optional().default(""),
  contactNumber: contactNumberField("Contact number", false).optional().default(""),
  email: emailField("Email", false).optional().default(""),
}).refine(
  (s) => !!(s.contactNumber?.trim()) || !!(s.email?.trim()),
  { message: "At least one of contact number or email is required." }
);

/** Accomplishment field for log entries. */
export const accomplishmentSchema = textField("Accomplishment");

// ── Helper: format Zod errors to display string ──────────────
export function formatZodErrors(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join(" ");
}

// ── Legacy-compatible helpers (thin wrappers over Zod) ───────
// These are used by form components for field-level validation.

/** Validate a person name field. Returns error message or null. */
export function validateName(label: string, val: string, required: boolean): string | null {
  const schema = nameField(label, required);
  const result = schema.safeParse(val);
  if (!result.success) return result.error.issues[0].message;
  return null;
}

/** Validate an institution/company field. Returns error message or null. */
export function validateInstitution(label: string, val: string): string | null {
  const schema = institutionField(label);
  const result = schema.safeParse(val);
  if (!result.success) return result.error.issues[0].message;
  return null;
}

/** Validate email. Returns true if valid. */
export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

/** Validate phone. Returns true if valid. */
export function isValidPhone(v: string): boolean {
  const trimmed = v.trim();
  if (!PHONE_RE.test(trimmed)) return false;
  const digits = trimmed.match(PHONE_DIGIT_RE) || [];
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}

/** Check if value has only valid phone characters. */
export function phoneCharsOnly(v: string): boolean {
  return PHONE_RE.test(v.trim());
}

/** Validate accomplishment text. Returns error message or null. */
export function validateAccomplishment(v: string): string | null {
  const trimmed = v?.trim();
  if (!trimmed) return "Accomplishment is required.";
  if (!STARTS_WITH_LETTER_RE.test(trimmed)) return "Accomplishment must begin with a letter.";
  if (!MIN_20_LETTERS_RE.test(trimmed)) return "Accomplishment must contain at least 20 letters.";
  return null;
}

/** @deprecated Use validateAccomplishment instead. */
export function hasMinLetters(v: string): boolean {
  return MIN_20_LETTERS_RE.test(v);
}
