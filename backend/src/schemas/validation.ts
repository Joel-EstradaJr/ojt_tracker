// ============================================================
// Zod Validation Schemas
// Professional-grade validation for all OJT Tracker entities.
// ============================================================

import { z } from "zod";

// ── Unicode letter class (Latin + accented + ñ/Ñ) ───────────
const LETTER = "a-zA-Z\\u00C0-\\u024F\\u1E00-\\u1EFF\\u00F1\\u00D1";

// ── Shared regex patterns ────────────────────────────────────
// Name: letters, spaces, hyphens, apostrophes, periods, commas (suffix).
// Must start with a letter, no consecutive punctuation, no trailing punctuation.
const NAME_RE = new RegExp(
  `^[${LETTER}]` +                         // starts with a letter
  `[${LETTER}\\s'.\\-,]*` +                // body: letters + allowed punctuation
  `[${LETTER}.]$`                           // ends with a letter or period (e.g. "Jr.")
);
// Single-char names (just a letter) are handled by minLength
export const scriptCreateSchema = z.object({
  title: z.string().trim().min(2, "Script title must be at least 2 characters.").max(80),
  content: z.string().trim().min(2, "Script content must be at least 2 characters.").max(2000),
});

const NAME_SINGLE_RE = new RegExp(`^[${LETTER}]$`);

// No consecutive punctuation / special characters
const CONSECUTIVE_SPECIALS_RE = new RegExp(`[^${LETTER}]{2,}`);

// Institution/company: letters, numbers, spaces, hyphens, apostrophes,
// periods, commas, parentheses, ampersand, slash, #.
const INSTITUTION_RE = new RegExp(
  `^[${LETTER}0-9]` +                       // starts with letter or digit
  `[${LETTER}0-9\\s'.\\-,()&#/]*` +         // body
  `[${LETTER}0-9.)]*$`                      // ends with letter, digit, period, or ")"
);
const INSTITUTION_SINGLE_RE = new RegExp(`^[${LETTER}0-9]$`);

// At least 2 Unicode letters
const MIN_LETTERS_RE = new RegExp(`([${LETTER}].*){2,}`);

// Phone: digits, may start with +, 7-15 digits total
const PHONE_RE = /^[+]?[\d\s\-()]+$/;
const PHONE_DIGIT_RE = /\d/g;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

// Email
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

// ── Sanitisation ─────────────────────────────────────────────
// Strip XSS / injection vectors: < > { } [ ] \ ` ~ ^ | $ =
const DANGEROUS_RE = /[<>{}\[\]\\`~^|$=]/g;

// CSV injection: if first char is = + - @ TAB CR, prefix with single quote
const CSV_INJECT_RE = /^[=+\-@\t\r]/;

/** Strip dangerous characters from a string value. */
export function sanitizeString(val: string): string {
  return val.replace(DANGEROUS_RE, "").trim();
}

/** Escape a value for safe CSV output. */
export function csvSafe(val: string): string {
  if (CSV_INJECT_RE.test(val)) return `'${val}`;
  return val;
}

// ── Zod refinements ──────────────────────────────────────────

/** Name field: letters, spaces, hyphens, apostrophes, periods, commas. Max 100. */
const nameField = (label: string, required: boolean) => {
  const base = z
    .string()
    .trim()
    .max(100, `${label} must be at most 100 characters.`);

  if (!required) {
    // Optional: allow empty string or valid name
    return base
      .refine(
        (v) => {
          if (!v) return true; // empty is OK
          if (v.length < 2 && !NAME_SINGLE_RE.test(v)) return false;
          if (v.length === 1) return NAME_SINGLE_RE.test(v);
          return NAME_RE.test(v);
        },
        { message: `${label} must start and end with a letter and contain only letters, spaces, hyphens, apostrophes, periods, or commas.` }
      )
      .refine(
        (v) => !v || !CONSECUTIVE_SPECIALS_RE.test(v),
        { message: `${label} cannot have consecutive punctuation or special characters.` }
      )
      .transform((v) => v ? v.toUpperCase() : undefined); // convert empty to undefined, else ALL CAPS
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
    )
    .transform((v) => v.toUpperCase()); // ALL CAPS
};

/** Institution/company field: letters, numbers, common business punctuation. Max 150. */
const institutionField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(150, `${label} must be at most 150 characters.`)
    .refine(
      (v) => v.length >= 2 ? INSTITUTION_RE.test(v) : INSTITUTION_SINGLE_RE.test(v),
      { message: `${label} must start with a letter or number and contain only letters, numbers, spaces, hyphens, apostrophes, periods, commas, parentheses, &, #, or /.` }
    )
    .refine(
      (v) => MIN_LETTERS_RE.test(v),
      { message: `${label} must contain at least 2 letters.` }
    )
    .transform((v) => v.toUpperCase()); // ALL CAPS

/** Contact number: may start with +, digits/spaces/hyphens/parens, 7-15 digits. */
const contactNumberField = (label: string, required: boolean) => {
  const base = z.string().trim();

  if (!required) {
    return base
      .refine(
        (v) => {
          if (!v) return true;
          if (!PHONE_RE.test(v)) return false;
          const digits = v.match(PHONE_DIGIT_RE) || [];
          return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
        },
        { message: `${label} must contain only digits (may start with +), with 7–15 digits total.` }
      )
      .transform((v) => v || undefined);
  }

  return base
    .min(1, `${label} is required.`)
    .refine(
      (v) => PHONE_RE.test(v),
      { message: `${label} must contain only digits, +, -, (, ), and spaces.` }
    )
    .refine(
      (v) => {
        const digits = v.match(PHONE_DIGIT_RE) || [];
        return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
      },
      { message: `${label} must have between 7 and 15 digits.` }
    );
};

/** Email field. */
const emailField = (label: string, required: boolean) => {
  const base = z.string().trim();

  if (!required) {
    return base
      .refine(
        (v) => !v || EMAIL_RE.test(v),
        { message: `${label} must be a valid email (e.g. name@example.com).` }
      )
      .transform((v) => v || undefined);
  }

  return base
    .min(1, `${label} is required.`)
    .refine(
      (v) => EMAIL_RE.test(v),
      { message: `${label} must be a valid email (e.g. name@example.com).` }
    );
};

// No more than 3 consecutive non-letter, non-digit characters (symbols/spaces)
const CONSECUTIVE_SYMBOLS_RE = /[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u00F1\u00D10-9]{4,}/;

// At least 20 Unicode letters
const MIN_20_LETTERS_RE = new RegExp(`([${LETTER}].*){20,}`);

// Must start with a letter
const STARTS_WITH_LETTER_RE = new RegExp(`^[${LETTER}]`);

/** Accomplishment / remarks: any standard text, max 1000 chars, min 20 letters, must start with a letter. */
const textField = (label: string, maxLen: number = 1000) =>
  z
    .string()
    .trim()
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

// ── Trainee Schemas ──────────────────────────────────────────

/** Supervisor sub-schema (for inline creation during trainee creation). */
export const supervisorInputSchema = z
  .object({
    lastName: nameField("Supervisor last name", true),
    firstName: nameField("Supervisor first name", true),
    middleName: nameField("Supervisor middle name", false).optional().default(""),
    suffix: z.string().trim().max(10).optional().default("").transform((v) => v.toUpperCase()),
    contactNumber: contactNumberField("Supervisor contact number", false).optional().default(""),
    email: emailField("Supervisor email", false).optional().default(""),
  })
  .refine(
    (s) => {
      const hasPhone = !!s.contactNumber?.trim();
      const hasEmail = !!s.email?.trim();
      return hasPhone || hasEmail;
    },
    { message: "At least one of contact number or email is required for each supervisor." }
  );

/** Full trainee creation payload. */
export const createTraineeSchema = z.object({
  role: z.enum(["admin", "trainee"]).optional(),
  lastName: nameField("Last name", true),
  firstName: nameField("First name", true),
  middleName: nameField("Middle name", false).optional().default(""),
  suffix: z.string().trim().max(10).optional().default("").transform((v) => v.toUpperCase()),
  email: emailField("Email", true),
  contactNumber: contactNumberField("Contact number", true),
  school: institutionField("School"),
  companyName: institutionField("Company name"),
  requiredHours: z.coerce
    .number({ message: "Required hours must be a number." })
    .int("Required hours must be a whole number.")
    .min(1, "Required hours must be at least 1."),
  workSchedule: z.record(z.string(), z.object({ start: z.string(), end: z.string() })).optional(),
  password: z
    .string()
    .min(1, "Password is required.")
    .optional(),
  supervisors: z.array(supervisorInputSchema).optional(),
  verificationToken: z.string().min(1, "Email verification is required.").optional(),
});

/** Trainee update payload (password not required). */
export const updateTraineeSchema = z.object({
  lastName: nameField("Last name", true),
  firstName: nameField("First name", true),
  middleName: nameField("Middle name", false).optional().default(""),
  suffix: z.string().trim().max(10).optional().default("").transform((v) => v.toUpperCase()),
  email: emailField("Email", true),
  contactNumber: contactNumberField("Contact number", true),
  school: institutionField("School"),
  companyName: institutionField("Company name"),
  requiredHours: z.coerce
    .number({ message: "Required hours must be a number." })
    .int("Required hours must be a whole number.")
    .min(1, "Required hours must be at least 1."),
  workSchedule: z.record(z.string(), z.object({ start: z.string(), end: z.string() })).optional(),
  verificationToken: z.string().optional(),
});

export const scriptUpdateSchema = scriptCreateSchema;

// ── Supervisor Schema ────────────────────────────────────────

/** Standalone supervisor creation / update. */
export const supervisorSchema = z
  .object({
    lastName: nameField("Last name", true),
    firstName: nameField("First name", true),
    middleName: nameField("Middle name", false).optional().default(""),
    suffix: z.string().trim().max(10).optional().default("").transform((v) => v.toUpperCase()),
    contactNumber: contactNumberField("Contact number", false).optional().default(""),
    email: emailField("Email", false).optional().default(""),
  })
  .refine(
    (s) => {
      const hasPhone = !!s.contactNumber?.trim();
      const hasEmail = !!s.email?.trim();
      return hasPhone || hasEmail;
    },
    { message: "At least one of contact number or email is required." }
  );

// ── Log Entry Schemas ────────────────────────────────────────

/** Create log entry. */
export const createLogSchema = z.object({
  traineeId: z.string().uuid("Invalid trainee ID."),
  date: z.string().min(1, "Date is required."),
  timeIn: z.string().min(1, "Time In is required."),
  timeOut: z.string().optional(),
  lunchStart: z.string().optional(),
  lunchEnd: z.string().optional(),
  accomplishment: z.string().optional(),
  applyOffset: z.boolean().optional(),
  offsetAmount: z.number().optional(),
});

/** Update log entry (traineeId not required). */
export const updateLogSchema = z.object({
  date: z.string().min(1, "Date is required.").optional(),
  timeIn: z.string().min(1, "Time In is required.").optional(),
  timeOut: z.string().min(1, "Time Out is required.").optional(),
  lunchStart: z.string().min(1, "Lunch Start is required.").optional(),
  lunchEnd: z.string().min(1, "Lunch End is required.").optional(),
  accomplishment: textField("Accomplishment").optional(),
  applyOffset: z.boolean().optional(),
  offsetAmount: z.number().optional(),
});

// ── Helper: format Zod errors into a single string ───────────
export function formatZodErrors(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join(" ");
}
