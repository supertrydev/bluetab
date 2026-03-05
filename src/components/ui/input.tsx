import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Input Component
 * 
 * Form input using design tokens.
 * Transparent background inherits from parent surface.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Layout
          "flex h-10 w-full",
          // Appearance
          "rounded-md border border-border bg-transparent",
          "px-3 py-2 text-sm",
          "text-text-strong placeholder:text-text-muted",
          // Focus
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0",
          // States
          "disabled:cursor-not-allowed disabled:opacity-50",
          // File inputs
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-strong",
          // Transition
          "transition-colors duration-fast",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

