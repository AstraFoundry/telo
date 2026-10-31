// Package chatactions is the chat list's context menu: read state, pin,
// mute with its durations, archive, folders, clearing history and leaving,
// as telegram-macos's chat row menu offers them. Destructive actions ask
// first in a dialog the caller draws with Confirm.
package chatactions

import (
	"slices"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Item is a chat menu action and the telegram-macos item it matches.
type Item struct {
	ID       string
	Upstream string
	Title    copy.Key
}

// Items is the registry the parity check reads.
var Items = []Item{
	{"read", "chat-action:chatListContextMaskAsRead", copy.MarkAsRead},
	{"unread", "chat-action:chatListContextMaskAsUnread", copy.MarkAsUnread},
	{"pin", "", copy.PinChat},
	{"unpin", "", copy.UnpinChat},
	{"mute-1h", "chat-action:chatListMute1Hour", copy.MuteFor1Hour},
	{"mute-8h", "chat-action:chatListMute8Hours", copy.MuteFor8Hours},
	{"mute-3d", "chat-action:chatListMute3Days", copy.MuteFor3Days},
	{"mute-forever", "chat-action:chatListMuteForever", copy.MuteForever},
	{"unmute", "chat-action:chatListContextSound", copy.UnmuteChat},
	{"archive", "chat-action:chatListSwipingArchive", copy.ArchiveChat},
	{"unarchive", "chat-action:chatListSwipingUnarchive", copy.UnarchiveChat},
	{"add-folder", "chat-action:chatListFilterAddToFolder", copy.AddToFolder},
	{"remove-folder", "chat-action:chatListFilterRemoveFromFolder", copy.RemoveFromFolder},
	{"clear", "chat-action:chatListContextClearHistory", copy.ClearHistory},
	{"delete", "chat-action:chatListContextDeleteChat", copy.DeleteChat},
	{"leave-group", "chat-action:chatListContextLeaveGroup", copy.LeaveGroup},
	{"leave-channel", "chat-action:chatListContextLeaveChannel", copy.LeaveChannel},
	{"delete-leave", "chat-action:chatListContextDeleteAndExit", copy.LeaveGroup},
}

// Pending is a destructive action waiting for confirmation.
type Pending struct {
	Chat    tg.Chat
	Action  string
	Open    bool
	ForAll  bool
	Confirm func()
}

// Menu fills a chat row's context menu. tab is the selected folder tab,
// for Remove From Folder.
func Menu(m *ui.Menu, s *chat.Store, c tg.Chat, tab int, pending *Pending) {
	if c.UnreadCount > 0 || c.MarkedUnread {
		if m.Item(copy.T(copy.MarkAsRead)).Chosen() {
			s.SetRead(c.ID, true)
		}
	} else if m.Item(copy.T(copy.MarkAsUnread)).Chosen() {
		s.SetRead(c.ID, false)
	}
	if c.Pinned {
		if m.Item(copy.T(copy.UnpinChat)).Chosen() {
			s.SetPinned(c.ID, false)
		}
	} else if m.Item(copy.T(copy.PinChat)).Chosen() {
		s.SetPinned(c.ID, true)
	}
	if c.Kind != tg.ChatSaved {
		if c.Muted {
			if m.Item(copy.T(copy.UnmuteChat)).Chosen() {
				s.Mute(c.ID, 0)
			}
		} else {
			m.Submenu(copy.T(copy.MuteChat), func(m *ui.Menu) {
				for _, d := range []struct {
					label copy.Key
					d     time.Duration
				}{{copy.MuteFor1Hour, time.Hour}, {copy.MuteFor8Hours, 8 * time.Hour}, {copy.MuteFor3Days, 72 * time.Hour}, {copy.MuteForever, -1}} {
					if m.Item(copy.T(d.label)).Chosen() {
						s.Mute(c.ID, d.d)
					}
				}
			})
		}
	}
	if c.Kind != tg.ChatSaved {
		if c.FolderID == tg.ArchiveFolderID {
			if m.Item(copy.T(copy.UnarchiveChat)).Chosen() {
				s.SetArchived(c.ID, false)
			}
		} else if m.Item(copy.T(copy.ArchiveChat)).Chosen() {
			s.SetArchived(c.ID, true)
		}
	}
	if len(s.Folders) > 0 {
		m.Submenu(copy.T(copy.AddToFolder), func(m *ui.Menu) {
			for _, f := range s.Folders {
				in := slices.Contains(c.FolderIDs, f.ID)
				if m.Item(f.Title).Checked(in).Chosen() {
					s.AddToFolder(c.ID, f.ID, !in)
				}
			}
		})
	}
	if tab > chat.TabArchive && slices.Contains(c.FolderIDs, tab) {
		if m.Item(copy.T(copy.RemoveFromFolder)).Chosen() {
			s.AddToFolder(c.ID, tab, false)
		}
	}
	m.Separator()
	if c.Kind != tg.ChatChannel {
		if m.Item(copy.T(copy.ClearHistory)).Chosen() {
			*pending = Pending{Chat: c, Action: "clear", Open: true}
		}
	}
	switch c.Kind {
	case tg.ChatGroup:
		if m.Item(copy.T(copy.LeaveGroup)).Chosen() {
			*pending = Pending{Chat: c, Action: "leave-group", Open: true}
		}
	case tg.ChatChannel:
		if m.Item(copy.T(copy.LeaveChannel)).Chosen() {
			*pending = Pending{Chat: c, Action: "leave-channel", Open: true}
		}
	case tg.ChatSaved:
	default:
		if m.Item(copy.T(copy.DeleteChat)).Chosen() {
			*pending = Pending{Chat: c, Action: "delete", Open: true}
		}
	}
}

// Confirm draws the confirmation of a pending destructive action.
func Confirm(c *ui.Context, t theme.Tokens, s *chat.Store, p *Pending) {
	if !p.Open {
		return
	}
	title, body, action := copy.ClearHistory, copy.ClearHistoryConfirm, copy.ClearHistory
	switch p.Action {
	case "delete":
		title, body, action = copy.DeleteChat, copy.DeleteChatConfirm, copy.DeleteChat
	case "leave-group":
		title, body, action = copy.LeaveGroup, copy.LeaveGroupConfirm, copy.LeaveGroup
	case "leave-channel":
		title, body, action = copy.LeaveChannel, copy.LeaveChannelConfirm, copy.LeaveChannel
	}
	kit.Dialog(c, t, &p.Open, 380, copy.T(title), copy.T(body), func() {
		if p.Action == "clear" && p.Chat.CanDeleteForAll && p.Chat.Kind == tg.ChatDirect {
			ui.Checkbox(c, &p.ForAll, copy.T(copy.AlsoForEveryone))
		}
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { p.Open = false })
		kit.Button(c.Key("confirm"), t, kit.Destructive, copy.T(action), true).OnClick(func() {
			p.Open = false
			switch p.Action {
			case "clear":
				s.ClearHistory(p.Chat.ID, p.ForAll)
			default:
				s.Leave(p.Chat.ID)
			}
		})
	})
}
