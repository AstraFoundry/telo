package compose

import (
	"context"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/config"
)

type (
	ctxT   = context.Context
	prefsT = preferences.Preferences
)

func pushRecent(list []string, glyph string) []string {
	return preferences.PushRecent(list, glyph, preferences.RecentEmojisMax)
}

func emojiCategoriesOrdered() []string { return config.EmojiCategories }

func emojiIn(category string) []config.Emoji {
	var out []config.Emoji
	for _, e := range config.EmojiSet {
		if e.Category == category {
			out = append(out, e)
		}
	}
	return out
}

// loadStickers reads the account's sticker catalog.
func (cp *Composer) loadStickers(env Env) {
	repo := env.Runtime.Repo()
	if repo == nil {
		return
	}
	env.Runtime.Go(func(ctx context.Context) func() {
		cat, err := repo.StickerCatalog(ctx)
		return func() {
			cp.loadingCat = false
			if err != nil {
				env.Store.Notify(err.Error(), true)
				return
			}
			cp.stickers = &cat
		}
	})
}

// loadSet reads one pack's stickers, once.
func (cp *Composer) loadSet(env Env, id int64) {
	if cp.stickerSet == nil {
		cp.stickerSet = map[int64]tg.StickerSet{}
	}
	if _, ok := cp.stickerSet[id]; ok {
		return
	}
	cp.stickerSet[id] = tg.StickerSet{}
	repo := env.Runtime.Repo()
	if repo == nil {
		return
	}
	env.Runtime.Go(func(ctx context.Context) func() {
		set, err := repo.StickerSet(ctx, id)
		return func() {
			if err == nil {
				cp.stickerSet[id] = set
			}
		}
	})
}

// RefreshStickers drops the cached catalog after a StickersChanged event.
func (cp *Composer) RefreshStickers() {
	cp.stickers, cp.stickerSet = nil, nil
}
