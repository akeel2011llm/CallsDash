export class SlotTakenError extends Error {
  constructor() { super("slot_taken"); }
}

/** Another client already uses this name or website, or another person this email. */
export class DuplicateError extends Error {
  constructor(public field: "name" | "domain" | "email") { super(`duplicate_${field}`); }
}
