export class SlotTakenError extends Error {
  constructor() { super("slot_taken"); }
}

/** Another client already uses this name or website. */
export class DuplicateError extends Error {
  constructor(public field: "name" | "domain") { super(`duplicate_${field}`); }
}
