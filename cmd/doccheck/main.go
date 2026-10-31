// Command doccheck fails on documentation that drifted from the
// repository: relative links that point nowhere, and `make` targets the
// Makefile does not define.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var (
	link   = regexp.MustCompile(`\]\(([^)\s]+)\)`)
	target = regexp.MustCompile("`make ([a-z][a-z0-9-]*)")
	rule   = regexp.MustCompile(`^([a-zA-Z_-]+):`)
)

func targets(root string) (map[string]bool, error) {
	f, err := os.Open(filepath.Join(root, "Makefile"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if m := rule.FindStringSubmatch(sc.Text()); m != nil {
			out[m[1]] = true
		}
	}
	return out, sc.Err()
}

// Check returns every broken link and unknown make target.
func Check(root string) ([]string, error) {
	known, err := targets(root)
	if err != nil {
		return nil, err
	}
	var fails []string
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case "node_modules", ".git", ".workspace", "build", ".agents", ".claude":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".md") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		text := string(raw)
		for _, m := range link.FindAllStringSubmatch(text, -1) {
			dest := m[1]
			if strings.Contains(dest, "://") || strings.HasPrefix(dest, "#") || strings.HasPrefix(dest, "mailto:") {
				continue
			}
			dest, _, _ = strings.Cut(dest, "#")
			if _, err := os.Stat(filepath.Join(filepath.Dir(path), dest)); err != nil {
				fails = append(fails, fmt.Sprintf("%s links %s, which does not exist", filepath.ToSlash(rel), m[1]))
			}
		}
		for _, m := range target.FindAllStringSubmatch(text, -1) {
			if !known[m[1]] {
				fails = append(fails, fmt.Sprintf("%s names `make %s`, which the Makefile does not define", filepath.ToSlash(rel), m[1]))
			}
		}
		return nil
	})
	sort.Strings(fails)
	return fails, err
}

func main() {
	root := flag.String("root", ".", "repository root")
	flag.Parse()
	fails, err := Check(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "doccheck:", err)
		os.Exit(2)
	}
	for _, f := range fails {
		fmt.Fprintln(os.Stderr, "docs:", f)
	}
	if len(fails) > 0 {
		os.Exit(1)
	}
	fmt.Println("docs: links and make targets resolve")
}
