package live

import (
	"context"
	"slices"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

func (s *Session) UpdateName(ctx context.Context, n tg.ProfileName) (tg.CurrentUser, error) {
	if _, err := s.td.SetName(ctx, &tdapi.SetNameRequest{FirstName: strings.TrimSpace(n.FirstName), LastName: strings.TrimSpace(n.LastName)}); err != nil {
		return tg.CurrentUser{}, err
	}
	return s.CurrentUser(ctx)
}

func (s *Session) UpdateBio(ctx context.Context, bio string) error {
	_, err := s.td.SetBio(ctx, &tdapi.SetBioRequest{Bio: strings.TrimSpace(bio)})
	return err
}

func (s *Session) CheckUsername(ctx context.Context, name string) (tg.UsernameAvailability, error) {
	r, err := s.td.CheckChatUsername(ctx, &tdapi.CheckChatUsernameRequest{Username: name})
	if err != nil {
		return tg.UsernameUnknown, err
	}
	switch r.(type) {
	case *tdapi.CheckChatUsernameResultOk:
		return tg.UsernameAvailable, nil
	case *tdapi.CheckChatUsernameResultUsernameInvalid:
		return tg.UsernameInvalid, nil
	case *tdapi.CheckChatUsernameResultUsernameOccupied, *tdapi.CheckChatUsernameResultUsernamePurchasable:
		return tg.UsernameTaken, nil
	}
	return tg.UsernameUnknown, nil
}

func (s *Session) SetUsername(ctx context.Context, name string) (tg.CurrentUser, error) {
	if _, err := s.td.SetUsername(ctx, &tdapi.SetUsernameRequest{Username: name}); err != nil {
		return tg.CurrentUser{}, err
	}
	return s.CurrentUser(ctx)
}

func (s *Session) SetProfilePhoto(ctx context.Context, f tg.UploadFile) (tg.CurrentUser, error) {
	if _, err := s.td.SetProfilePhoto(ctx, &tdapi.SetProfilePhotoRequest{Photo: &tdapi.InputChatPhotoStatic{Photo: &tdapi.InputFileLocal{Path: f.Path}}}); err != nil {
		return tg.CurrentUser{}, err
	}
	return s.CurrentUser(ctx)
}

func role(st tdapi.ChatMemberStatus) string {
	switch st.(type) {
	case *tdapi.ChatMemberStatusCreator:
		return "owner"
	case *tdapi.ChatMemberStatusAdministrator:
		return "admin"
	}
	return ""
}

func (s *Session) Members(ctx context.Context, chat tg.ChatID, query string) ([]tg.Member, error) {
	ms, err := s.td.SearchChatMembers(ctx, &tdapi.SearchChatMembersRequest{ChatID: int64(chat), Query: strings.TrimSpace(query), Limit: 200})
	if err != nil {
		return nil, notFound(err)
	}
	var missing []int64
	s.mu.Lock()
	for _, m := range ms.Members {
		if u, ok := m.MemberID.(*tdapi.MessageSenderUser); ok && s.users[u.UserID] == nil {
			missing = append(missing, u.UserID)
		}
	}
	s.mu.Unlock()
	for _, id := range missing {
		if u, err := s.td.GetUser(ctx, &tdapi.GetUserRequest{UserID: id}); err == nil {
			s.mu.Lock()
			s.users[id] = u
			s.mu.Unlock()
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []tg.Member
	for _, m := range ms.Members {
		u, ok := m.MemberID.(*tdapi.MessageSenderUser)
		if !ok {
			continue
		}
		user := s.users[u.UserID]
		out = append(out, tg.Member{ID: tg.UserID(u.UserID), DisplayName: userName(user), Avatar: s.userAvatarLocked(user),
			Role: role(m.Status), Online: online(user), Username: usernameOf(user)})
	}
	return out, nil
}

func usernameOf(u *tdapi.User) string {
	if u == nil {
		return ""
	}
	return username(u.Usernames)
}

func (s *Session) PeerProfile(ctx context.Context, chat tg.ChatID) (tg.PeerProfile, error) {
	c, err := s.Chat(ctx, chat)
	if err != nil {
		return tg.PeerProfile{}, err
	}
	out := tg.PeerProfile{ChatID: chat, Title: c.Title, Kind: c.Kind, Avatar: c.Avatar, MemberCount: c.MemberCount, Blocked: c.Blocked, UserID: c.UserID}
	s.mu.Lock()
	raw := s.chats[int64(chat)]
	s.mu.Unlock()
	switch t := raw.Type.(type) {
	case *tdapi.ChatTypePrivate, *tdapi.ChatTypeSecret:
		uid := peerUser(raw)
		u, err := s.td.GetUser(ctx, &tdapi.GetUserRequest{UserID: uid})
		if err != nil {
			return out, err
		}
		info, err := s.td.GetUserFullInfo(ctx, &tdapi.GetUserFullInfoRequest{UserID: uid})
		if err != nil {
			return out, err
		}
		s.mu.Lock()
		s.users[uid], s.userInfo[uid] = u, info
		s.mu.Unlock()
		out.Username, out.Phone, out.IsContact = username(u.Usernames), u.PhoneNumber, u.IsContact
		out.Online = online(u)
		if off, ok := u.Status.(*tdapi.UserStatusOffline); ok {
			out.LastSeen = unix(off.WasOnline)
		}
		if info.Bio != nil {
			out.Bio = info.Bio.Text
		}
		out.NeedPhonePrivacyException = info.NeedPhoneNumberPrivacyException
		out.CommonGroups = int(info.GroupInCommonCount)
		if _, ok := info.BlockList.(*tdapi.BlockListMain); ok {
			out.Blocked = true
		}
	case *tdapi.ChatTypeBasicGroup:
		info, err := s.td.GetBasicGroupFullInfo(ctx, &tdapi.GetBasicGroupFullInfoRequest{BasicGroupID: t.BasicGroupID})
		if err != nil {
			return out, err
		}
		out.Description = info.Description
		if info.InviteLink != nil {
			out.InviteLink = info.InviteLink.InviteLink
		}
	case *tdapi.ChatTypeSupergroup:
		info, err := s.td.GetSupergroupFullInfo(ctx, &tdapi.GetSupergroupFullInfoRequest{SupergroupID: t.SupergroupID})
		if err != nil {
			return out, err
		}
		out.Description, out.MemberCount = info.Description, int(info.MemberCount)
		if info.InviteLink != nil {
			out.InviteLink = info.InviteLink.InviteLink
		}
		s.mu.Lock()
		if g := s.super[t.SupergroupID]; g != nil {
			out.Username = username(g.Usernames)
		}
		s.mu.Unlock()
	}
	return out, nil
}

func (s *Session) Contacts(ctx context.Context) ([]tg.Contact, error) {
	us, err := s.td.GetContacts(ctx, &tdapi.GetContactsRequest{})
	if err != nil {
		return nil, err
	}
	var out []tg.Contact
	for _, id := range us.UserIDs {
		s.mu.Lock()
		u := s.users[id]
		s.mu.Unlock()
		if u == nil {
			if u, err = s.td.GetUser(ctx, &tdapi.GetUserRequest{UserID: id}); err != nil {
				return nil, err
			}
			s.mu.Lock()
			s.users[id] = u
			s.mu.Unlock()
		}
		s.mu.Lock()
		out = append(out, tg.Contact{ID: tg.UserID(id), DisplayName: userName(u), Username: username(u.Usernames), Phone: u.PhoneNumber,
			Avatar: s.userAvatarLocked(u), Online: online(u)})
		s.mu.Unlock()
	}
	slices.SortFunc(out, func(a, b tg.Contact) int {
		return strings.Compare(strings.ToLower(a.DisplayName), strings.ToLower(b.DisplayName))
	})
	return out, nil
}

func (s *Session) AddContactByPhone(ctx context.Context, in tg.ContactByPhone) (*tg.Contact, error) {
	r, err := s.td.ImportContacts(ctx, &tdapi.ImportContactsRequest{Contacts: []*tdapi.ImportedContact{{PhoneNumber: in.Phone, FirstName: in.FirstName, LastName: in.LastName}}})
	if err != nil {
		return nil, err
	}
	if len(r.UserIDs) == 0 || r.UserIDs[0] == 0 {
		// The number has no Telegram account.
		return nil, nil
	}
	u, err := s.td.GetUser(ctx, &tdapi.GetUserRequest{UserID: r.UserIDs[0]})
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[u.ID] = u
	return &tg.Contact{ID: tg.UserID(u.ID), DisplayName: userName(u), Username: username(u.Usernames), Phone: u.PhoneNumber, Avatar: s.userAvatarLocked(u)}, nil
}

func (s *Session) SetPeerContact(ctx context.Context, in tg.PeerContact) error {
	_, err := s.td.AddContact(ctx, &tdapi.AddContactRequest{UserID: int64(in.UserID),
		Contact: &tdapi.ImportedContact{FirstName: in.FirstName, LastName: in.LastName}, SharePhoneNumber: in.SharePhoneNumber})
	return err
}

func (s *Session) RemoveContact(ctx context.Context, user tg.UserID) error {
	_, err := s.td.RemoveContacts(ctx, &tdapi.RemoveContactsRequest{UserIDs: []int64{int64(user)}})
	return err
}

// senderOf names the peer a chat is with, for blocking.
func (s *Session) senderOf(chat tg.ChatID) tdapi.MessageSender {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c := s.chats[int64(chat)]; c != nil {
		if u := peerUser(c); u != 0 {
			return &tdapi.MessageSenderUser{UserID: u}
		}
	}
	return &tdapi.MessageSenderChat{ChatID: int64(chat)}
}

func (s *Session) SetBlocked(ctx context.Context, chat tg.ChatID, blocked bool) error {
	var list tdapi.BlockList
	if blocked {
		list = &tdapi.BlockListMain{}
	}
	_, err := s.td.SetMessageSenderBlockList(ctx, &tdapi.SetMessageSenderBlockListRequest{SenderID: s.senderOf(chat), BlockList: list})
	return err
}

func (s *Session) BlockedPeers(ctx context.Context) ([]tg.BlockedPeer, error) {
	r, err := s.td.GetBlockedMessageSenders(ctx, &tdapi.GetBlockedMessageSendersRequest{BlockList: &tdapi.BlockListMain{}, Limit: 100})
	if err != nil {
		return nil, err
	}
	var out []tg.BlockedPeer
	for _, sender := range r.Senders {
		if u, ok := sender.(*tdapi.MessageSenderUser); ok {
			s.mu.Lock()
			known := s.users[u.UserID] != nil
			s.mu.Unlock()
			if !known {
				if user, err := s.td.GetUser(ctx, &tdapi.GetUserRequest{UserID: u.UserID}); err == nil {
					s.mu.Lock()
					s.users[u.UserID] = user
					s.mu.Unlock()
				}
			}
		}
		s.mu.Lock()
		name, id, avatar := s.senderLocked(sender)
		s.mu.Unlock()
		out = append(out, tg.BlockedPeer{ID: id, Title: name, Avatar: avatar})
	}
	return out, nil
}

func (s *Session) ReportChat(ctx context.Context, chat tg.ChatID, reason string) error {
	_, err := s.td.ReportChat(ctx, &tdapi.ReportChatRequest{ChatID: int64(chat), Text: reason})
	return err
}

func (s *Session) Sessions(ctx context.Context) ([]tg.Session, error) {
	r, err := s.td.GetActiveSessions(ctx, &tdapi.GetActiveSessionsRequest{})
	if err != nil {
		return nil, err
	}
	out := make([]tg.Session, 0, len(r.Sessions))
	for _, x := range r.Sessions {
		out = append(out, tg.Session{ID: int64(x.ID), Current: x.IsCurrent, Application: x.ApplicationName, Version: x.ApplicationVersion,
			Device: x.DeviceModel, Platform: x.Platform, SystemVersion: x.SystemVersion, IP: x.IPAddress, Location: x.Location,
			LastActive: unix(x.LastActiveDate), LoggedIn: unix(x.LogInDate), Official: x.IsOfficialApplication})
	}
	return out, nil
}

func (s *Session) TerminateSession(ctx context.Context, id int64) error {
	_, err := s.td.TerminateSession(ctx, &tdapi.TerminateSessionRequest{SessionID: tdapi.Int64(id)})
	return err
}

func (s *Session) TerminateOtherSessions(ctx context.Context) error {
	_, err := s.td.TerminateAllOtherSessions(ctx, &tdapi.TerminateAllOtherSessionsRequest{})
	return err
}

func privacySetting(k tg.PrivacyKey) tdapi.UserPrivacySetting {
	switch k {
	case tg.PrivacyLastSeen:
		return &tdapi.UserPrivacySettingShowStatus{}
	case tg.PrivacyProfilePhoto:
		return &tdapi.UserPrivacySettingShowProfilePhoto{}
	case tg.PrivacyForwards:
		return &tdapi.UserPrivacySettingShowLinkInForwardedMessages{}
	case tg.PrivacyCalls:
		return &tdapi.UserPrivacySettingAllowCalls{}
	case tg.PrivacyGroupInvites:
		return &tdapi.UserPrivacySettingAllowChatInvites{}
	case tg.PrivacyPhoneNumber:
		return &tdapi.UserPrivacySettingShowPhoneNumber{}
	case tg.PrivacyBio:
		return &tdapi.UserPrivacySettingShowBio{}
	case tg.PrivacyVoiceNotes:
		return &tdapi.UserPrivacySettingAllowPrivateVoiceAndVideoNoteMessages{}
	}
	return nil
}

func userIDs(ids []int64) []tg.UserID {
	out := make([]tg.UserID, len(ids))
	for i, id := range ids {
		out[i] = tg.UserID(id)
	}
	return out
}

func (s *Session) Privacy(ctx context.Context, key tg.PrivacyKey) (tg.PrivacyRule, error) {
	r, err := s.td.GetUserPrivacySettingRules(ctx, &tdapi.GetUserPrivacySettingRulesRequest{Setting: privacySetting(key)})
	if err != nil {
		return tg.PrivacyRule{}, err
	}
	// TDLib reads the rules in order, the first that matches wins; Telo's
	// audience is the last catch-all, the exceptions the user lists.
	out := tg.PrivacyRule{Audience: tg.AudienceNobody}
	for _, rule := range r.Rules {
		switch v := rule.(type) {
		case *tdapi.UserPrivacySettingRuleAllowAll:
			out.Audience = tg.AudienceEveryone
		case *tdapi.UserPrivacySettingRuleAllowContacts:
			if out.Audience == tg.AudienceNobody {
				out.Audience = tg.AudienceContacts
			}
		case *tdapi.UserPrivacySettingRuleAllowUsers:
			out.Allow = append(out.Allow, userIDs(v.UserIDs)...)
		case *tdapi.UserPrivacySettingRuleRestrictUsers:
			out.Deny = append(out.Deny, userIDs(v.UserIDs)...)
		}
	}
	return out, nil
}

func (s *Session) SetPrivacy(ctx context.Context, key tg.PrivacyKey, rule tg.PrivacyRule) error {
	var rules []tdapi.UserPrivacySettingRule
	if len(rule.Deny) > 0 {
		ids := make([]int64, len(rule.Deny))
		for i, u := range rule.Deny {
			ids[i] = int64(u)
		}
		rules = append(rules, &tdapi.UserPrivacySettingRuleRestrictUsers{UserIDs: ids})
	}
	if len(rule.Allow) > 0 {
		ids := make([]int64, len(rule.Allow))
		for i, u := range rule.Allow {
			ids[i] = int64(u)
		}
		rules = append(rules, &tdapi.UserPrivacySettingRuleAllowUsers{UserIDs: ids})
	}
	switch rule.Audience {
	case tg.AudienceEveryone:
		rules = append(rules, &tdapi.UserPrivacySettingRuleAllowAll{})
	case tg.AudienceContacts:
		rules = append(rules, &tdapi.UserPrivacySettingRuleAllowContacts{}, &tdapi.UserPrivacySettingRuleRestrictAll{})
	default:
		rules = append(rules, &tdapi.UserPrivacySettingRuleRestrictAll{})
	}
	_, err := s.td.SetUserPrivacySettingRules(ctx, &tdapi.SetUserPrivacySettingRulesRequest{Setting: privacySetting(key), Rules: &tdapi.UserPrivacySettingRules{Rules: rules}})
	return err
}

func (s *Session) TwoStep(ctx context.Context) (tg.TwoStepState, error) {
	p, err := s.td.GetPasswordState(ctx, &tdapi.GetPasswordStateRequest{})
	if err != nil {
		return tg.TwoStepState{}, err
	}
	return tg.TwoStepState{Enabled: p.HasPassword, Hint: p.PasswordHint, RecoveryEmailSet: p.HasRecoveryEmailAddress}, nil
}

func (s *Session) PostStory(ctx context.Context, f tg.UploadFile, in tg.StoryInput) (tg.PostedStory, error) {
	s.mu.Lock()
	me := s.myID
	s.mu.Unlock()
	file := &tdapi.InputFileLocal{Path: f.Path}
	var c tdapi.InputStoryContent = &tdapi.InputStoryContentPhoto{Photo: file}
	video := strings.HasPrefix(f.MIMEType, "video/")
	if video {
		c = &tdapi.InputStoryContentVideo{Video: file, Duration: in.Duration.Seconds()}
	}
	var privacy tdapi.StoryPrivacySettings = &tdapi.StoryPrivacySettingsEveryone{}
	switch in.Privacy {
	case tg.StoryContacts:
		privacy = &tdapi.StoryPrivacySettingsContacts{}
	case tg.StoryCloseFriends:
		privacy = &tdapi.StoryPrivacySettingsCloseFriends{}
	}
	st, err := s.td.PostStory(ctx, &tdapi.PostStoryRequest{ChatID: me, Content: c, Caption: &tdapi.FormattedText{Text: in.Caption},
		PrivacySettings: privacy, ActivePeriod: int32(in.ActivePeriod), ProtectContent: in.ProtectContent, IsPostedToChatPage: true})
	if err != nil {
		return tg.PostedStory{}, err
	}
	at := unix(st.Date)
	if at.IsZero() {
		at = time.Now()
	}
	return tg.PostedStory{ID: st.ID, PostedAt: at, ExpiresAt: at.Add(time.Duration(in.ActivePeriod) * time.Second), Video: video}, nil
}
