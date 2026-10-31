package parity

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }

// Anchor is a Telo registry row that claims an upstream item: a shortcut,
// a menu item, a settings index entry or a context-menu action. Keys are
// the accelerator Telo binds on macOS, in the upstream glyph notation.
type Anchor struct {
	Upstream string
	Keys     string
	// Owner names the registry for messages ("shortcuts", "settings").
	Owner string
}

// interactive kinds must be claimed by a registry anchor when implemented,
// so the ledger cannot call a shortcut done that no table binds.
var interactive = map[Kind]bool{
	KindShortcut: true, KindMenu: true, KindSetting: true,
	KindMessageAction: true, KindChatAction: true, KindAttachAction: true,
}

// Report is the outcome of a check: every failure, and the counts.
type Report struct {
	Failures []string
	Counts   Summary
	Covered  int
	Items    int
}

func (r *Report) fail(format string, args ...any) {
	r.Failures = append(r.Failures, fmt.Sprintf(format, args...))
}

// Check validates the ledger against the inventory, the repository at
// root, and the anchors Telo's registries declare.
func Check(root string, inv *Inventory, l *Ledger, anchors []Anchor) *Report {
	r := &Report{Counts: l.Count(), Items: len(inv.Items)}
	items := inv.Index()
	if l.Commit != inv.Commit {
		r.fail("ledger classifies telegram-macos %s, inventory is %s", short(l.Commit), short(inv.Commit))
	}
	for _, st := range Statuses {
		if l.Summary[st] != r.Counts[st] {
			r.fail("ledger summary states %d %s, entries hold %d", l.Summary[st], st, r.Counts[st])
		}
	}
	for k := range l.Summary {
		if !validStatus(k) {
			r.fail("ledger summary has unknown status %q", k)
		}
	}

	claimed := map[string]string{}
	statusOf := map[string]Status{}
	ids := map[string]bool{}
	pkgs := newPackageIndex(root)
	for _, e := range l.Entries {
		where := "entry " + e.ID
		if e.ID == "" {
			r.fail("an entry has no id")
		}
		if ids[e.ID] {
			r.fail("%s is listed twice", where)
		}
		ids[e.ID] = true
		if strings.TrimSpace(e.Title) == "" {
			r.fail("%s has no title", where)
		}
		if !validStatus(e.Status) {
			r.fail("%s has unknown status %q", where, e.Status)
			continue
		}
		if len(e.Upstream) == 0 {
			r.fail("%s claims no upstream item", where)
		}
		for _, u := range e.Upstream {
			if _, ok := items[u]; !ok {
				r.fail("%s claims %s, which the inventory does not list", where, u)
				continue
			}
			if prev, dup := claimed[u]; dup {
				r.fail("%s is claimed by both %s and %s", u, prev, e.ID)
			}
			claimed[u] = e.ID
			statusOf[u] = e.Status
		}
		switch e.Status {
		case Implemented, Partial:
			if len(e.Evidence) == 0 {
				r.fail("%s is %s without evidence", where, e.Status)
			}
			if len(e.Tests) == 0 {
				r.fail("%s is %s without tests", where, e.Status)
			}
			for _, ev := range e.Evidence {
				if err := pkgs.resolveDecl(ev); err != nil {
					r.fail("%s evidence %s: %v", where, ev, err)
				}
			}
			for _, t := range e.Tests {
				if err := pkgs.resolveTest(t); err != nil {
					r.fail("%s test %s: %v", where, t, err)
				}
			}
			if e.Status == Partial {
				requirePlan(r, where, e)
			}
		case Planned:
			requirePlan(r, where, e)
		case NotApplicable:
			if strings.TrimSpace(e.Reason) == "" {
				r.fail("%s is not-applicable without a reason", where)
			}
			if e.Decision == "" {
				r.fail("%s is not-applicable without a decision document", where)
			} else if _, err := os.Stat(filepath.Join(root, e.Decision)); err != nil {
				r.fail("%s decision %s does not exist", where, e.Decision)
			}
		}
	}
	var missing []string
	for _, it := range inv.Items {
		if _, ok := claimed[it.ID]; !ok {
			missing = append(missing, it.ID)
		}
	}
	sort.Strings(missing)
	for _, m := range missing {
		r.fail("upstream %s (%s) is not classified", m, items[m].Title)
	}
	r.Covered = len(claimed)

	anchored := map[string]bool{}
	for _, a := range anchors {
		it, ok := items[a.Upstream]
		if !ok {
			r.fail("%s anchors %s, which the inventory does not list", a.Owner, a.Upstream)
			continue
		}
		anchored[a.Upstream] = true
		if st := statusOf[a.Upstream]; st != Implemented && st != Partial {
			r.fail("%s binds %s, which the ledger marks %s", a.Owner, a.Upstream, st)
		}
		if it.Keys != "" && keyLike(it.Keys) {
			want := NormalizeKeys(it.Keys)
			if got := NormalizeKeys(a.Keys); !containsKeys(want, got) {
				r.fail("%s binds %s to %q, upstream binds %q", a.Owner, a.Upstream, a.Keys, it.Keys)
			}
		}
	}
	for _, it := range inv.Items {
		st := statusOf[it.ID]
		if interactive[it.Kind] && st == Implemented && !anchored[it.ID] {
			r.fail("%s is implemented but no Telo registry binds it", it.ID)
		}
	}
	return r
}

func requirePlan(r *Report, where string, e Entry) {
	if e.Priority != "P0" && e.Priority != "P1" && e.Priority != "P2" {
		r.fail("%s is %s without a P0/P1/P2 priority", where, e.Status)
	}
	if strings.TrimSpace(e.Reason) == "" {
		r.fail("%s is %s without a reason", where, e.Status)
	}
}

func validStatus(s Status) bool {
	for _, v := range Statuses {
		if v == s {
			return true
		}
	}
	return false
}

func short(c string) string {
	if len(c) > 12 {
		return c[:12]
	}
	return c
}

var glyphKey = regexp.MustCompile(`[⌘⇧⌥⌃↑↓←→]|^[A-Z0-9,.;:]$`)

// keyLike tells an accelerator ("⇧⌘F", "↑") from a gesture or a mouse
// description ("Double Click"), which no registry can bind.
func keyLike(keys string) bool {
	for _, alt := range strings.Split(keys, "/") {
		alt = strings.TrimSpace(alt)
		if alt != "" && glyphKey.MatchString(alt) && !strings.Contains(alt, " ") {
			return true
		}
	}
	return false
}

// NormalizeKeys splits an accelerator list ("⌘B / **") into its keyboard
// alternatives, each with modifiers in canonical order, dropping markdown
// typing alternatives that are not key presses.
func NormalizeKeys(keys string) []string {
	var out []string
	for _, alt := range strings.Split(keys, "/") {
		alt = strings.TrimSpace(alt)
		if alt == "" || !glyphKey.MatchString(alt) || strings.Contains(alt, " ") {
			continue
		}
		var mods, rest strings.Builder
		for _, g := range []string{"⌃", "⌥", "⇧", "⌘"} {
			if strings.Contains(alt, g) {
				mods.WriteString(g)
			}
		}
		for _, r := range alt {
			if !strings.ContainsRune("⌃⌥⇧⌘", r) {
				rest.WriteRune(r)
			}
		}
		out = append(out, mods.String()+strings.ToUpper(rest.String()))
	}
	return out
}

// containsKeys tells whether Telo binds every keyboard alternative the
// upstream client binds.
func containsKeys(want, got []string) bool {
	have := map[string]bool{}
	for _, g := range got {
		have[g] = true
	}
	for _, w := range want {
		if !have[w] {
			return false
		}
	}
	return true
}

// packageIndex parses Go packages of the repository on demand.
type packageIndex struct {
	root   string
	parsed map[string]*goPackage
}

type goPackage struct {
	decls map[string]bool
	tests map[string]bool
	err   error
}

func newPackageIndex(root string) *packageIndex {
	return &packageIndex{root: root, parsed: map[string]*goPackage{}}
}

// split separates "frontend/app.Name.Method" into the directory and the
// dotted name; the directory is everything up to the last slash plus its
// first dotted segment.
func split(ref string) (string, string, error) {
	slash := strings.LastIndex(ref, "/")
	dot := strings.Index(ref[slash+1:], ".")
	if dot < 0 {
		return "", "", fmt.Errorf("want <package dir>.<Name>")
	}
	return ref[:slash+1+dot], ref[slash+2+dot:], nil
}

func (p *packageIndex) load(dir string) *goPackage {
	if pkg, ok := p.parsed[dir]; ok {
		return pkg
	}
	pkg := &goPackage{decls: map[string]bool{}, tests: map[string]bool{}}
	p.parsed[dir] = pkg
	files, err := filepath.Glob(filepath.Join(p.root, dir, "*.go"))
	if err != nil || len(files) == 0 {
		pkg.err = fmt.Errorf("no Go package at %s", dir)
		return pkg
	}
	fset := token.NewFileSet()
	for _, f := range files {
		file, err := parser.ParseFile(fset, f, nil, parser.SkipObjectResolution)
		if err != nil {
			pkg.err = err
			return pkg
		}
		isTest := strings.HasSuffix(f, "_test.go")
		for _, d := range file.Decls {
			switch d := d.(type) {
			case *ast.FuncDecl:
				name := d.Name.Name
				if d.Recv != nil && len(d.Recv.List) == 1 {
					name = receiverName(d.Recv.List[0].Type) + "." + name
				}
				if isTest && d.Recv == nil && strings.HasPrefix(name, "Test") {
					pkg.tests[name] = true
				}
				if !isTest {
					pkg.decls[name] = true
				}
			case *ast.GenDecl:
				if isTest {
					continue
				}
				for _, s := range d.Specs {
					switch s := s.(type) {
					case *ast.TypeSpec:
						pkg.decls[s.Name.Name] = true
					case *ast.ValueSpec:
						for _, n := range s.Names {
							pkg.decls[n.Name] = true
						}
					}
				}
			}
		}
	}
	return pkg
}

func receiverName(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.StarExpr:
		return receiverName(t.X)
	case *ast.IndexExpr:
		return receiverName(t.X)
	case *ast.IndexListExpr:
		return receiverName(t.X)
	case *ast.Ident:
		return t.Name
	}
	return ""
}

func (p *packageIndex) resolveDecl(ref string) error {
	dir, name, err := split(ref)
	if err != nil {
		return err
	}
	pkg := p.load(dir)
	if pkg.err != nil {
		return pkg.err
	}
	if !pkg.decls[name] {
		return fmt.Errorf("%s declares no %s", dir, name)
	}
	return nil
}

func (p *packageIndex) resolveTest(ref string) error {
	dir, name, err := split(ref)
	if err != nil {
		return err
	}
	pkg := p.load(dir)
	if pkg.err != nil {
		return pkg.err
	}
	if !pkg.tests[name] {
		return fmt.Errorf("%s has no test %s", dir, name)
	}
	return nil
}
