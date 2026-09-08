import { Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useState } from "react";

import {
  MEDIA_CACHE_LIMIT_MB_MAX,
  MEDIA_CACHE_LIMIT_MB_MIN,
  useAutoDownloadFiles,
  useAutoDownloadPhotos,
  useAutoDownloadVideos,
  useMediaCacheLimitMb,
} from "entities/preferences";
import { copy } from "shared/config/copy";
import {
  RangeSlider,
  SettingsGroup,
  SettingsRow,
  SettingsStackedRow,
  StatefulButton,
  Switch,
  type ButtonState,
} from "shared/ui";

/** Binary units, matching how the cache ceiling is expressed. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function StorageSection() {
  const limit = useMediaCacheLimitMb();
  const photos = useAutoDownloadPhotos();
  const videos = useAutoDownloadVideos();
  const files = useAutoDownloadFiles();
  const [usage, setUsage] = useState<number | null>(null);
  const [clearState, setClearState] = useState<ButtonState>("idle");

  const photosId = useId();
  const videosId = useId();
  const filesId = useId();
  const filesHintId = useId();

  const readUsage = useCallback(async () => {
    setUsage(await window.telo.storage.mediaCacheUsage());
  }, []);

  useEffect(() => {
    let live = true;
    void window.telo.storage.mediaCacheUsage().then((bytes) => {
      if (live) setUsage(bytes);
    });
    return () => {
      live = false;
    };
  }, []);

  const clear = async () => {
    setClearState("loading");
    try {
      await window.telo.storage.clearMediaCache();
      await readUsage();
      setClearState("success");
    } catch {
      setClearState("error");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Auto-download leads the pane: it decides what ever reaches the cache,
          so the cache rows below are downstream of these three switches. */}
      <SettingsGroup
        title={copy.autoDownload}
        description={copy.autoDownloadHint}
      >
        <SettingsRow
          label={copy.autoDownloadPhotos}
          labelFor={photosId}
          settingId="auto-download-photos"
        >
          <Switch
            id={photosId}
            checked={photos.value}
            onCheckedChange={photos.select}
          />
        </SettingsRow>
        <SettingsRow
          label={copy.autoDownloadVideos}
          labelFor={videosId}
          settingId="auto-download-videos"
        >
          <Switch
            id={videosId}
            checked={videos.value}
            onCheckedChange={videos.select}
          />
        </SettingsRow>
        <SettingsRow
          label={copy.autoDownloadFiles}
          description={copy.autoDownloadFilesHint}
          labelFor={filesId}
          descriptionId={filesHintId}
          settingId="auto-download-files"
        >
          <Switch
            id={filesId}
            describedBy={filesHintId}
            checked={files.value}
            onCheckedChange={files.select}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={copy.mediaCache} description={copy.mediaCacheHint}>
        <SettingsRow
          label={copy.mediaCacheUsage}
          // Until the first read lands the row shows the loading word rather
          // than a zero, which would read as an empty cache.
          value={usage === null ? copy.loading : formatBytes(usage)}
          settingId="media-cache-usage"
        />
        <SettingsStackedRow
          label={copy.mediaCacheLimit}
          description={copy.mediaCacheLimitHint}
          value={`${limit.value} MB`}
          settingId="media-cache-limit"
        >
          <RangeSlider
            min={MEDIA_CACHE_LIMIT_MB_MIN}
            max={MEDIA_CACHE_LIMIT_MB_MAX}
            step={64}
            value={limit.value}
            onValueChange={limit.select}
            aria-label={copy.mediaCacheLimit}
          />
        </SettingsStackedRow>
        {/* The group already says "Media cache"; a row labelled "Clear cache"
            wrapping a button labelled "Clear cache" would say it twice. */}
        <StatefulButton
          variant="ghost"
          state={clearState}
          loadingText={copy.loading}
          successText={copy.cacheCleared}
          errorText={copy.failed}
          icon={<Trash />}
          disabled={usage === 0}
          onClick={() => void clear()}
          // py-3 with 14px type lands at 38px; the row is a full-width target,
          // so it keeps the 40px floor rather than asking for a precise aim.
          className="min-h-10 w-full justify-start rounded-none px-4 py-3 text-sm font-medium"
        >
          {copy.clearCache}
        </StatefulButton>
      </SettingsGroup>
    </div>
  );
}
