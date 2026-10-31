package agent

import (
	"context"
	"fmt"
	"slices"
	"strings"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

var providerNames = map[domain.Provider]copy.Key{
	domain.ProviderOpenAI: copy.ProviderOpenAI, domain.ProviderAnthropic: copy.ProviderAnthropic, domain.ProviderGoogle: copy.ProviderGoogle,
	domain.ProviderGroq: copy.ProviderGroq, domain.ProviderXAI: copy.ProviderXAI, domain.ProviderKimi: copy.ProviderKimi,
	domain.ProviderDeepSeek: copy.ProviderDeepSeek, domain.ProviderMistral: copy.ProviderMistral, domain.ProviderCompatible: copy.ProviderCompatible,
}

// Settings is the agent pane of Settings.
type Settings struct {
	loaded   bool
	stored   domain.Configuration
	draft    domain.Configuration
	key      string
	models   []domain.Model
	oauth    []domain.Provider
	busy     bool
	rules    []domain.Rule
	tasks    []domain.Task
	rule     ruleDraft
	task     taskDraft
	modelErr error
}

type ruleDraft struct {
	open                   bool
	name, keywords, prompt string
	delivery               domain.Delivery
}

type taskDraft struct {
	open               bool
	name, cron, prompt string
	chat               tg.ChatID
	delivery           domain.Delivery
}

func (s *Settings) load(env Env) {
	svc := env.Runtime.Agent
	env.Runtime.Go(func(ctx context.Context) func() {
		cfg, err := svc.Configuration(ctx)
		rules, _ := svc.Rules(ctx)
		tasks, _ := svc.Tasks(ctx)
		return func() {
			if err != nil {
				env.Store.Notify(err.Error(), true)
				return
			}
			s.stored, s.draft, s.rules, s.tasks, s.oauth = cfg, cfg, rules, tasks, svc.OAuthProviders()
		}
	})
}

// Render draws the pane.
func (s *Settings) Render(c *ui.Context, env Env) {
	t := env.Tokens
	if env.Runtime.Agent == nil {
		return
	}
	if !s.loaded {
		s.loaded = true
		s.load(env)
	}
	d := &s.draft
	kit.Group(c, t, copy.T(copy.AgentProvider), "", func() {
		kit.Row(c, t, copy.T(copy.AgentProvider), "", func() {
			before := d.Provider
			if kit.Select(c.Key("provider"), t, &d.Provider, copy.T(copy.AgentProvider), domain.Providers, func(p domain.Provider) string { return copy.T(providerNames[p]) }) && d.Provider != before {
				d.Model, s.models, s.key = d.Provider.DefaultModel(), nil, ""
			}
		})
		if slices.Contains(s.oauth, d.Provider) {
			kit.Divider(c, t)
			s.oauthRow(c, env)
		}
		kit.Divider(c, t)
		ui.Column(c).Padding(10, 16).Gap(8).Children(func() {
			kit.Field(ui.TextInput(c.Key("key"), &s.key).Password().Label(copy.T(copy.AgentAPIKey)).Placeholder(copy.T(copy.AgentAPIKeyPlaceholder)), t)
			if d.Provider == domain.ProviderCompatible {
				kit.Field(ui.TextInput(c.Key("base"), &d.BaseURL).Label(copy.T(copy.AgentBaseURL)).Placeholder("https://"), t)
			}
		})
	})
	kit.Group(c, t, copy.T(copy.AgentModel), "", func() {
		ui.Row(c).Padding(10, 16).Gap(8).AlignItems(ui.Center).Children(func() {
			if len(s.models) > 0 {
				ids := make([]string, len(s.models))
				for i, m := range s.models {
					ids[i] = m.ID
				}
				if !slices.Contains(ids, d.Model) {
					ids = append([]string{d.Model}, ids...)
				}
				kit.Select(c.Key("model"), t, &d.Model, copy.T(copy.AgentModel), ids, func(id string) string {
					for _, m := range s.models {
						if m.ID == id && m.Label != "" {
							return m.Label
						}
					}
					return id
				})
				ui.Spacer(c)
			} else {
				kit.Field(ui.TextInput(c.Key("model"), &d.Model).Label(copy.T(copy.AgentModel)).Placeholder(d.Provider.DefaultModel()), t).Grow(1)
			}
			kit.SizedButton(c.Key("load"), t, kit.Outline, kit.SizeSmall, icons.ArrowClockwise, copy.T(copy.AgentLoadModels), !s.busy).OnClick(func() { s.loadModels(env) })
		})
		if s.modelErr != nil {
			ui.Box(c).Padding(0, 16, 10, 16).Children(func() { kit.Status(c, t, icons.WarningCircle, t.Danger, ErrorText(s.modelErr)) })
		}
	})
	kit.Group(c, t, copy.T(copy.AgentInstructions), "", func() {
		ui.Column(c).Padding(10, 16).Children(func() {
			kit.Field(ui.TextArea(c.Key("instructions"), &d.Instructions).Lines(3, 8).Label(copy.T(copy.AgentInstructions)), t)
		})
		kit.Divider(c, t)
		kit.SwitchRow(c.Key("inspect"), t, &d.CanInspectWorkspace, copy.T(copy.AgentInspect), "")
		kit.Divider(c, t)
		slider(c, t, copy.AgentTemperature, &d.Temperature, domain.TemperatureMin, domain.TemperatureMax, 0.1, fmt.Sprintf("%.1f", d.Temperature))
		kit.Divider(c, t)
		steps := float64(d.MaxSteps)
		slider(c, t, copy.AgentMaxSteps, &steps, domain.MaxStepsMin, domain.MaxStepsMax, 1, fmt.Sprint(d.MaxSteps))
		d.MaxSteps = int(steps)
		kit.Divider(c, t)
		history := float64(d.HistoryLimit)
		slider(c, t, copy.AgentHistoryLimit, &history, domain.HistoryLimitMin, domain.HistoryLimitMax, 1, fmt.Sprint(d.HistoryLimit))
		d.HistoryLimit = int(history)
	})
	ui.Row(c).Justify(ui.End).Children(func() {
		changed := *d != s.stored || s.key != ""
		kit.Button(c.Key("save"), t, kit.Primary, copy.T(copy.Save), changed && !s.busy).OnClick(func() { s.save(env) })
	})
	s.automation(c, env)
}

func slider(c *ui.Context, t theme.Tokens, title copy.Key, value *float64, lo, hi, step float64, shown string) {
	kit.Row(c.Key(title), t, copy.T(title), "", func() {
		ui.Slider(c, value, lo, hi).Step(step).Label(copy.T(title)).Width(160)
		ui.Text(c, shown).FontSize(theme.Callout).TextColor(t.Muted).Width(28).FontFeatures("tnum")
	})
}

func (s *Settings) oauthRow(c *ui.Context, env Env) {
	t := env.Tokens
	o := s.stored.OAuth
	if o != nil && s.stored.Provider == s.draft.Provider {
		kit.Row(c, t, copy.F(copy.AgentConnected, o.AccountLabel), "", func() {
			kit.SizedButton(c.Key("disconnect"), t, kit.Ghost, kit.SizeSmall, nil, copy.T(copy.AgentDisconnect), !s.busy).OnClick(func() {
				svc := env.Runtime.Agent
				s.busy = true
				env.Runtime.Go(func(ctx context.Context) func() {
					cfg, err := svc.Disconnect(ctx)
					return func() { s.done(env, cfg, err) }
				})
			})
		})
		return
	}
	kit.Row(c, t, copy.T(copy.AgentConnect), "", func() {
		kit.SizedButton(c.Key("connect"), t, kit.Outline, kit.SizeSmall, icons.PlugsConnected, copy.T(copy.AgentConnect), !s.busy).OnClick(func() {
			svc, p := env.Runtime.Agent, s.draft.Provider
			s.busy = true
			env.Runtime.Go(func(ctx context.Context) func() {
				cfg, err := svc.Connect(ctx, p)
				return func() { s.done(env, cfg, err) }
			})
		})
	})
}

func (s *Settings) done(env Env, cfg domain.Configuration, err error) {
	s.busy = false
	if err != nil {
		env.Store.Notify(ErrorText(err), true)
		return
	}
	s.stored, s.draft, s.key = cfg, cfg, ""
}

func (s *Settings) loadModels(env Env) {
	svc, d, key := env.Runtime.Agent, s.draft, s.key
	s.busy, s.modelErr = true, nil
	env.Runtime.Go(func(ctx context.Context) func() {
		models, err := svc.Models(ctx, d.Provider, key, d.BaseURL)
		return func() {
			s.busy, s.models, s.modelErr = false, models, err
		}
	})
}

func (s *Settings) save(env Env) {
	svc, d := env.Runtime.Agent, s.draft
	d.APIKey = strings.TrimSpace(s.key)
	if d.Provider != s.stored.Provider {
		d.OAuth = nil
	}
	s.busy = true
	env.Runtime.Go(func(ctx context.Context) func() {
		cfg, err := svc.SaveConfiguration(ctx, d, false)
		return func() {
			if err == nil {
				env.Store.Notify(copy.T(copy.Saved), false)
			}
			s.done(env, cfg, err)
		}
	})
}

func deliveryName(d domain.Delivery) string {
	if d == domain.DeliverAutoSend {
		return copy.T(copy.AgentDeliveryAuto)
	}
	return copy.T(copy.AgentDeliveryDraft)
}

var deliveries = []domain.Delivery{domain.DeliverDraftOnly, domain.DeliverAutoSend}

func (s *Settings) automation(c *ui.Context, env Env) {
	t, svc := env.Tokens, env.Runtime.Agent
	reload := func() { s.loaded = false }
	act := func(do func(ctx context.Context) error) {
		env.Runtime.Go(func(ctx context.Context) func() {
			err := do(ctx)
			return func() {
				if err != nil {
					env.Store.Notify(err.Error(), true)
				}
				reload()
			}
		})
	}
	kit.Group(c, t, copy.T(copy.AgentRules), copy.T(copy.AgentRulesHint), func() {
		for i, r := range s.rules {
			if i > 0 {
				kit.Divider(c, t)
			}
			r := r
			kit.Row(c.Key(r.ID), t, r.Name, strings.Join(r.Match.Keywords, ", ")+" · "+deliveryName(r.Delivery), func() {
				on := r.Enabled
				if ui.Switch(c.Key("on"), &on).Label(r.Name).Changed() {
					act(func(ctx context.Context) error { _, err := svc.SetRuleEnabled(ctx, r.ID, on); return err })
				}
				kit.IconButton(c.Key("remove"), t, icons.Trash, copy.T(copy.Remove)).OnClick(func() {
					act(func(ctx context.Context) error { return svc.RemoveRule(ctx, r.ID) })
				})
			})
		}
		if len(s.rules) > 0 {
			kit.Divider(c, t)
		}
		kit.NavRow(c.Key("new-rule"), t, icons.Plus, copy.T(copy.AgentRuleNew), "").OnClick(func() {
			s.rule = ruleDraft{open: true, delivery: domain.DeliverDraftOnly}
		})
	})
	kit.Group(c, t, copy.T(copy.AgentTasks), copy.T(copy.AgentTasksHint), func() {
		for i, task := range s.tasks {
			if i > 0 {
				kit.Divider(c, t)
			}
			task := task
			kit.Row(c.Key(task.ID), t, task.Name, task.Schedule.Expression+" · "+deliveryName(task.Delivery), func() {
				on := task.Enabled
				if ui.Switch(c.Key("on"), &on).Label(task.Name).Changed() {
					act(func(ctx context.Context) error { _, err := svc.SetTaskEnabled(ctx, task.ID, on); return err })
				}
				kit.IconButton(c.Key("remove"), t, icons.Trash, copy.T(copy.Remove)).OnClick(func() {
					act(func(ctx context.Context) error { return svc.RemoveTask(ctx, task.ID) })
				})
			})
		}
		if len(s.tasks) > 0 {
			kit.Divider(c, t)
		}
		kit.NavRow(c.Key("new-task"), t, icons.Plus, copy.T(copy.AgentTaskNew), "").OnClick(func() {
			s.task = taskDraft{open: true, delivery: domain.DeliverDraftOnly, cron: "0 9 * * 1-5", chat: env.Store.Selected}
		})
	})
	r := &s.rule
	kit.Dialog(c, t, &r.open, 440, copy.T(copy.AgentRuleNew), copy.T(copy.AgentRulesHint), func() {
		kit.Field(ui.TextInput(c.Key("name"), &r.name).AutoFocus().Label(copy.T(copy.FoldersName)).Placeholder(copy.T(copy.FoldersName)), t)
		kit.Field(ui.TextInput(c.Key("keywords"), &r.keywords).Label(copy.T(copy.AgentRuleKeywords)).Placeholder(copy.T(copy.AgentRuleKeywordsHint)), t)
		kit.Field(ui.TextArea(c.Key("prompt"), &r.prompt).Lines(2, 5).Label(copy.T(copy.AgentRulePrompt)), t)
		kit.Select(c.Key("delivery"), t, &r.delivery, copy.T(copy.AgentDelivery), deliveries, deliveryName)
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { r.open = false })
		var kw []string
		for _, k := range strings.Split(r.keywords, ",") {
			if k = strings.TrimSpace(k); k != "" {
				kw = append(kw, k)
			}
		}
		ok := strings.TrimSpace(r.name) != "" && strings.TrimSpace(r.prompt) != "" && len(kw) > 0
		kit.Button(c.Key("save"), t, kit.Primary, copy.T(copy.Create), ok).OnClick(func() {
			r.open = false
			rule := domain.Rule{Name: r.name, PromptTemplate: r.prompt, Delivery: r.delivery, Match: domain.RuleMatch{Keywords: kw, ExcludeMuted: true}}
			act(func(ctx context.Context) error { _, err := svc.SaveRule(ctx, rule, domain.CreatedByUser); return err })
		})
	})
	k := &s.task
	kit.Dialog(c, t, &k.open, 440, copy.T(copy.AgentTaskNew), copy.T(copy.AgentTasksHint), func() {
		kit.Field(ui.TextInput(c.Key("name"), &k.name).AutoFocus().Label(copy.T(copy.FoldersName)).Placeholder(copy.T(copy.FoldersName)), t)
		kit.Field(ui.TextInput(c.Key("cron"), &k.cron).Label(copy.T(copy.AgentTaskSchedule)).Placeholder(copy.T(copy.AgentTaskScheduleHint)).FontFeatures("tnum"), t)
		ui.Text(c, copy.T(copy.AgentTaskScheduleHint)).FontSize(theme.Caption).TextColor(t.Muted)
		chats := env.Store.All()
		ids := make([]tg.ChatID, len(chats))
		for i, ch := range chats {
			ids[i] = ch.ID
		}
		if k.chat == 0 && len(ids) > 0 {
			k.chat = ids[0]
		}
		kit.Select(c.Key("chat"), t, &k.chat, copy.T(copy.AgentTaskChat), ids, func(id tg.ChatID) string {
			if ch, ok := env.Store.Chat(id); ok {
				return ch.Title
			}
			return ""
		})
		kit.Field(ui.TextArea(c.Key("prompt"), &k.prompt).Lines(2, 5).Label(copy.T(copy.AgentRulePrompt)), t)
		kit.Select(c.Key("delivery"), t, &k.delivery, copy.T(copy.AgentDelivery), deliveries, deliveryName)
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { k.open = false })
		_, cronErr := domain.ParseCron(k.cron)
		ok := strings.TrimSpace(k.name) != "" && strings.TrimSpace(k.prompt) != "" && cronErr == nil && k.chat != 0
		kit.Button(c.Key("save"), t, kit.Primary, copy.T(copy.Create), ok).OnClick(func() {
			k.open = false
			task := domain.Task{Name: k.name, PromptTemplate: k.prompt, Delivery: k.delivery, ChatID: int64(k.chat),
				Schedule: domain.Schedule{Kind: domain.ScheduleCron, Expression: k.cron}}
			act(func(ctx context.Context) error { _, err := svc.SaveTask(ctx, task, domain.CreatedByUser); return err })
		})
	})
}
