package storage

import (
	"context"

	"github.com/AstraFoundry/telo/backend/domain/keywordfolder"
	"github.com/AstraFoundry/telo/backend/domain/preferences"
)

// PreferencesFile keeps the preferences in a JSON file.
type PreferencesFile struct {
	File *JSON[preferences.Preferences]
}

func (f PreferencesFile) Get(context.Context) (preferences.Preferences, error) {
	p := preferences.Default()
	if _, err := f.File.Load(&p); err != nil {
		return preferences.Preferences{}, err
	}
	return p, nil
}

func (f PreferencesFile) Save(_ context.Context, p preferences.Preferences) error {
	return f.File.Save(p)
}

// KeywordFolderFile keeps the keyword folders, sealed: their terms can
// name people.
type KeywordFolderFile struct {
	File *Sealed[[]keywordfolder.Folder]
}

func (f KeywordFolderFile) List(context.Context) ([]keywordfolder.Folder, error) {
	var out []keywordfolder.Folder
	_, err := f.File.Load(&out)
	return out, err
}

func (f KeywordFolderFile) Save(_ context.Context, fs []keywordfolder.Folder) error {
	return f.File.Save(fs)
}

var (
	_ preferences.Store   = PreferencesFile{}
	_ keywordfolder.Store = KeywordFolderFile{}
)
