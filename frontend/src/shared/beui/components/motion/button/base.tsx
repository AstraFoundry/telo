"use client";

import { type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { SPRING_PRESS } from "@beui-lib/ease";
import { cn } from "@/shared/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<
  HTMLMotionProps<"button">,
  "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  children?: ReactNode;
}

export interface ButtonLinkProps extends Omit<
  HTMLMotionProps<"a">,
  "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-card text-foreground hover:border-border",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-primary/5",
  outline:
    "border border-border bg-transparent text-foreground hover:bg-primary/5",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  // Compact only in type and padding: the vertical target stays at 40px so
  // dense action rows keep a desktop-sized hit area without overlapping.
  sm: "h-10 px-3.5 text-xs gap-1.5 rounded-full",
  md: "h-10 px-5 text-sm gap-2 rounded-full",
  lg: "h-12 px-6 text-base gap-2 rounded-full",
  // Dense desktop controls still owe a 40px target, so icon buttons carry it by
  // default instead of relying on every call site to pass `size-10`.
  icon: "size-10 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      pressScale = 0.96,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const reduce = useReducedMotion();

    return (
      <motion.button
        ref={ref}
        type="button"
        whileTap={reduce ? undefined : { scale: pressScale }}
        whileHover={undefined}
        transition={SPRING_PRESS}
        className={cn(
          "inline-flex items-center justify-center font-medium select-none",
          "transition-colors",
          "disabled:pointer-events-none disabled:opacity-50",
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          className,
        )}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink(
    {
      variant = "primary",
      size = "md",
      pressScale = 0.96,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const reduce = useReducedMotion();

    return (
      <motion.a
        ref={ref}
        whileTap={reduce ? undefined : { scale: pressScale }}
        whileHover={undefined}
        transition={SPRING_PRESS}
        className={cn(
          "inline-flex items-center justify-center font-medium select-none",
          "transition-colors",
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          className,
        )}
        {...rest}
      >
        {children}
      </motion.a>
    );
  },
);
