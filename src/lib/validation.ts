import { z } from "zod";
import { Decimal } from "@/lib/decimal";
import { ASSET_CLASSES, IMPORT_FIELDS } from "@/lib/csv";
import { RULE_KIND_INFO, RULE_KINDS } from "@/lib/rules";
import { isValidTimeZone } from "@/lib/tz";

export const SIDES = ["LONG", "SHORT"] as const;
export const TRADE_STATUSES = ["OPEN", "CLOSED"] as const;
export const TAG_KINDS = ["STRATEGY", "SETUP", "MISTAKE", "CUSTOM"] as const;
export const TRADE_SORT_KEYS = ["entryAt", "exitAt", "symbol", "pnl", "quantity", "rMultiple"] as const;
export const PAGE_SIZES = [25, 50, 100] as const;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Decimal as a canonical string; refuses floats that cannot be represented exactly. */
const decimalString = z
  .string()
  .trim()
  .regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/, "Enter a number")
  .transform((v) => new Decimal(v).toFixed());

const nonNegativeDecimal = decimalString.refine((v) => new Decimal(v).greaterThanOrEqualTo(0), "Must be zero or more");
const positiveDecimal = decimalString.refine((v) => new Decimal(v).greaterThan(0), "Must be greater than zero");

const optionalDecimal = z.preprocess(emptyToUndefined, nonNegativeDecimal.optional());
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === "1" || v === true, z.boolean());
const idList = z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []), z.array(z.string().max(64)).max(50));
const csvIdList = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : Array.isArray(v) ? v : []),
  z.array(z.string().max(64)).max(50),
);
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const rating5 = z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(5).optional());

export const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("Enter a valid email address").max(200),
);
export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(200, "Too long");
export const timeZoneSchema = z.string().trim().min(1).max(64).refine(isValidTimeZone, "Unknown time zone");

export const setupSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(100),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    timeZone: z.preprocess(emptyToUndefined, timeZoneSchema.optional()),
  })
  .refine((d) => d.password === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
  next: z.preprocess(emptyToUndefined, z.string().optional()),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

export const DISPLAY_MODES = ["R", "USD"] as const;

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  timeZone: timeZoneSchema,
  displayMode: z.preprocess(emptyToUndefined, z.enum(DISPLAY_MODES).default("R")),
});

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  broker: optionalText(60),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
  isDefault: checkbox,
});

export const tagSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(40),
  kind: z.enum(TAG_KINDS),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
});

export const tradeSchema = z.object({
  accountId: z.string().min(1, "Choose an account"),
  symbol: z
    .string()
    .trim()
    .min(1, "Enter a symbol")
    .max(32)
    .transform((s) => s.toUpperCase()),
  assetClass: z.enum(ASSET_CLASSES),
  side: z.enum(SIDES),
  quantity: positiveDecimal,
  entryPrice: nonNegativeDecimal,
  exitPrice: optionalDecimal,
  multiplier: z.preprocess(emptyToUndefined, positiveDecimal.optional()),
  fees: z.preprocess(emptyToUndefined, nonNegativeDecimal.optional()),
  entryAt: z.string().trim().min(1, "Enter the entry time"),
  exitAt: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  stopPrice: optionalDecimal,
  targetPrice: optionalDecimal,
  rating: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(5).optional()),
  notes: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().max(20000, "Notes are too long")),
  mistakes: optionalText(5000),
  tagIds: idList,
  /** One line explaining why a broken rule was accepted. */
  justification: optionalText(300),
  /** The break was a deliberate, planned exception rather than a lapse. */
  overridden: checkbox,
  /** Ids of the CUSTOM rules shown on the form, and the subset the owner ticked as followed. */
  customRuleIds: csvIdList,
  customFollowed: idList,
  /** A shared screenshot waiting to be attached to the new trade. */
  draftId: optionalText(64),
});
export type TradeInput = z.infer<typeof tradeSchema>;

export const ruleSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title").max(80),
    kind: z.enum(RULE_KINDS),
    value: z.preprocess(emptyToUndefined, nonNegativeDecimal.optional()),
    timeValue: z.preprocess(emptyToUndefined, z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm").optional()),
    active: checkbox,
  })
  .superRefine((d, ctx) => {
    const info = RULE_KIND_INFO[d.kind];
    if (info.parameter === "number" && d.value === undefined) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a limit" });
    }
    if (info.parameter === "time" && !d.timeValue) {
      ctx.addIssue({ code: "custom", path: ["timeValue"], message: "Enter a time" });
    }
  });
export type RuleInput = z.infer<typeof ruleSchema>;

export const checkInSchema = z.object({
  date: dateKeySchema,
  maxTrades: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1000).optional()),
  maxLossR: z.preprocess(emptyToUndefined, nonNegativeDecimal.optional()),
  allowedSetupIds: idList,
  focusNote: optionalText(500),
  mood: rating5,
  focus: rating5,
  energy: rating5,
  sleepHours: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(24).optional()),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const reviewSchema = z.object({
  date: dateKeySchema,
  wentRight: optionalText(2000),
  wentWrong: optionalText(2000),
  oneChange: optionalText(2000),
  dayTags: z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20) : []),
    z.array(z.string().max(40)),
  ),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export const justificationSchema = z.object({
  justification: z.string().trim().min(1, "Write one line").max(300),
  overridden: checkbox,
});

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const tradeFilterSchema = z.object({
  from: z.preprocess(emptyToUndefined, dateKey.optional()),
  to: z.preprocess(emptyToUndefined, dateKey.optional()),
  symbol: z.preprocess(emptyToUndefined, z.string().trim().max(32).optional()),
  side: z.preprocess(emptyToUndefined, z.enum(SIDES).optional()),
  status: z.preprocess(emptyToUndefined, z.enum(TRADE_STATUSES).optional()),
  tag: z.preprocess(emptyToUndefined, z.string().optional()),
  account: z.preprocess(emptyToUndefined, z.string().optional()),
  sort: z.preprocess(emptyToUndefined, z.enum(TRADE_SORT_KEYS).optional()),
  dir: z.preprocess(emptyToUndefined, z.enum(["asc", "desc"]).optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  pageSize: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
});
export type TradeFilterInput = z.infer<typeof tradeFilterSchema>;

export const importRequestSchema = z.object({
  accountId: z.string().min(1),
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200)),
  options: z.object({
    defaultAssetClass: z.enum(ASSET_CLASSES).optional(),
    defaultMultiplier: z.string().trim().max(32).optional(),
    dayFirst: z.boolean().optional(),
    timeZone: z.preprocess(emptyToUndefined, timeZoneSchema.optional()),
  }),
  rows: z.array(z.record(z.string().max(200), z.string().max(5000))).max(10000, "At most 10,000 rows per import"),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;
