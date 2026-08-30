import {
  ChatTeardropText,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { useState } from "react";

import type { MessageTemplateDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import {
  Button,
  Input,
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
  OptionRow,
} from "shared/ui";

export interface TemplatePickerProps {
  readonly disabled?: boolean;
  readonly templates: ReadonlyArray<MessageTemplateDto>;
  onPick(body: string): void;
  onChange(templates: ReadonlyArray<MessageTemplateDto>): void;
}

type Draft = {
  readonly id: string | null;
  readonly title: string;
  readonly body: string;
};

/**
 * Composer template affordance: pick a saved reply to insert at the caret,
 * and create / edit / delete templates through preferences.update.
 */
export function TemplatePicker({
  disabled,
  templates,
  onPick,
  onChange,
}: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const closeForm = () => setDraft(null);

  const saveDraft = () => {
    if (!draft) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) return;
    const entry: MessageTemplateDto = {
      id: draft.id ?? crypto.randomUUID(),
      title,
      body,
    };
    const without = templates.filter((template) => template.id !== entry.id);
    onChange([...without, entry]);
    closeForm();
  };

  const pick = (template: MessageTemplateDto) => {
    onPick(template.body);
    setOpen(false);
    closeForm();
  };

  return (
    <MorphPopover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) closeForm();
      }}
    >
      <MorphPopoverTrigger>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label={copy.messageTemplates}
          className="size-10 rounded-full"
        >
          <ChatTeardropText aria-hidden="true" className="size-4" />
        </Button>
      </MorphPopoverTrigger>
      <MorphPopoverContent
        side="top"
        align="start"
        sideOffset={8}
        radius={12}
        className="w-72 p-2"
      >
        {draft ? (
          <div className="flex flex-col gap-2">
            <Input
              label={copy.messageTemplateTitle}
              value={draft.title}
              onChange={(title) => setDraft({ ...draft, title })}
            />
            <Input
              label={copy.messageTemplateBody}
              value={draft.body}
              onChange={(body) => setDraft({ ...draft, body })}
            />
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeForm}
              >
                {copy.cancel}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!draft.title.trim() || !draft.body.trim()}
                onClick={saveDraft}
              >
                {copy.saveMessageTemplate}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {templates.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                {copy.noMessageTemplates}
              </p>
            ) : (
              <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {templates.map((template) => (
                  <li
                    key={template.id}
                    className="flex items-center gap-0.5 rounded-lg"
                  >
                    <OptionRow
                      className="min-w-0 flex-1"
                      label={template.title}
                      description={template.body}
                      onClick={() => pick(template)}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-10 shrink-0"
                      aria-label={`${copy.editMessageTemplate}: ${template.title}`}
                      onClick={() =>
                        setDraft({
                          id: template.id,
                          title: template.title,
                          body: template.body,
                        })
                      }
                    >
                      <PencilSimple aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-10 shrink-0"
                      aria-label={`${copy.deleteMessageTemplate}: ${template.title}`}
                      onClick={() =>
                        onChange(
                          templates.filter((entry) => entry.id !== template.id),
                        )
                      }
                    >
                      <Trash aria-hidden="true" className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="ghost"
              className="justify-start"
              onClick={() => setDraft({ id: null, title: "", body: "" })}
            >
              <Plus aria-hidden="true" className="size-4" />
              {copy.newMessageTemplate}
            </Button>
          </div>
        )}
      </MorphPopoverContent>
    </MorphPopover>
  );
}
