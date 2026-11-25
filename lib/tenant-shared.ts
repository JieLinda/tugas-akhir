// Client-safe tenant constants (lib/tenant.ts is server-only).

/**
 * Longest company name the header dropdown shows without truncating and
 * without widening. The sidebar is 16rem; its dropdown row leaves ~156px for a
 * name after the group padding, the row padding and the check mark, at 14px
 * Figtree medium — about 16 upper-case characters (≈9px each; mixed case fits
 * ~20). The trigger itself (12px, ~164px) is the looser of the two. The delete
 * icon overlays the end of a row only while it is hovered, so it costs nothing
 * here. Enforced by the create dialog and again by `createTenantAction`.
 */
export const TENANT_NAME_MAX_LENGTH = 16;

/** Every tenant uuid follows the seed format: this prefix + a 12-digit number. */
export const TENANT_ID_PREFIX = '10000000-0000-0000-0000-';

/** A company as the header dropdown needs it. */
export type TenantOption = {
  id: string;
  slug: string;
  name: string;
  isBuiltin: boolean;
};
