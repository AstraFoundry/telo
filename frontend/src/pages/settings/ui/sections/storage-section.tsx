import { Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import {
  MEDIA_CACHE_LIMIT_MB_MAX,
  MEDIA_CACHE_LIMIT_MB_MIN,
  useMediaCacheLimitMb,
} from "entities/preferences";
import { copy } from "shared/config/copy";
import {
  RangeSlider,
  SettingsGroup,
  SettingsRow,
  SettingsStackedRow,
  StatefulButton,
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
  const [usage, setUsage] = useState<number | null>(null);
  const [clearState, setClearState] = useState<ButtonState>("idle");

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
      <SettingsGroup title={copy.mediaCache} description={copy.mediaCacheHint}>
        <SettingsRow
          label={copy.mediaCacheUsage}
          // Until the first read lands the row shows the loading word rather
          // than a zero, which would read as an empty cache.
          value={usage === null ? copy.loading : formatBytes(usage)}
        />
        <SettingsStackedRow
          label={copy.mediaCacheLimit}
          description={copy.mediaCacheLimitHint}
          value={`${limit.value} MB`}
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
          className="h-auto w-full justify-start rounded-none px-4 py-3 text-sm font-medium"
        >
          {copy.clearCache}
        </StatefulButton>
      </SettingsGroup>
    </div>
  );
}
