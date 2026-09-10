import {
  CheckCircle,
  Circle,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useMemo, useState } from "react";

import {
  ARCHIVE_FOLDER_ID,
  type ChatFolderDto,
} from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Avatar,
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  EASE_OUT,
  ErrorRow,
  Input,
  LoadIndicator,
} from "shared/ui";

interface FolderDraft {
  /** null while creating; the Telegram dialog filter id while editing. */
  readonly id: number | null;
  readonly title: string;
  readonly chatIds: ReadonlySet<string>;
  /** Edit opens before getChatFolder answers; the chat list spins until then. */
  readonly loading: boolean;
  /** Two-step delete, arming like the settings logout button. */
  readonly confirmingDelete: boolean;
}

/**
 * Server chat folders (Telegram dialog filters, TDLib createChatFolder /
 * editChatFolder / deleteChatFolder), edited from Settings → Folders like
 * tdesktop. Kept visibly apart from the local keyword folders below it:
 * these sync with the account, keyword folders are Telo-local rules.
 */
export function ChatFoldersSettings() {
  const folders = useChatStore((state) => state.folders);
  const chats = useChatStore((state) => state.chats);
  const getChatFolder = useChatStore((state) => state.getChatFolder);
  const createChatFolder = useChatStore((state) => state.createChatFolder);
  const updateChatFolder = useChatStore((state) => state.updateChatFolder);
  const deleteChatFolder = useChatStore((state) => state.deleteChatFolder);
  const serverFolders = useMemo(
    // The Archive is a fixed system list, not an editable filter — both
    // reference clients exclude folder 1 from the editor (`filters_edit`).
    () =>
      folders.filter(
        (folder) =>
          folder.kind !== "keyword" && folder.id !== ARCHIVE_FOLDER_ID,
      ),
    [folders],
  );
  const [draft, setDraft] = useState<FolderDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Row entrance/exit shared with keyword-folders-settings.
  const reduceMotion = useReducedMotionConfig();
  const rowMotion = {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 },
    transition: { duration: reduceMotion ? 0.1 : 0.16, ease: EASE_OUT },
  } as const;

  const openCreate = () => {
    setError(null);
    setDraft({
      id: null,
      title: "",
      chatIds: new Set(),
      loading: false,
      confirmingDelete: false,
    });
  };
  const openEdit = (folder: ChatFolderDto) => {
    setError(null);
    setDraft({
      id: folder.id,
      title: folder.title,
      chatIds: new Set(),
      loading: true,
      confirmingDelete: false,
    });
    // Membership lives server-side (TDLib getChatFolder), not in the folder
    // list's unread-badge snapshot, so the editor reads it on open.
    void getChatFolder(folder.id)
      .then((details) => {
        setDraft((current) =>
          current?.id === folder.id && details
            ? {
                ...current,
                title: details.title,
                chatIds: new Set(details.includedChatIds),
                loading: false,
              }
            : current
              ? { ...current, loading: false }
              : current,
        );
      })
      .catch(() => {
        setDraft((current) =>
          current?.id === folder.id ? { ...current, loading: false } : current,
        );
        setError(copy.failed);
      });
  };
  const close = () => {
    setDraft(null);
    setError(null);
  };

  const toggleChat = (chatId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const chatIds = new Set(current.chatIds);
      if (chatIds.has(chatId)) chatIds.delete(chatId);
      else chatIds.add(chatId);
      return { ...current, chatIds };
    });
  };

  const save = async () => {
    if (!draft) return;
    try {
      if (draft.id === null) {
        await createChatFolder(draft.title, [...draft.chatIds]);
      } else {
        await updateChatFolder(draft.id, draft.title, [...draft.chatIds]);
      }
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    }
  };

  const remove = async () => {
    if (!draft || draft.id === null) return;
    if (!draft.confirmingDelete) {
      setDraft({ ...draft, confirmingDelete: true });
      return;
    }
    try {
      await deleteChatFolder(draft.id);
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    }
  };

  return (
    <section aria-labelledby="chat-folders-settings-title">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {/* deslop-ignore-next-line 12 */}
          <h2
            id="chat-folders-settings-title"
            className="text-sm font-semibold text-balance"
          >
            {copy.serverFolders}
          </h2>
          <p className="text-xs text-muted-foreground">
            {copy.serverFoldersHint}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={openCreate}
          className="shrink-0"
        >
          <Plus aria-hidden="true" />
          {copy.addServerFolder}
        </Button>
      </div>
      <ul className="mt-5 flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {serverFolders.length === 0 ? (
            <motion.li
              key="empty"
              {...rowMotion}
              className="text-sm text-muted-foreground"
            >
              {copy.noServerFolders}
            </motion.li>
          ) : (
            serverFolders.map((folder) => (
              <motion.li
                key={folder.id}
                {...rowMotion}
                className="flex items-center justify-between gap-3"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {folder.title}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={copy.editServerFolder}
                    onClick={() => openEdit(folder)}
                  >
                    <PencilSimple />
                  </Button>
                </div>
              </motion.li>
            ))
          )}
        </AnimatePresence>
      </ul>
      <CenterMorphModal
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <CenterMorphModalContent
          ariaLabel={
            draft?.id === null ? copy.addServerFolder : copy.editServerFolder
          }
          closeButtonLabel={copy.closeDialog}
          className="w-[min(92vw,440px)]"
        >
          <form
            className="flex max-h-[min(76vh,640px)] flex-col gap-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {/* deslop-ignore-next-line 12 */}
            <h2 className="text-base font-semibold">
              {draft?.id === null
                ? copy.addServerFolder
                : copy.editServerFolder}
            </h2>
            <Input
              label={copy.keywordFolderTitle}
              value={draft?.title ?? ""}
              onChange={(title) =>
                setDraft((current) =>
                  current ? { ...current, title } : current,
                )
              }
            />
            <fieldset className="flex min-h-0 flex-col gap-1.5">
              <legend className="text-xs font-medium text-muted-foreground">
                {copy.serverFolderChats}
              </legend>
              {draft?.loading ? (
                <LoadIndicator label={copy.loading} />
              ) : (
                <div className="max-h-56 min-h-0 overflow-y-auto">
                  {chats.map((chat) => {
                    const checked = draft?.chatIds.has(chat.id) ?? false;
                    return (
                      <Button
                        key={chat.id}
                        type="button"
                        variant="ghost"
                        pressScale={1}
                        aria-pressed={checked}
                        onClick={() => toggleChat(chat.id)}
                        className="h-auto w-full justify-start rounded-xl px-2 py-2 text-left"
                      >
                        <Avatar
                          src={chat.avatarDataUrl}
                          pending={chat.avatarPending}
                          placeholder={chat.avatarPlaceholder}
                          className="size-8"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {chat.title}
                        </span>
                        {checked ? (
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
                        )}
                      </Button>
                    );
                  })}
                </div>
              )}
            </fieldset>
            <ErrorRow message={error} />
            <div className="flex items-center justify-end gap-2">
              {draft !== null && draft.id !== null ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void remove()}
                  className="mr-auto text-destructive hover:bg-destructive/10"
                >
                  <Trash aria-hidden="true" />
                  {draft.confirmingDelete
                    ? copy.deleteServerFolderConfirm
                    : copy.deleteServerFolder}
                </Button>
              ) : null}
              <CenterMorphModalClose>
                <Button type="button" variant="ghost">
                  {copy.cancel}
                </Button>
              </CenterMorphModalClose>
              <Button
                type="submit"
                variant="primary"
                disabled={!draft?.title.trim() || draft.loading}
              >
                {copy.saveServerFolder}
              </Button>
            </div>
          </form>
        </CenterMorphModalContent>
      </CenterMorphModal>
    </section>
  );
}
