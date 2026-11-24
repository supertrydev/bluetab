/**
 * Looks shared by several primitives.
 * Fields use `field`, floating layers use `surface`, menu rows use `item`.
 */

/** Input, Textarea, Select, InputGroup. Focus turns the border to the accent instead of drawing an outline. */
export const field =
  "border border-field bg-bg-1 text-text-strong outline-none transition-colors duration-fast placeholder:text-text-muted " +
  "hover:border-text-muted focus-visible:border-ring focus-visible:outline-none aria-[invalid=true]:border-danger " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-field"

/** Menus, selects, popovers. */
export const surface =
  "rounded-md border border-border-glass bg-glass-bg backdrop-blur-md text-popover-foreground shadow-lg"

/** Menu and select rows. The fill marks the focused row. */
export const item =
  "relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
