import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Button Component
 * 
 * Uses design tokens for consistent styling across themes.
 * Variants: primary, secondary, outline, soft, ghost, danger, link
 * Sizes: sm, md, lg, icon
 */
const buttonVariants = cva(
  // Base styles
  [
    "inline-flex items-center justify-center gap-2",
    "whitespace-nowrap font-medium",
    "rounded-full transition-all duration-normal select-none",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary - main CTA
        primary: [
          "bg-primary text-white",
          "shadow-sm hover:bg-primary-hover active:bg-primary-active",
        ].join(" "),

        // Secondary - subtle action
        secondary: [
          "bg-bg-2 text-text-strong border border-border",
          "shadow-sm hover:bg-[color-mix(in_srgb,var(--text-strong)_6%,var(--bg-2))]",
        ].join(" "),

        // Outline - bordered button
        outline: [
          "border border-border bg-transparent text-text-strong",
          "hover:bg-accent hover:border-primary hover:text-primary",
        ].join(" "),

        // Ghost - minimal
        ghost: [
          "text-text-default hover:bg-accent hover:text-text-strong",
        ].join(" "),

        // Soft - tinted action inside cards and rows
        soft: [
          "bg-primary-muted text-primary",
          "hover:bg-primary/20",
        ].join(" "),

        // Danger - destructive action
        danger: [
          "bg-danger text-white",
          "shadow-sm hover:bg-danger/90",
        ].join(" "),

        // Link - text only
        link: [
          "text-primary underline-offset-4",
          "hover:underline",
        ].join(" "),
      },
      size: {
        sm: "h-8 px-3.5 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

