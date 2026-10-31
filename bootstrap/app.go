// Package bootstrap is Telo's composition root: it opens the stores, the
// Telegram accounts over TDLib (or the demo workspace), the agent, and
// the window with its menus, and hands the runtime to the root view.
package bootstrap

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	agentapp "github.com/AstraFoundry/telo/backend/application/agent"
	kfapp "github.com/AstraFoundry/telo/backend/application/keywordfolder"
	prefapp "github.com/AstraFoundry/telo/backend/application/preferences"
	apptg "github.com/AstraFoundry/telo/backend/application/telegram"
	agentdomain "github.com/AstraFoundry/telo/backend/domain/agent"
	"github.com/AstraFoundry/telo/backend/domain/keywordfolder"
	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	agentinfra "github.com/AstraFoundry/telo/backend/infrastructure/agent"
	"github.com/AstraFoundry/telo/backend/infrastructure/storage"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib"
	"github.com/AstraFoundry/telo/backend/infrastructure/telegram/demo"
	"github.com/AstraFoundry/telo/backend/infrastructure/telegram/live"
	"github.com/AstraFoundry/telo/frontend/app"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	teloruntime "github.com/AstraFoundry/telo/frontend/shared/runtime"
	panes "github.com/AstraFoundry/telo/frontend/widgets/settings"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// Telegram API credentials, linked in by the release build
// (-ldflags "-X .../bootstrap.apiID=… -X .../bootstrap.apiHash=…").
var (
	apiID   string
	apiHash string
	// googleClientID is Telo's own Google Desktop OAuth client; Google
	// has no public native client to reuse.
	googleClientID string
)

// Options are the launch settings main reads from the environment.
type Options struct {
	// DataDir overrides the user data directory (isolated test profiles).
	DataDir string
	// Demo opens the demo workspace instead of Telegram.
	Demo bool
	// APIID and APIHash are a developer's own Telegram credentials for
	// `make dev`; a release links them in instead.
	APIID, APIHash string
}

// App is the running application.
type App struct {
	opts    Options
	rt      *teloruntime.Runtime
	root    *app.App
	desk    *desktop
	window  *mygo.Window
	view    *ui.Content
	close   []func()
	version string
}

// New prepares the application; Run starts it.
func New(opts Options) (*App, error) {
	return &App{opts: opts}, nil
}

func (a *App) dataDir() (string, error) {
	if a.opts.DataDir != "" {
		return a.opts.DataDir, nil
	}
	return mygo.App.Path(mygo.PathUserData)
}

func credentials(opts Options) (int32, string) {
	id, hash := apiID, apiHash
	if opts.APIID != "" {
		id, hash = opts.APIID, opts.APIHash
	}
	n, err := strconv.ParseInt(id, 10, 32)
	if err != nil {
		return 0, ""
	}
	return int32(n), hash
}

// accounts opens the demo workspace, or Telegram over TDLib.
func (a *App) accounts(dir string, keys *storage.Keychain) (tg.Accounts, string, error) {
	if a.opts.Demo {
		repo := demo.New(demo.Options{CacheDir: filepath.Join(dir, "demo-cache"), ReplyAfter: 2 * time.Second})
		a.close = append(a.close, repo.Close)
		return demo.NewAccounts(repo), "demo", nil
	}
	resources, _ := mygo.App.Path(mygo.PathResources)
	path, err := tdlib.Locate(filepath.Join(resources, "tdlib-native"), filepath.Join("build", "tdlib-native"))
	if err != nil {
		return nil, "", err
	}
	lib, err := tdlib.Load(path)
	if err != nil {
		return nil, "", err
	}
	version, _ := lib.Version()
	id, hash := credentials(a.opts)
	host, _ := os.Hostname()
	acc := live.NewAccounts(live.AccountsOptions{Library: lib, Directory: filepath.Join(dir, "telegram"), Keys: keys,
		Template: live.Config{APIID: id, APIHash: hash, Language: "en", Device: host, System: runtime.GOOS, Version: mygo.App.Version()}})
	a.close = append(a.close, func() { _ = acc.Close() })
	return acc, version, nil
}

func (a *App) build() error {
	dir, err := a.dataDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	keys := storage.NewKeychain()
	ctx := context.Background()
	prefs, err := prefapp.Load(ctx, storage.PreferencesFile{File: &storage.JSON[preferences.Preferences]{Path: filepath.Join(dir, "preferences.json")}}, a.opts.Demo)
	if err != nil {
		return err
	}
	folders := kfapp.New(storage.KeywordFolderFile{File: &storage.Sealed[[]keywordfolder.Folder]{Path: filepath.Join(dir, "keyword-folders.sealed"), Keys: keys, KeyName: "keyword-folders"}})
	accounts, tdVersion, err := a.accounts(dir, keys)
	if err != nil {
		return err
	}
	files := agentinfra.OpenFiles(filepath.Join(dir, "agent"), keys)
	if err := os.MkdirAll(filepath.Join(dir, "agent"), 0o700); err != nil {
		return err
	}
	var gateway agentdomain.Gateway = agentinfra.HTTP{}
	var catalog agentdomain.ModelCatalog = agentinfra.Catalog{}
	if a.opts.Demo {
		gateway, catalog = agentinfra.Demo{}, agentinfra.DemoCatalog{}
	}
	a.desk = &desktop{}
	clients := agentinfra.ClientIDsFromEnv()
	if _, set := clients[agentdomain.ProviderGoogle]; !set && googleClientID != "" {
		clients[agentdomain.ProviderGoogle] = googleClientID
	}
	oauth := &agentinfra.OAuth{ClientIDs: clients, Open: a.desk.OpenURL}
	agent := agentapp.New(agentapp.Deps{Configurations: files.Configuration, OAuth: oauth, Catalog: catalog, Gateway: gateway,
		Threads: files.Threads, Audits: files.Audits, Rules: files.Rules, Tasks: files.Tasks, Telegram: accounts.Active})
	id, _ := credentials(a.opts)
	a.rt = &teloruntime.Runtime{Accounts: accounts, Preferences: prefs, KeywordFolders: folders, Agent: agent, Desktop: a.desk, Demo: a.opts.Demo,
		Info: teloruntime.Info{Version: mygo.App.Version(), TDLib: tdVersion, TelegramConfigured: a.opts.Demo || id != 0, Platform: runtime.GOOS}}
	a.root = app.New(a.rt, app.Options{Region: region(), Mac: runtime.GOOS == "darwin"})
	a.desk.open = func(n apptg.Notification) {
		a.rt.Post(func() {
			a.root.Store.Select(n.ChatID)
			a.root.Store.JumpTo(n.ChatID, n.MessageID, nil)
		})
	}
	return accounts.Restore(ctx)
}

// region is the country of the user's regional formats ("GB" of
// "en-GB"), which the phone field starts with.
func region() string {
	loc := mygo.App.Region().Locale
	if i := strings.LastIndexAny(loc, "-_"); i >= 0 {
		return loc[i+1:]
	}
	return ""
}

// Run starts the application and blocks until it quits.
func (a *App) Run() error {
	if !mygo.App.RequestSingleInstanceLock() {
		return nil
	}
	var failure error
	mygo.App.WhenReady(func() {
		if err := a.build(); err != nil {
			failure = err
			mygo.Dialog.Error(copy.T(copy.AppName), err.Error())
			mygo.App.Quit()
			return
		}
		a.open()
	})
	mygo.App.OnSecondInstance(func([]string, string) { a.show() })
	mygo.App.OnActivate(func(bool) { a.show() })
	mygo.App.OnWindowAllClosed(func() {
		if runtime.GOOS != "darwin" {
			mygo.App.Quit()
		}
	})
	mygo.App.OnQuit(func() {
		if a.root != nil {
			a.root.Close()
		}
		for _, f := range a.close {
			f()
		}
	})
	if err := mygo.App.Run(); err != nil {
		return err
	}
	return failure
}

func (a *App) open() {
	a.view = ui.View(a.root.View)
	a.window = mygo.NewWindow(mygo.WindowOptions{Title: copy.T(copy.AppName), Width: 1180, Height: 760, MinWidth: 760, MinHeight: 520,
		TitleBarStyle: mygo.TitleBarHidden, StateKey: "main", Content: a.view})
	a.rt.Wake = a.window.Invalidate
	a.desk.window = a.window
	a.root.Start()
	mygo.App.SetMenu(mygo.NewMenu(MenuItems(Menus, a.action)))
	a.window.Focus()
}

func (a *App) show() {
	if a.window == nil {
		return
	}
	a.window.Show()
	a.window.Focus()
}

// action runs a menu item on the main thread's next frame.
func (a *App) action(name string) {
	switch name {
	case actHideWindow:
		a.window.Hide()
		return
	case actShowWindow:
		a.show()
		return
	case actUpdates:
		_, _ = mygo.Dialog.Message(mygo.MessageOptions{Message: copy.T(copy.MenuCheckUpdates), Detail: copy.T(copy.MenuUpdatesUnavailable)})
		return
	}
	a.rt.Post(func() {
		switch name {
		case actAbout:
			a.root.OpenSettings(panes.SectionAbout)
		case actSettings:
			a.root.OpenSettings(panes.SectionProfile)
		case actQuickSearch:
			a.root.FocusSearch()
		case actAgent:
			a.root.ToggleAgent()
		case actLock:
			a.root.Lock()
		}
	})
	a.show()
}
