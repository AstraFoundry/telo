import { CheckCircle, Circle, MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import type { TelegramContactDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Avatar,
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  Input,
  Skeleton,
  SkeletonGroup,
  StatefulButton,
} from "shared/ui";

export type ContactAction = "contacts" | "secret" | "group";

interface ContactActionDialogProps {
  readonly action: ContactAction | null;
  onOpenChange(open: boolean): void;
}

const TITLES: Record<ContactAction, string> = {
  contacts: copy.contacts,
  secret: copy.startSecretChat,
  group: copy.newGroup,
};

export function ContactActionDialog({
  action,
  onOpenChange,
}: ContactActionDialogProps) {
  const selectChat = useChatStore((state) => state.select);
  const [contacts, setContacts] = useState<ReadonlyArray<TelegramContactDto>>(
    [],
  );
  const [query, setQuery] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(Boolean(action));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!action) return;
    let current = true;
    void window.telo.workspace
      .listContacts()
      .then((items) => {
        if (current) setContacts(items);
      })
      .catch(() => {
        if (current) setError(copy.contactsFailed);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [action]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) =>
      [contact.displayName, contact.username, contact.phone]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(needle)),
    );
  }, [contacts, query]);

  if (!action) return null;

  const close = () => onOpenChange(false);

  const openContact = async (userId: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const chat = await window.telo.workspace.openPrivateChat(userId);
      close();
      await selectChat(chat.id);
    } catch {
      setError(copy.createChatFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    const [userId] = selected;
    setSubmitting(true);
    setError(null);
    try {
      const chat =
        action === "secret"
          ? await window.telo.workspace.createSecretChat(userId ?? "")
          : await window.telo.workspace.createGroup({
              title: groupTitle,
              userIds: [...selected],
            });
      close();
      await selectChat(chat.id);
    } catch {
      setError(
        action === "secret"
          ? copy.startSecretChatFailed
          : copy.createChatFailed,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (userId: string) => {
    setSelected((current) => {
      if (action === "secret") return new Set([userId]);
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const ready =
    action === "secret"
      ? selected.size === 1
      : action === "group"
        ? selected.size > 0 && Boolean(groupTitle.trim())
        : false;

  return (
    <CenterMorphModal open onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={TITLES[action]}
        closeButtonLabel={copy.closeDialog}
        className="w-[min(92vw,440px)]"
      >
        <div className="flex max-h-[min(76vh,640px)] flex-col p-5">
          <h2 className="pr-10 text-base font-semibold">{TITLES[action]}</h2>
          {action === "group" ? (
            <Input
              label={copy.groupName}
              value={groupTitle}
              maxLength={128}
              onChange={setGroupTitle}
              className="mt-4"
            />
          ) : null}
          <Input
            value={query}
            onChange={setQuery}
            placeholder={copy.contactSearch}
            aria-label={copy.contactSearch}
            leftIcon={<MagnifyingGlass aria-hidden="true" />}
            className="mt-4"
          />

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <SkeletonGroup label={copy.loading} className="space-y-2 p-1">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="flex items-center gap-3 py-1.5">
                    <Skeleton circle className="size-10" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-2/5" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                  </div>
                ))}
              </SkeletonGroup>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {copy.noContacts}
              </p>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((contact) => {
                  const checked = selected.has(contact.id);
                  return (
                    <Button
                      key={contact.id}
                      type="button"
                      variant="ghost"
                      pressScale={1}
                      disabled={submitting}
                      aria-pressed={action === "contacts" ? undefined : checked}
                      onClick={() =>
                        action === "contacts"
                          ? void openContact(contact.id)
                          : toggle(contact.id)
                      }
                      className="h-auto w-full justify-start rounded-xl px-2 py-2 text-left"
                    >
                      <Avatar
                        src={contact.avatarDataUrl}
                        pending={contact.avatarPending}
                        placeholder={contact.avatarPlaceholder}
                        className="size-10"
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm font-semibold">
                          {contact.displayName}
                        </strong>
                        {contact.username || contact.phone ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {contact.username
                              ? `@${contact.username}`
                              : contact.phone}
                          </span>
                        ) : null}
                      </span>
                      {action !== "contacts" ? (
                        checked ? (
                          <CheckCircle
                            weight="fill"
                            aria-hidden="true"
                            className="size-5 text-primary"
                          />
                        ) : (
                          <Circle
                            aria-hidden="true"
                            className="size-5 text-muted-foreground/60"
                          />
                        )
                      ) : null}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          {action === "secret" && selected.size > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {copy.startSecretChatConfirm}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {action !== "contacts" ? (
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {copy.cancel}
              </Button>
              <StatefulButton
                type="button"
                state={submitting ? "loading" : "idle"}
                disabled={!ready}
                onClick={() => void submit()}
              >
                {action === "secret"
                  ? copy.startSecretChatAction
                  : copy.createGroup}
              </StatefulButton>
            </div>
          ) : null}
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
