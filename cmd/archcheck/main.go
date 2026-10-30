// Command archcheck enforces the import rules of docs/frontend and
// docs/backend: the DDD layers depend inward, the FSD layers import only
// downward, and a slice never imports a sibling slice of its own layer.
package main

import (
	"flag"
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const module = "github.com/AstraFoundry/telo/"

// fsd ranks the frontend layers; a layer imports only those below it.
var fsd = map[string]int{"app": 5, "pages": 4, "widgets": 3, "features": 2, "entities": 1, "shared": 0}

// slice names a package's layer and slice: "frontend/features/compose"
// is the compose slice of features.
func slice(pkg string) (area, layer, name string) {
	parts := strings.Split(pkg, "/")
	if len(parts) >= 2 {
		area, layer = parts[0], parts[1]
	}
	if len(parts) >= 3 {
		name = parts[2]
	}
	return
}

// allowed tells whether pkg may import dep; test files get the demo
// workspace and the test kit.
func allowed(pkg, dep string, test bool) string {
	area, layer, name := slice(pkg)
	darea, dlayer, dname := slice(dep)
	switch area {
	case "backend":
		switch layer {
		case "domain":
			if darea != "backend" || dlayer != "domain" {
				return "the domain depends on nothing outside it"
			}
		case "application":
			if darea != "backend" || (dlayer != "domain" && dlayer != "application") {
				if test && dlayer == "infrastructure" {
					return ""
				}
				return "the application depends on the domain only"
			}
		case "infrastructure":
			if darea == "frontend" || darea == "bootstrap" {
				return "infrastructure implements the domain's ports; it never reaches the UI"
			}
		}
	case "frontend":
		if darea == "backend" && dlayer == "infrastructure" && !(test || pkg == "frontend/shared/testkit") {
			return "the UI reaches Telegram and the agent through the runtime, never infrastructure"
		}
		if darea == "bootstrap" {
			return "the UI never imports the composition root"
		}
		if darea != "frontend" {
			return ""
		}
		from, ok1 := fsd[layer]
		to, ok2 := fsd[dlayer]
		switch {
		case !ok1 || !ok2:
			return "unknown FSD layer"
		case to > from:
			return fmt.Sprintf("%s imports upward into %s", layer, dlayer)
		case to == from && layer != "shared" && layer != "app" && name != dname:
			return fmt.Sprintf("slice %s imports its sibling %s; extract the shared part downward", name, dname)
		}
	}
	return ""
}

// Check returns every violation in the repository at root.
func Check(root string) ([]string, error) {
	var fails []string
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case "node_modules", ".git", ".workspace", "build", "testdata":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		rel, _ := filepath.Rel(root, filepath.Dir(path))
		rel = filepath.ToSlash(rel)
		if !strings.HasPrefix(rel, "backend/") && !strings.HasPrefix(rel, "frontend/") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		test := strings.HasSuffix(path, "_test.go")
		for _, imp := range f.Imports {
			dep, _ := strconv.Unquote(imp.Path.Value)
			if !strings.HasPrefix(dep, module) {
				continue
			}
			dep = strings.TrimPrefix(dep, module)
			if why := allowed(rel, dep, test); why != "" {
				file, _ := filepath.Rel(root, path)
				fails = append(fails, fmt.Sprintf("%s imports %s: %s", filepath.ToSlash(file), dep, why))
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
		fmt.Fprintln(os.Stderr, "archcheck:", err)
		os.Exit(2)
	}
	for _, f := range fails {
		fmt.Fprintln(os.Stderr, "architecture:", f)
	}
	if len(fails) > 0 {
		os.Exit(1)
	}
	fmt.Println("architecture: ok")
}
