import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogContentProps,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ModalTemplateProps extends DialogContentProps {
  open: boolean
  onOpenChange?: (open: boolean) => void
  dismissible?: boolean
  heading: React.ReactNode
  description?: React.ReactNode
  titleIcon?: React.ReactNode
  headerLeading?: React.ReactNode
  headerTrailing?: React.ReactNode
  headerClassName?: string
  headerContentClassName?: string
  titleClassName?: string
  descriptionClassName?: string
  bodyClassName?: string
  footer?: React.ReactNode
  footerClassName?: string
}

export function ModalTemplate({
  open,
  onOpenChange,
  dismissible = true,
  heading,
  description,
  titleIcon,
  headerLeading,
  headerTrailing,
  headerClassName,
  headerContentClassName,
  titleClassName,
  descriptionClassName,
  bodyClassName,
  footer,
  footerClassName,
  children,
  className,
  showCloseButton,
  onEscapeKeyDown,
  onInteractOutside,
  ...props
}: ModalTemplateProps) {
  const titleNode = (
    <DialogTitle
      className={cn(
        headerLeading ? undefined : 'flex items-center gap-2',
        titleClassName
      )}
    >
      {headerLeading ? null : titleIcon}
      {heading}
    </DialogTitle>
  )

  const descriptionNode = description ? (
    <DialogDescription className={cn('leading-relaxed', descriptionClassName)}>
      {description}
    </DialogDescription>
  ) : null

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!dismissible && !nextOpen) {
          return
        }
        onOpenChange?.(nextOpen)
      }}
    >
      <DialogContent
        showCloseButton={dismissible ? (showCloseButton ?? true) : false}
        className={cn('flex max-h-[88vh] flex-col overflow-hidden p-0 gap-0', className)}
        onEscapeKeyDown={(event) => {
          if (!dismissible) {
            event.preventDefault()
          }
          onEscapeKeyDown?.(event)
        }}
        onInteractOutside={(event) => {
          if (!dismissible) {
            event.preventDefault()
          }
          onInteractOutside?.(event)
        }}
        {...props}
      >
        <DialogHeader
          className={cn(
            'shrink-0 px-5 pt-5 pb-4 border-b border-border bg-bg-1/30 pe-12',
            headerClassName
          )}
        >
          <div className="flex items-start justify-between gap-4">
            {headerLeading ? (
              <div className="flex min-w-0 items-start gap-3">
                <div className="shrink-0">{headerLeading}</div>
                <div className={cn('min-w-0 space-y-1', headerContentClassName)}>
                  {titleNode}
                  {descriptionNode}
                </div>
              </div>
            ) : (
              <div className={cn('min-w-0 space-y-1', headerContentClassName)}>
                {titleNode}
                {descriptionNode}
              </div>
            )}
            {headerTrailing ? (
              <div className="flex shrink-0 items-center gap-2">
                {headerTrailing}
              </div>
            ) : null}
          </div>
        </DialogHeader>

        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4', bodyClassName)}>
          {children}
        </div>

        {footer ? (
          <DialogFooter
            className={cn(
              'shrink-0 px-5 py-4 border-t border-border bg-bg-1/20',
              footerClassName
            )}
          >
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

interface ModalTemplateSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  heading?: React.ReactNode
  description?: React.ReactNode
  tone?: 'default' | 'muted' | 'primary' | 'danger' | 'warning'
}

const SECTION_TONES: Record<NonNullable<ModalTemplateSectionProps['tone']>, string> = {
  default: 'border-border bg-bg-1/60',
  muted: 'border-border bg-muted/20',
  primary: 'border-primary/20 bg-primary/5',
  danger: 'border-danger/20 bg-danger/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
}

export function ModalTemplateSection({
  heading,
  description,
  tone = 'default',
  className,
  children,
  ...props
}: ModalTemplateSectionProps) {
  return (
    <section
      className={cn(
        'rounded-xl border p-4 space-y-3',
        SECTION_TONES[tone],
        className
      )}
      {...props}
    >
      {heading || description ? (
        <div className="space-y-1">
          {heading ? (
            <h4 className="text-sm font-medium text-text-strong">{heading}</h4>
          ) : null}
          {description ? (
            <p className="text-xs leading-relaxed text-text-muted">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function ModalTemplateMetricGrid({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)} {...props}>
      {children}
    </div>
  )
}

interface ModalTemplateMetricProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  value: React.ReactNode
}

export function ModalTemplateMetric({
  label,
  value,
  className,
  ...props
}: ModalTemplateMetricProps) {
  return (
    <div
      className={cn('rounded-md border border-border bg-bg-2 p-3', className)}
      {...props}
    >
      <div className="text-xs uppercase text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text-strong">{value}</div>
    </div>
  )
}
