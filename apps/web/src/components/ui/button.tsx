import { Loader2 } from "lucide-react"
import type { ButtonHTMLAttributes, Ref } from "react"
import { cn } from "@/lib/utils"

const variants = {
  primary:
    "bg-primary text-primary-foreground border-primary shadow-xs shadow-[inset_0_1px_0_color-mix(in_oklab,#fff_16%,transparent)] hover:bg-primary/90 hover:border-primary/90 active:bg-primary/85 active:shadow-none active:scale-[0.98] data-[pressed]:bg-primary/85",
  outline:
    "bg-background border-border shadow-xs/5 hover:bg-accent/50 active:bg-accent data-[pressed]:bg-accent dark:bg-white/[0.025] dark:border-white/[0.08] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] dark:before:shadow-[0_-1px_color-mix(in_oklab,#fff_6%,transparent)] active:before:shadow-none",
  secondary:
    "bg-secondary text-secondary-foreground border-transparent hover:bg-secondary/80 active:bg-accent data-[pressed]:bg-accent",
  ghost:
    "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80 data-[pressed]:bg-accent/80",
  destructive:
    "bg-destructive text-white border-destructive hover:bg-destructive/90 active:bg-destructive/85",
  link: "border-transparent text-muted-foreground hover:text-foreground hover:underline underline-offset-4",
} as const

const sizes = {
  xs: "h-6 px-2 text-xs",
  sm: "h-7 px-2.5 text-xs",
  default: "h-8 px-2.5 text-sm",
  lg: "h-10 px-3.5 text-sm",
  xl: "h-12 px-5 text-sm",
} as const

const iconSizes = {
  xs: "size-6",
  sm: "size-7",
  default: "size-8",
  lg: "size-10",
  xl: "size-12",
} as const

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  icon?: boolean
  pending?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function buttonClass(
  variant: keyof typeof variants = "outline",
  size: keyof typeof sizes = "default",
  icon = false,
) {
  return cn(
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium outline-none transition-shadow [&_svg]:-mx-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-64 pointer-coarse:after:absolute pointer-coarse:after:left-1/2 pointer-coarse:after:top-1/2 pointer-coarse:after:size-11 pointer-coarse:after:-translate-1/2 pointer-coarse:after:content-['']",
    variants[variant],
    sizes[size],
    icon && iconSizes[size],
    icon && "px-0",
  )
}

export function Button({
  variant = "outline",
  size = "default",
  icon,
  pending,
  className,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(buttonClass(variant, size, icon), className)}
      {...props}
    >
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}
