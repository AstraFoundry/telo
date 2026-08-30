import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import type { ChatFolderDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  Input,
} from "shared/ui";

interface FolderDraft {
  readonly id: number | null;
  readonly title: string;
  readonly query: string;
}

const EMPTY_DRAFT: FolderDraft = { id: null, title: "", query: "" };

export function KeywordFoldersSettings() {
  const folders = useChatStore((state) => state.folders);
  const createKeywordFolder = useChatStore(
    (state) => state.createKeywordFolder,
  );
  const updateKeywordFolder = useChatStore(
    (state) => state.updateKeywordFolder,
  );
  const deleteKeywordFolder = useChatStore(
    (state) => state.deleteKeywordFolder,
  );
  const keywordFolders = useMemo(
    () => folders.filter((folder) => folder.kind === "keyword"),
    [folders],
  );
  const [draft, setDraft] = useState<FolderDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setError(null);
    setDraft(EMPTY_DRAFT);
  };
  const openEdit = (folder: ChatFolderDto) => {
    setError(null);
    setDraft({
      id: folder.id,
      title: folder.title,
      query: folder.query ?? "",
    });
  };
  const close = () => {
    setDraft(null);
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    try {
      if (draft.id === null) {
        await createKeywordFolder(draft.title, draft.query);
      } else {
        await updateKeywordFolder(draft.id, draft.title, draft.query);
      }
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    }
  };

  return (
    <section aria-labelledby="keyword-folders-settings-title">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {/* deslop-ignore-next-line 12 */}
          <h2
            id="keyword-folders-settings-title"
            className="text-sm font-semibold text-balance"
          >
            {copy.keywordFolders}
          </h2>
          <p className="text-xs text-muted-foreground">
            {copy.keywordFoldersHint}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={openCreate}
          className="shrink-0"
        >
          <Plus aria-hidden="true" />
          {copy.addKeywordFolder}
        </Button>
      </div>
      <ul className="mt-5 flex flex-col gap-3">
        {keywordFolders.length === 0 ? (
          <li className="text-sm text-muted-foreground">
            {copy.noKeywordFolders}
          </li>
        ) : (
          keywordFolders.map((folder) => (
            <li
              key={folder.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  {folder.title}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {folder.query}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={copy.editKeywordFolder}
                  onClick={() => openEdit(folder)}
                >
                  <PencilSimple />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={copy.deleteKeywordFolder}
                  onClick={() => void deleteKeywordFolder(folder.id)}
                >
                  <Trash />
                </Button>
              </div>
            </li>
          ))
        )}
      </ul>
      <CenterMorphModal
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <CenterMorphModalContent
          ariaLabel={
            draft?.id === null ? copy.addKeywordFolder : copy.editKeywordFolder
          }
          closeButtonLabel={copy.closeDialog}
        >
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {/* deslop-ignore-next-line 12 */}
            <h2 className="text-base font-semibold">
              {draft?.id === null
                ? copy.addKeywordFolder
                : copy.editKeywordFolder}
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
            <div className="flex flex-col gap-1.5">
              <Input
                label={copy.keywordFolderQuery}
                value={draft?.query ?? ""}
                onChange={(query) =>
                  setDraft((current) =>
                    current ? { ...current, query } : current,
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                {copy.keywordFolderQueryHint}
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <CenterMorphModalClose>
                <Button type="button" variant="ghost">
                  {copy.cancel}
                </Button>
              </CenterMorphModalClose>
              <Button type="submit" variant="primary">
                {copy.saveKeywordFolder}
              </Button>
            </div>
          </form>
        </CenterMorphModalContent>
      </CenterMorphModal>
    </section>
  );
}
