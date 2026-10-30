// Package chatlist is the workspace's left column: the account button,
// search, folder tabs, the Archive row and the chat rows with their
// previews, badges and context menus.
package chatlist

import (
	"strings"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/features/chatactions"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Props is what the column needs from the page.
type Props struct {
	Tokens  theme.Tokens
	Store   *chat.Store
	Images  *media.Images
	Formats timefmt.Formats
	Prefs   preferences.Preferences
	// Header draws the account button and the compose menu.
	Header func(c *ui.Context)
	// Search draws the search field and, while searching, its results in
	// place of the list; it reports whether results are showing.
	Search func(c *ui.Context) bool
	// Open runs when a chat is chosen.
	Open func(id tg.ChatID)
}

// Column keeps the list's scroll state.
type Column struct {
	list    ui.ListState
	tabs    ui.ListState
	pending chatactions.Pending
}

// Render draws the column.
func (col *Column) Render(c *ui.Context, p Props) {
	t, s := p.Tokens, p.Store
	ui.Column(c).Fill().Background(t.Sidebar).Children(func() {
		p.Header(c)
		if p.Search != nil && p.Search(c) {
			return
		}
		col.folderTabs(c, p)
		chats := s.Visible()
		archive := s.Tab == chat.TabAll && s.HasArchive()
		rows := len(chats)
		if archive {
			rows++
		}
		col.list.Key = func(i int) any {
			if archive {
				if i == 0 {
					return "archive"
				}
				i--
			}
			if i < len(chats) {
				return chats[i].ID
			}
			return i
		}
		list := ui.List(c.Key("chats"), &col.list, rows, func(i int) {
			if archive {
				if i == 0 {
					archiveRow(c, p)
					return
				}
				i--
			}
			col.row(c, p, chats[i])
		}).Grow(1).Padding(4, 6).Gap(1).Label(copy.T(copy.Chats))
		list.Children(func() {
			if rows == 0 && s.Started && s.NextCursor == "" {
				key := copy.NoChats
				if s.Tab != chat.TabAll {
					key = copy.NoChatsInFolder
				}
				kit.Empty(c, t, icons.ChatCircle, copy.T(key))
			}
		})
		if _, last := col.list.Visible(); last >= rows-8 {
			s.LoadMoreChats()
		}
		if s.Tab == chat.TabArchive {
			ui.Row(c).Padding(8, 12).Children(func() {
				kit.SizedButton(c.Key("back-all"), t, kit.Ghost, kit.SizeSmall, icons.ArrowLeft, copy.T(copy.AllChats), true).OnClick(func() { s.Tab = chat.TabAll })
			})
		}
	})
	chatactions.Confirm(c, t, s, &col.pending)
}

// folderTabs draws All, the Telegram folders and the keyword folders as a
// row of tabs with unread counts; none when there are no folders.
func (col *Column) folderTabs(c *ui.Context, p Props) {
	t, s := p.Tokens, p.Store
	if len(s.Folders) == 0 && len(s.KeywordTabs) == 0 || s.Tab == chat.TabArchive {
		return
	}
	tabs := append([]tg.Folder{{ID: chat.TabAll, Title: copy.T(copy.AllChats)}}, s.Folders...)
	tabs = append(tabs, s.KeywordTabs...)
	ui.Row(c).Padding(2, 10, 6, 10).Gap(2).ClipX().FocusGroup(ui.Horizontal).Children(func() {
		for _, f := range tabs {
			tab := ui.ButtonBase(c.Key(f.ID)).Height(28).Padding(0, 10).Gap(6).Radius(theme.RadiusMD + 2).AlignItems(ui.Center).Label(f.Title)
			chosen := s.Tab == f.ID
			if chosen {
				tab.Background(t.AccentSoft).TextColor(t.AccentInk)
			} else if tab.Hovered() {
				tab.Background(t.Subtle)
			}
			unread := s.TabUnread(f.ID, p.Prefs.CountMuted)
			tab.Children(func() {
				ui.Text(c, f.Title).FontSize(theme.Callout).FontWeight(600).SingleLine()
				if unread > 0 {
					kit.Badge(c, t, copy.Count(unread), !chosen && f.ID != chat.TabAll).Height(16).MinWidth(16).Padding(0, 4)
				}
			})
			id := f.ID
			tab.OnClick(func() { s.Tab = id; col.list.ScrollTo(0, ui.Start) })
		}
	})
}

func archiveRow(c *ui.Context, p Props) {
	t, s := p.Tokens, p.Store
	row := ui.ButtonBase(c.Key("archive")).Height(48).Padding(0, 10).Gap(12).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(copy.T(copy.ArchivedChats))
	if row.Hovered() {
		row.Background(t.Subtle)
	}
	unread := s.TabUnread(chat.TabArchive, true)
	row.Children(func() {
		disc := ui.Row(c).Size(36, 36).Radius(18).Background(t.Faint.Alpha(0.35)).Justify(ui.Center).AlignItems(ui.Center)
		disc.Children(func() { ui.Icon(c, icons.Archive).FontSize(18).TextColor(t.Muted) })
		ui.Text(c, copy.T(copy.ArchivedChats)).FontSize(theme.Body).FontWeight(600).Grow(1).SingleLine()
		if unread > 0 {
			kit.Badge(c, t, copy.Count(unread), true)
		}
	})
	row.OnClick(func() { s.Tab = chat.TabArchive })
}

// row draws one chat.
func (col *Column) row(c *ui.Context, p Props, ch tg.Chat) {
	t, s := p.Tokens, p.Store
	selected := s.Selected == ch.ID
	row := ui.ButtonBase(c.Key(ch.ID)).Height(theme.ChatRowHeight).Padding(0, 9).Gap(11).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(title(ch))
	ink, muted := t.Text, t.Muted
	switch {
	case selected:
		row.Background(t.Selection)
		ink, muted = t.SelectionText, t.SelectionText.Alpha(0.78)
	case row.Hovered():
		row.Background(t.Subtle)
	}
	row.TextColor(ink)
	row.Children(func() {
		ui.Box(c).Size(48, 48).Shrink(0).Children(func() {
			kit.Avatar(c, t, p.Images, ch.Avatar, ch.Title, 48, ch.Kind == tg.ChatSaved)
			if ch.Online && (ch.Kind == tg.ChatDirect) {
				ring := t.Sidebar
				if selected {
					ring = t.Selection
				}
				kit.OnlineDot(c, t, ring, 14)
			}
		})
		ui.Column(c).Grow(1).Shrink(1).Gap(3).Children(func() {
			ui.Row(c).Gap(5).AlignItems(ui.Center).Children(func() {
				if ch.Kind == tg.ChatSecret {
					ui.Icon(c, icons.LockSimple).FontSize(13).TextColor(ifColor(selected, ink, t.Success))
				}
				ui.Text(c, title(ch)).FontSize(theme.Body).FontWeight(600).SingleLine().Shrink(1)
				if ch.Muted {
					ui.Icon(c, icons.BellSlash).FontSize(12).TextColor(muted)
				}
				ui.Spacer(c)
				ui.Text(c, p.Formats.ListTime(ch.UpdatedAt, p.Store.Now())).FontSize(theme.Caption).TextColor(muted).Shrink(0).SingleLine()
			})
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				preview(c, t, ch, selected, ink, muted)
				ui.Spacer(c)
				if ch.UnreadMentions > 0 {
					at := ui.Row(c).Size(20, 20).Radius(10).Background(ifColor(selected, t.SelectionText, t.Accent)).Justify(ui.Center).AlignItems(ui.Center).Shrink(0)
					at.Children(func() { ui.Icon(c, icons.At).FontSize(12).TextColor(ifColor(selected, t.Selection, t.AccentText)) })
				}
				switch {
				case ch.UnreadCount > 0 || ch.MarkedUnread:
					text := copy.Count(ch.UnreadCount)
					if ch.UnreadCount == 0 {
						text = ""
					}
					if selected {
						ui.Row(c).Height(20).MinWidth(20).Padding(0, 6).Radius(10).Background(t.SelectionText).Justify(ui.Center).AlignItems(ui.Center).Shrink(0).Children(func() {
							ui.Text(c, text).FontSize(12).FontWeight(600).TextColor(t.Selection).SingleLine()
						})
					} else {
						kit.Badge(c, t, text, ch.Muted)
					}
				case ch.Pinned:
					ui.Icon(c, icons.PushPin).FontSize(14).TextColor(muted)
				}
			})
		})
	})
	id := ch.ID
	row.OnClick(func() { p.Open(id) })
	row.PopoverMenu(func(m *ui.Menu) { chatactions.Menu(m, s, ch, s.Tab, &col.pending) })
}

func title(ch tg.Chat) string {
	if ch.Kind == tg.ChatSaved {
		return copy.T(copy.SavedMessages)
	}
	return ch.Title
}

// preview draws the second line: typing, a draft, or the last message.
func preview(c *ui.Context, t theme.Tokens, ch tg.Chat, selected bool, ink, muted ui.Color) {
	line := ui.RichText(c).FontSize(theme.Callout).SingleLine().Shrink(1).TextColor(muted)
	switch {
	case ch.Typing:
		line.Children(func() { ui.Text(c, copy.T(copy.Typing)).TextColor(ifColor(selected, ink, t.AccentInk)) })
	case ch.DraftPreview != "":
		line.Children(func() {
			ui.Text(c, copy.T(copy.DraftPrefix)+" ").TextColor(ifColor(selected, ink, t.Danger))
			ui.Text(c, oneLine(ch.DraftPreview))
		})
	default:
		line.Children(func() { ui.Text(c, oneLine(chat.Preview(ch))) })
	}
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func ifColor(cond bool, a, b ui.Color) ui.Color {
	if cond {
		return a
	}
	return b
}
