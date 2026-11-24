import * as React from "react"

import { field } from "@/lib/styles"
import { cn } from "@/lib/utils"

/**
 * Input Component
 * 
 * Same height and shape as a button. Focus changes the border colour.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          field,
          "flex h-10 w-full min-w-0 rounded-input px-4 py-2 text-sm",
          // File inputs
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-strong",
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

