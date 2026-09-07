import {
  ArrowDownLeft,
  ArrowUpRight,
  Phone,
  VideoCamera,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import type { TelegramCallDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Avatar,
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  Skeleton,
  SkeletonGroup,
  StatefulButton,
} from "shared/ui";

interface CallHistoryDialogProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}

function callLabel(call: TelegramCallDto): string {
  if (call.kind === "missed") return copy.missedCall;
  return call.kind === "outgoing" ? copy.outgoingCall : copy.incomingCall;
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function CallHistoryDialog({
  open,
  onOpenChange,
}: CallHistoryDialogProps) {
  const selectChat = useChatStore((state) => state.select);
  const [calls, setCalls] = useState<ReadonlyArray<TelegramCallDto>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(open);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void window.telo.workspace
      .listCalls()
      .then((page) => {
        if (!current) return;
        setCalls(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (current) setError(copy.callsFailed);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await window.telo.workspace.listCalls(nextCursor);
      setCalls((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError(copy.callsFailed);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={copy.calls}
        closeButtonLabel={copy.closeDialog}
        className="w-[min(92vw,440px)]"
      >
        <div className="flex max-h-[min(76vh,640px)] flex-col p-5">
          <h2 className="pr-10 text-base font-semibold">{copy.calls}</h2>
          <div className="mt-4 min-h-0 overflow-y-auto">
            {loading ? (
              <SkeletonGroup label={copy.loading} className="space-y-3 p-1">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton circle className="size-10" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-2/5" />
                      <Skeleton className="h-3 w-3/5" />
                    </div>
                  </div>
                ))}
              </SkeletonGroup>
            ) : error ? (
              <p
                role="alert"
                className="py-10 text-center text-sm text-destructive"
              >
                {error}
              </p>
            ) : calls.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {copy.noCalls}
              </p>
            ) : (
              <div className="space-y-0.5">
                {calls.map((call) => {
                  const Direction =
                    call.kind === "outgoing" ? ArrowUpRight : ArrowDownLeft;
                  const Media = call.video ? VideoCamera : Phone;
                  return (
                    <Button
                      key={`${call.chatId}:${call.id}`}
                      variant="ghost"
                      pressScale={1}
                      onClick={() => {
                        onOpenChange(false);
                        void selectChat(call.chatId);
                      }}
                      className="h-auto w-full justify-start rounded-xl px-2 py-2 text-left"
                    >
                      <Avatar
                        src={call.avatarDataUrl}
                        placeholder={call.avatarPlaceholder}
                        className="size-10"
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm font-semibold">
                          {call.title}
                        </strong>
                        <span
                          className={`flex items-center gap-1 text-xs ${
                            call.kind === "missed"
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                        >
                          <Direction aria-hidden="true" className="size-3.5" />
                          {callLabel(call)}
                          {call.durationSeconds > 0
                            ? ` · ${duration(call.durationSeconds)}`
                            : null}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1 text-caption text-muted-foreground">
                        <Media aria-hidden="true" className="size-4" />
                        {new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                        }).format(new Date(call.occurredAt))}
                      </span>
                    </Button>
                  );
                })}
                {nextCursor ? (
                  <StatefulButton
                    type="button"
                    variant="ghost"
                    state={loadingMore ? "loading" : "idle"}
                    onClick={() => void loadMore()}
                    className="mt-2 w-full"
                  >
                    {copy.loadMore}
                  </StatefulButton>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
