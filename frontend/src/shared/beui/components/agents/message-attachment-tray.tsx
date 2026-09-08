"use client";

import { File, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";

import { EASE_OUT } from "@beui-lib/ease";
import { Button } from "@components/motion/button";

export interface MessageAttachmentItem {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly previewUrl: string | null;
}

export interface MessageAttachmentTrayProps {
  readonly items: ReadonlyArray<MessageAttachmentItem>;
  readonly progress: number | null;
  readonly removeLabel: (name: string) => string;
  onRemove(id: string): void;
}

export function MessageAttachmentTray({
  items,
  progress,
  removeLabel,
  onRemove,
}: MessageAttachmentTrayProps) {
  const reduce = useReducedMotionConfig() ?? false;
  return (
    <div className="mb-1.5 flex gap-2 overflow-x-auto px-1 pb-1">
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            transition={{ duration: reduce ? 0.12 : 0.18, ease: EASE_OUT }}
            style={{ transformOrigin: "0% 100%" }}
            className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
          >
            {item.previewUrl ? (
              <img
                src={item.previewUrl}
                alt=""
                decoding="async"
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-muted-foreground">
                <File aria-hidden="true" className="size-5" />
                <span className="w-full truncate text-center text-[10px]">
                  {item.name}
                </span>
              </div>
            )}
            <Button
              size="icon"
              variant="secondary"
              disabled={progress !== null}
              aria-label={removeLabel(item.name)}
              onClick={() => onRemove(item.id)}
              className="absolute right-0 top-0 size-10 rounded-lg bg-background/90"
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
            {progress !== null ? (
              <div
                className="absolute inset-x-0 bottom-0 h-1 bg-foreground/10"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
