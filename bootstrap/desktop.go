package bootstrap

import (
	"io"
	"os"
	"path/filepath"
	"strconv"

	apptg "github.com/AstraFoundry/telo/backend/application/telegram"
	"github.com/egoist/mygo"
)

// desktop is the runtime's OS adapter over MyGo.
type desktop struct {
	window *mygo.Window
	// open shows a chat when its notification is clicked.
	open func(n apptg.Notification)
}

func (d *desktop) OpenURL(u string) error { return mygo.Shell.OpenExternal(u) }

func (d *desktop) Notify(n apptg.Notification) {
	if !mygo.NotificationsSupported() {
		return
	}
	note := mygo.NewNotification(mygo.NotificationOptions{
		ID: strconv.FormatInt(int64(n.ChatID), 10) + ":" + strconv.FormatInt(int64(n.MessageID), 10), Title: n.Title, Body: n.Body,
		Silent: n.Silent, Group: strconv.FormatInt(int64(n.ChatID), 10)})
	note.OnClick(func() {
		if d.window != nil {
			d.window.Show()
			d.window.Focus()
		}
		if d.open != nil {
			d.open(n)
		}
	})
	_ = note.Show()
}

func (d *desktop) SetBadge(n int) { mygo.App.SetBadgeCount(n) }

func (d *desktop) WriteClipboard(s string) { mygo.Clipboard.WriteText(s) }

func (d *desktop) PickFiles(title string, multiple, images bool) []string {
	opts := mygo.OpenDialogOptions{Parent: d.window, Title: title, Multiple: multiple}
	if images {
		opts.Filters = []mygo.FileFilter{{Name: title, Extensions: []string{"png", "jpg", "jpeg", "gif", "webp", "heic", "mp4", "mov"}}}
	}
	paths, err := mygo.Dialog.Open(opts)
	if err != nil {
		return nil
	}
	return paths
}

func (d *desktop) SavePath(name string) string {
	home, _ := os.UserHomeDir()
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: d.window, DefaultPath: filepath.Join(home, "Downloads", name)})
	if err != nil {
		return ""
	}
	return path
}

func (d *desktop) CopyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func (d *desktop) RevealFile(path string) { mygo.Shell.ShowItemInFolder(path) }

func (d *desktop) OpenFile(path string) error { return mygo.Shell.OpenPath(path) }

func (d *desktop) Focused() bool { return d.window != nil && d.window.IsFocused() }
