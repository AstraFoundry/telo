import { ImageSquare } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  StoryActivePeriod,
  StoryPrivacy,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  Checkbox,
  ErrorRow,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatefulButton,
} from "shared/ui";

interface PostStoryDialogProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

async function preparePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(copy.storyMediaInvalid);
  const scale = Math.max(
    STORY_WIDTH / bitmap.width,
    STORY_HEIGHT / bitmap.height,
  );
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (STORY_WIDTH - width) / 2,
    (STORY_HEIGHT - height) / 2,
    width,
    height,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new Error(copy.storyMediaInvalid);
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

async function videoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        if (
          video.videoWidth !== 720 ||
          video.videoHeight !== 1280 ||
          video.duration <= 0 ||
          video.duration > 60
        ) {
          reject(new Error(copy.storyMediaInvalid));
          return;
        }
        resolve(video.duration);
      };
      video.onerror = () => reject(new Error(copy.storyMediaInvalid));
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PostStoryDialog({ open, onOpenChange }: PostStoryDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState<StoryPrivacy>("contacts");
  const [activePeriod, setActivePeriod] = useState<StoryActivePeriod>(86400);
  const [protectContent, setProtectContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const preview = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const choose = async (next: File | undefined) => {
    if (!next) return;
    setError(null);
    try {
      if (next.type.startsWith("image/")) {
        const prepared = await preparePhoto(next);
        if (prepared.size > 10 * 1024 * 1024) {
          throw new Error(copy.storyMediaInvalid);
        }
        setFile(prepared);
        return;
      }
      if (next.type === "video/mp4") {
        await videoDuration(next);
        setFile(next);
        return;
      }
      throw new Error(copy.storyMediaInvalid);
    } catch {
      setFile(null);
      setError(copy.storyMediaInvalid);
    }
  };

  const post = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const durationSeconds = file.type.startsWith("video/")
        ? await videoDuration(file)
        : undefined;
      await window.telo.workspace.postStory(file, {
        caption,
        privacy,
        activePeriod,
        durationSeconds,
        protectContent,
      });
      setPosted(true);
      window.setTimeout(() => {
        onOpenChange(false);
        setPosted(false);
        setFile(null);
        setCaption("");
      }, 900);
    } catch {
      setError(copy.storyPostFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={copy.newStory}
        closeButtonLabel={copy.closeDialog}
        dismissible={!busy}
        className="w-[min(92vw,460px)]"
      >
        <form
          className="flex max-h-[min(84vh,720px)] flex-col gap-4 overflow-y-auto p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (file) void post();
          }}
        >
          <h2 className="pr-10 text-base font-semibold">{copy.newStory}</h2>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/mp4"
            className="sr-only"
            aria-label={copy.storyMedia}
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          {preview && file ? (
            <div className="mx-auto aspect-[9/16] max-h-80 overflow-hidden rounded-2xl bg-muted shadow-sm">
              {file.type.startsWith("video/") ? (
                <video
                  src={preview}
                  controls
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  src={preview}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => inputRef.current?.click()}
              className="h-36 w-full flex-col rounded-2xl bg-muted/60 text-muted-foreground"
            >
              <ImageSquare aria-hidden="true" className="size-7" />
              {copy.chooseStoryMedia}
            </Button>
          )}
          {file ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => inputRef.current?.click()}
              className="self-center"
            >
              {copy.chooseStoryMedia}
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {file?.type.startsWith("video/")
              ? copy.storyVideoRequirement
              : copy.storyPhotoRequirement}
          </p>
          <Input
            label={copy.storyCaption}
            value={caption}
            onChange={setCaption}
          />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {copy.storyPrivacy}
            <Select
              value={privacy}
              onValueChange={(value) => setPrivacy(value as StoryPrivacy)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="everyone">
                  {copy.storyPrivacyEveryone}
                </SelectItem>
                <SelectItem value="contacts">
                  {copy.storyPrivacyContacts}
                </SelectItem>
                <SelectItem value="close-friends">
                  {copy.storyPrivacyCloseFriends}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {copy.storyDuration}
            <Select
              value={String(activePeriod)}
              onValueChange={(value) =>
                setActivePeriod(Number(value) as StoryActivePeriod)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="21600">
                  {copy.storyDuration6Hours}
                </SelectItem>
                <SelectItem value="43200">
                  {copy.storyDuration12Hours}
                </SelectItem>
                <SelectItem value="86400">
                  {copy.storyDuration24Hours}
                </SelectItem>
                <SelectItem value="172800">
                  {copy.storyDuration48Hours}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Checkbox
            checked={protectContent}
            onCheckedChange={setProtectContent}
            label={copy.storyProtectContent}
          />
          <ErrorRow message={error} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {copy.cancel}
            </Button>
            <StatefulButton
              type="submit"
              state={posted ? "success" : busy ? "loading" : "idle"}
              loadingText={copy.postingStory}
              successText={copy.storyPosted}
              disabled={!file}
            >
              {copy.postStory}
            </StatefulButton>
          </div>
        </form>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
