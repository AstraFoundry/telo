// Command capabilitycheck validates docs/telegram/tdlib-capability-matrix.json:
// the pinned TDLib it names is the one package.json stages, every covered
// capability calls only TDLib functions and updates the generated tdapi
// binds, and its evidence files exist.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

type matrix struct {
	TDLibVersion  string       `json:"tdlibVersion"`
	PrebuiltTDLib string       `json:"prebuiltTdlib"`
	TDLibCommit   string       `json:"tdlibCommit"`
	Capabilities  []capability `json:"capabilities"`
}

type capability struct {
	ID       string   `json:"id"`
	Workflow string   `json:"workflow"`
	Methods  []string `json:"methods"`
	Evidence []string `json:"evidence"`
	State    string   `json:"state"`
}

// Check returns every failure of the matrix at root.
func Check(root string) ([]string, error) {
	var fails []string
	raw, err := os.ReadFile(filepath.Join(root, "docs/telegram/tdlib-capability-matrix.json"))
	if err != nil {
		return nil, err
	}
	var m matrix
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return nil, err
	}
	var pkg struct {
		DevDependencies map[string]string `json:"devDependencies"`
	}
	raw, err = os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return nil, err
	}
	if got := strings.TrimLeft(pkg.DevDependencies["prebuilt-tdlib"], "^~"); got != m.PrebuiltTDLib {
		fails = append(fails, fmt.Sprintf("package.json stages prebuilt-tdlib %s, the matrix names %s", got, m.PrebuiltTDLib))
	}
	ids := map[string]bool{}
	for _, c := range m.Capabilities {
		if ids[c.ID] {
			fails = append(fails, c.ID+" is listed twice")
		}
		ids[c.ID] = true
		switch c.State {
		case "covered":
			if len(c.Methods) == 0 || len(c.Evidence) == 0 {
				fails = append(fails, c.ID+" is covered without methods and evidence")
			}
			for _, fn := range c.Methods {
				if !bound(fn) {
					fails = append(fails, fmt.Sprintf("%s names %s, which tdapi does not generate", c.ID, fn))
				}
			}
			for _, e := range c.Evidence {
				if _, err := os.Stat(filepath.Join(root, e)); err != nil {
					fails = append(fails, fmt.Sprintf("%s evidence %s does not exist", c.ID, e))
				}
			}
		case "planned", "not-applicable":
		default:
			fails = append(fails, fmt.Sprintf("%s has unknown state %q", c.ID, c.State))
		}
	}
	return fails, nil
}

// bound tells whether the generated bindings call a function or decode an
// update of that name.
func bound(name string) bool {
	if slices.Contains(tdapi.Methods, name) {
		return true
	}
	return strings.HasPrefix(name, "update") && tdapi.Decodes(name)
}

func main() {
	root := flag.String("root", ".", "repository root")
	flag.Parse()
	fails, err := Check(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "capabilitycheck:", err)
		os.Exit(2)
	}
	for _, f := range fails {
		fmt.Fprintln(os.Stderr, "tdlib capability:", f)
	}
	if len(fails) > 0 {
		os.Exit(1)
	}
	fmt.Println("tdlib capability matrix: ok")
}
