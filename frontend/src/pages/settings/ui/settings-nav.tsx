import { useEffect, useMemo, useRef, useState } from "react";

import { copy } from "shared/config/copy";
import { Button, Input } from "shared/ui";

import {
  matchesSetting,
  SECTION_ICONS,
  SECTION_TITLES,
  SETTINGS_INDEX,
  SETTINGS_SECTIONS,
  type SettingsIndexEntry,
  type SettingsSectionId,
} from "../model/settings-index";

interface SettingsNavProps {
  readonly active: SettingsSectionId;
  readonly query: string;
  onQueryChange(query: string): void;
  /** `settingId` is set when the reader picked a setting rather than a section. */
  onSelect(section: SettingsSectionId, settingId?: string): void;
}

/**
 * Section rail. Sections are always all visible, which is the whole reason a
 * rail beats a long scroll once a settings surface passes a handful of groups:
 * there is nothing to discover by scrolling.
 *
 * Typing replaces the section list with matching settings, each labelled with
 * the section that owns it, and picking one lands on that row rather than at
 * the top of its pane - the difference between "here is where it lives" and
 * "here it is". The field keeps focus while the arrow keys walk the results,
 * so a reader can type, arrow and Enter without leaving the keyboard. The
 * active row reuses the same secondary-surface treatment every other toggle in
 * the app uses; a rail is not the place to introduce a second visual language
 * for "selected".
 */
export function SettingsNav({
  active,
  query,
  onQueryChange,
  onSelect,
}: SettingsNavProps) {
  const trimmed = query.trim().toLocaleLowerCase();
  const results = useMemo(
    () =>
      trimmed
        ? SETTINGS_INDEX.filter((entry) => matchesSetting(entry, trimmed))
        : [],
    [trimmed],
  );
  // The cursor carries the query it was set against. A new query answers with
  // a different set, so the cursor belongs on its first row again - derived
  // here rather than reset from an effect, which would render the stale row
  // once before correcting itself.
  const [cursor, setCursor] = useState({ query: "", index: 0 });
  const activeIndex =
    cursor.query === trimmed
      ? Math.min(cursor.index, Math.max(results.length - 1, 0))
      : 0;
  const listRef = useRef<HTMLUListElement>(null);
  const moveCursor = (index: number) => setCursor({ query: trimmed, index });

  useEffect(() => {
    if (results.length === 0) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results.length]);

  const pick = (entry: SettingsIndexEntry) => {
    onSelect(entry.section, entry.id);
    onQueryChange("");
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor((activeIndex + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor((activeIndex - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      const entry = results[activeIndex];
      if (entry) {
        event.preventDefault();
        pick(entry);
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 w-56 shrink-0 flex-col gap-2 border-r border-border p-3">
      <Input
        value={query}
        onChange={onQueryChange}
        onKeyDown={onSearchKeyDown}
        placeholder={copy.settingsSearch}
        aria-label={copy.settingsSearch}
        aria-controls={trimmed ? "settings-search-results" : undefined}
        aria-activedescendant={
          results[activeIndex] ? resultId(results[activeIndex].id) : undefined
        }
      />
      {trimmed ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.length > 0 ? (
            <ul
              ref={listRef}
              id="settings-search-results"
              aria-label={copy.settingsSearchResults}
              className="flex flex-col gap-0.5"
            >
              {results.map((entry, index) => (
                <li key={entry.id}>
                  <Button
                    id={resultId(entry.id)}
                    variant={index === activeIndex ? "secondary" : "ghost"}
                    data-active={index === activeIndex ? "true" : undefined}
                    className="h-auto w-full justify-start rounded-lg px-2.5 py-1.5 text-left"
                    // Pointing at a row moves the keyboard cursor onto it, so
                    // the mouse and the arrow keys never disagree about which
                    // row Enter would open.
                    onPointerEnter={() => moveCursor(index)}
                    onClick={() => pick(entry)}
                  >
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="truncate text-sm text-foreground">
                        {entry.label}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {SECTION_TITLES[entry.section]}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {copy.settingsNoResults}
            </p>
          )}
        </div>
      ) : (
        <nav aria-label={copy.settings} className="min-h-0 flex-1">
          <ul className="flex flex-col gap-0.5">
            {SETTINGS_SECTIONS.map((section) => {
              const SectionIcon = SECTION_ICONS[section];
              const selected = section === active;
              return (
                <li key={section}>
                  <Button
                    variant={selected ? "secondary" : "ghost"}
                    aria-current={selected ? "page" : undefined}
                    className="w-full justify-start gap-2.5 rounded-lg px-2.5 text-sm"
                    onClick={() => onSelect(section)}
                  >
                    <SectionIcon
                      aria-hidden="true"
                      weight={selected ? "fill" : "regular"}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate">{SECTION_TITLES[section]}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}

function resultId(settingId: string): string {
  return `settings-search-${settingId}`;
}
