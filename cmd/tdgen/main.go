// Command tdgen generates Go types for the TDLib JSON interface from the
// pinned td_api.tl schema and an allowlist of the functions and
// constructors Telo uses.
//
//	go run ./cmd/tdgen -schema backend/infrastructure/tdlib/tdapi/td_api.tl \
//	    -list backend/infrastructure/tdlib/tdapi/tdapi.list \
//	    -out backend/infrastructure/tdlib/tdapi/tdapi_gen.go
//
// Classes (TL types with several constructors) become Go interfaces. Only
// the constructors the allowlist names are generated; any other one
// decodes as the class's Unknown value, which keeps its raw JSON, so a
// newer server object never fails a whole update. Single-constructor types
// referenced by a generated field are generated transitively.
package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"go/format"
	"os"
	"sort"
	"strings"
	"unicode"
)

type field struct {
	name, tlType, doc string
}

type constructor struct {
	name   string // TL name, lowerCamel
	result string // TL result type, UpperCamel
	fields []field
	doc    string
	isFunc bool
}

type schema struct {
	types   map[string]*constructor   // constructors by name
	funcs   map[string]*constructor   // functions by name
	byType  map[string][]*constructor // constructors of each result type
	classes map[string]string         // declared abstract classes, with docs
}

func parse(path string) (*schema, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	s := &schema{types: map[string]*constructor{}, funcs: map[string]*constructor{}, byType: map[string][]*constructor{}, classes: map[string]string{}}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	inFuncs := false
	docs := map[string]string{}
	var doc string
	builtins := map[string]bool{"double": true, "string": true, "int32": true, "int53": true, "int64": true, "bytes": true, "boolFalse": true, "boolTrue": true, "vector": true}
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		switch {
		case line == "":
			continue
		case line == "---functions---":
			inFuncs = true
			continue
		case strings.HasPrefix(line, "//@class "):
			rest := strings.TrimPrefix(line, "//@class ")
			name, desc, _ := strings.Cut(rest, " @description ")
			s.classes[strings.TrimSpace(name)] = strings.TrimSpace(desc)
			continue
		case strings.HasPrefix(line, "//"):
			body := strings.TrimPrefix(strings.TrimPrefix(line, "//"), "-")
			for _, part := range strings.Split(body, "@")[1:] {
				key, val, _ := strings.Cut(part, " ")
				if key == "description" {
					doc = strings.TrimSpace(val)
					docs = map[string]string{}
					continue
				}
				if key == "param_description" {
					key = "description"
				}
				docs[key] = strings.TrimSpace(docs[key] + " " + strings.TrimSpace(val))
			}
			continue
		}
		line = strings.TrimSuffix(line, ";")
		left, result, ok := strings.Cut(line, " = ")
		if !ok {
			continue
		}
		parts := strings.Fields(left)
		name := parts[0]
		if builtins[name] {
			continue
		}
		c := &constructor{name: name, result: strings.TrimSpace(result), doc: doc, isFunc: inFuncs}
		for _, p := range parts[1:] {
			fn, ft, _ := strings.Cut(p, ":")
			c.fields = append(c.fields, field{name: fn, tlType: ft, doc: docs[fn]})
		}
		doc = ""
		docs = map[string]string{}
		if inFuncs {
			s.funcs[name] = c
		} else {
			s.types[name] = c
			s.byType[c.result] = append(s.byType[c.result], c)
		}
	}
	return s, sc.Err()
}

// isClass tells whether a TL type is generated as an interface.
func (s *schema) isClass(t string) bool {
	if _, ok := s.classes[t]; ok {
		return true
	}
	return len(s.byType[t]) > 1
}

type generator struct {
	s *schema
	// funcs and types to generate; classes that appear.
	funcs   map[string]bool
	types   map[string]bool
	classes map[string]bool
	// wholeClasses lists classes whose every constructor is generated.
	wholeClasses map[string]bool
	queue        []string
}

func (g *generator) needType(name string) {
	if g.types[name] {
		return
	}
	if _, ok := g.s.types[name]; !ok {
		fail("unknown constructor %s", name)
	}
	g.types[name] = true
	g.queue = append(g.queue, name)
	if r := g.s.types[name].result; g.s.isClass(r) {
		g.classes[r] = true
	}
}

// needTL records what a field of TL type t needs.
func (g *generator) needTL(t string) {
	if inner, ok := vectorOf(t); ok {
		g.needTL(inner)
		return
	}
	switch t {
	case "double", "string", "int32", "int53", "int64", "bytes", "Bool":
		return
	}
	if unicode.IsLower(rune(t[0])) {
		g.needType(t)
		return
	}
	if g.s.isClass(t) {
		g.classes[t] = true
		if g.wholeClasses[t] {
			for _, c := range g.s.byType[t] {
				g.needType(c.name)
			}
		}
		return
	}
	cs := g.s.byType[t]
	if len(cs) != 1 {
		fail("type %s has %d constructors", t, len(cs))
	}
	g.needType(cs[0].name)
}

func vectorOf(t string) (string, bool) {
	if strings.HasPrefix(t, "vector<") && strings.HasSuffix(t, ">") {
		return t[len("vector<") : len(t)-1], true
	}
	return "", false
}

func (g *generator) closure() {
	for name := range g.funcs {
		c := g.s.funcs[name]
		for _, f := range c.fields {
			g.needTL(f.tlType)
		}
		g.needTL(c.result)
	}
	for len(g.queue) > 0 {
		name := g.queue[0]
		g.queue = g.queue[1:]
		for _, f := range g.s.types[name].fields {
			g.needTL(f.tlType)
		}
	}
}

var initialisms = map[string]string{"id": "ID", "url": "URL", "http": "HTTP", "https": "HTTPS", "json": "JSON", "html": "HTML", "ip": "IP", "api": "API", "ttl": "TTL", "uri": "URI", "rtmp": "RTMP", "sms": "SMS", "ui": "UI", "ids": "IDs", "urls": "URLs", "mime": "MIME"}

// goName turns snake_case or lowerCamel into an exported Go identifier.
func goName(s string) string {
	var words []string
	for _, part := range strings.Split(s, "_") {
		words = append(words, splitCamel(part)...)
	}
	var b strings.Builder
	for _, w := range words {
		if w == "" {
			continue
		}
		if v, ok := initialisms[strings.ToLower(w)]; ok {
			b.WriteString(v)
			continue
		}
		r := []rune(w)
		r[0] = unicode.ToUpper(r[0])
		b.WriteString(string(r))
	}
	return b.String()
}

func splitCamel(s string) []string {
	var out []string
	start := 0
	r := []rune(s)
	for i := 1; i < len(r); i++ {
		if unicode.IsUpper(r[i]) && !unicode.IsUpper(r[i-1]) {
			out = append(out, string(r[start:i]))
			start = i
		}
	}
	return append(out, string(r[start:]))
}

// goType maps a TL type to the Go type of a field.
func (g *generator) goType(t string) string {
	if inner, ok := vectorOf(t); ok {
		return "[]" + g.goType(inner)
	}
	switch t {
	case "double":
		return "float64"
	case "string":
		return "string"
	case "int32":
		return "int32"
	case "int53":
		return "int64"
	case "int64":
		return "Int64"
	case "bytes":
		return "[]byte"
	case "Bool":
		return "bool"
	}
	if unicode.IsLower(rune(t[0])) {
		return "*" + goName(t)
	}
	if g.s.isClass(t) {
		return goName(t)
	}
	return "*" + goName(g.s.byType[t][0].name)
}

// classDepth reports how many slice levels wrap a class in t (-1: none).
func (g *generator) classDepth(t string) (string, int) {
	depth := 0
	for {
		inner, ok := vectorOf(t)
		if !ok {
			break
		}
		t, depth = inner, depth+1
	}
	if unicode.IsUpper(rune(t[0])) && g.s.isClass(t) {
		return t, depth
	}
	return "", -1
}

func comment(b *bytes.Buffer, indent, text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	for _, line := range wrap(text, 76) {
		fmt.Fprintf(b, "%s// %s\n", indent, line)
	}
}

func wrap(text string, width int) []string {
	var lines []string
	line := ""
	for _, w := range strings.Fields(text) {
		if line != "" && len(line)+1+len(w) > width {
			lines = append(lines, line)
			line = w
			continue
		}
		if line == "" {
			line = w
		} else {
			line += " " + w
		}
	}
	if line != "" {
		lines = append(lines, line)
	}
	return lines
}

func (g *generator) writeStruct(b *bytes.Buffer, goTypeName, tlName string, c *constructor) {
	comment(b, "", goTypeName+" is TDLib "+tlName+". "+c.doc)
	fmt.Fprintf(b, "type %s struct {\n", goTypeName)
	for _, f := range c.fields {
		comment(b, "\t", f.doc)
		tag := f.name
		if !c.isFunc {
			tag += ",omitempty"
		}
		fmt.Fprintf(b, "\t%s %s `json:\"%s\"`\n", goName(f.name), g.goType(f.tlType), tag)
	}
	fmt.Fprintf(b, "}\n\n")
	fmt.Fprintf(b, "// TDType returns %q.\nfunc (*%s) TDType() string { return %q }\n\n", tlName, goTypeName, tlName)
	fmt.Fprintf(b, "// MarshalJSON adds the @type tag.\nfunc (o *%s) MarshalJSON() ([]byte, error) {\n\ttype plain %s\n\treturn marshalTyped(%q, (*plain)(o))\n}\n\n", goTypeName, goTypeName, tlName)
	// UnmarshalJSON for structs holding interfaces.
	var classFields []field
	for _, f := range c.fields {
		if _, d := g.classDepth(f.tlType); d >= 0 {
			classFields = append(classFields, f)
		}
	}
	if len(classFields) == 0 {
		return
	}
	fmt.Fprintf(b, "// UnmarshalJSON decodes the class-typed fields by their @type.\nfunc (o *%s) UnmarshalJSON(data []byte) error {\n\ttype plain %s\n\tvar raw struct {\n\t\t*plain\n", goTypeName, goTypeName)
	for _, f := range classFields {
		_, d := g.classDepth(f.tlType)
		fmt.Fprintf(b, "\t\t%s %sjson.RawMessage `json:\"%s\"`\n", goName(f.name), strings.Repeat("[]", d), f.name)
	}
	fmt.Fprintf(b, "\t}\n\traw.plain = (*plain)(o)\n\tif err := json.Unmarshal(data, &raw); err != nil {\n\t\treturn err\n\t}\n")
	for _, f := range classFields {
		class, d := g.classDepth(f.tlType)
		fn := "unmarshal" + goName(class)
		name := goName(f.name)
		switch d {
		case 0:
			fmt.Fprintf(b, "\tif v, err := %s(raw.%s); err != nil {\n\t\treturn err\n\t} else {\n\t\to.%s = v\n\t}\n", fn, name, name)
		case 1:
			fmt.Fprintf(b, "\to.%s = nil\n\tfor _, r := range raw.%s {\n\t\tv, err := %s(r)\n\t\tif err != nil {\n\t\t\treturn err\n\t\t}\n\t\to.%s = append(o.%s, v)\n\t}\n", name, name, fn, name, name)
		case 2:
			fmt.Fprintf(b, "\to.%s = nil\n\tfor _, row := range raw.%s {\n\t\tvar out []%s\n\t\tfor _, r := range row {\n\t\t\tv, err := %s(r)\n\t\t\tif err != nil {\n\t\t\t\treturn err\n\t\t\t}\n\t\t\tout = append(out, v)\n\t\t}\n\t\to.%s = append(o.%s, out)\n\t}\n", name, name, goName(class), fn, name, name)
		default:
			fail("field %s.%s nests a class %d deep", c.name, f.name, d)
		}
	}
	fmt.Fprintf(b, "\treturn nil\n}\n\n")
}

func (g *generator) generate(commit string) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "// Code generated by cmd/tdgen from td_api.tl at TDLib %s; DO NOT EDIT.\n\npackage tdapi\n\nimport (\n\t\"context\"\n\t\"encoding/json\"\n)\n\n", commit)

	classes := sortedKeys(g.classes)
	for _, class := range classes {
		gn := goName(class)
		comment(&b, "", gn+" is the TDLib class "+class+". "+g.s.classes[class])
		fmt.Fprintf(&b, "type %s interface {\n\tObject\n\tis%s()\n}\n\n", gn, gn)
		comment(&b, "", "Unknown"+gn+" is a "+class+" constructor this build does not generate; Raw keeps its JSON.")
		fmt.Fprintf(&b, "type Unknown%s struct {\n\tType string\n\tRaw  json.RawMessage\n}\n\n", gn)
		fmt.Fprintf(&b, "// TDType returns the constructor name.\nfunc (u *Unknown%s) TDType() string { return u.Type }\n\nfunc (*Unknown%s) is%s() {}\n\n", gn, gn, gn)
		fmt.Fprintf(&b, "// MarshalJSON returns the raw JSON.\nfunc (u *Unknown%s) MarshalJSON() ([]byte, error) { return u.Raw, nil }\n\n", gn)
		fmt.Fprintf(&b, "func unmarshal%s(raw json.RawMessage) (%s, error) {\n\tt, err := typeOf(raw)\n\tif err != nil || t == \"\" {\n\t\treturn nil, err\n\t}\n\tswitch t {\n", gn, gn)
		var ctors []string
		for _, c := range g.s.byType[class] {
			if g.types[c.name] {
				ctors = append(ctors, c.name)
			}
		}
		sort.Strings(ctors)
		for _, c := range ctors {
			fmt.Fprintf(&b, "\tcase %q:\n\t\tv := new(%s)\n\t\treturn v, json.Unmarshal(raw, v)\n", c, goName(c))
		}
		fmt.Fprintf(&b, "\t}\n\treturn &Unknown%s{Type: t, Raw: append(json.RawMessage(nil), raw...)}, nil\n}\n\n", gn)
	}

	types := sortedKeys(g.types)
	for _, name := range types {
		c := g.s.types[name]
		g.writeStruct(&b, goName(name), name, c)
		if g.s.isClass(c.result) {
			fmt.Fprintf(&b, "func (*%s) is%s() {}\n\n", goName(name), goName(c.result))
		}
	}

	funcs := sortedKeys(g.funcs)
	for _, name := range funcs {
		c := g.s.funcs[name]
		req := goName(name) + "Request"
		g.writeStruct(&b, req, name, c)
		ret := g.goType(c.result)
		comment(&b, "", goName(name)+" calls TDLib "+name+". "+c.doc)
		if g.s.isClass(c.result) {
			fmt.Fprintf(&b, "func (c *Client) %s(ctx context.Context, r *%s) (%s, error) {\n\traw, err := c.Call(ctx, r)\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\treturn unmarshal%s(raw)\n}\n\n", goName(name), req, ret, goName(c.result))
		} else {
			fmt.Fprintf(&b, "func (c *Client) %s(ctx context.Context, r *%s) (%s, error) {\n\traw, err := c.Call(ctx, r)\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\tout := new(%s)\n\treturn out, json.Unmarshal(raw, out)\n}\n\n", goName(name), req, ret, strings.TrimPrefix(ret, "*"))
		}
	}

	fmt.Fprintf(&b, "// decoders maps every generated constructor to a decoder.\nvar decoders = map[string]func(json.RawMessage) (Object, error){\n")
	for _, name := range types {
		fmt.Fprintf(&b, "\t%q: func(raw json.RawMessage) (Object, error) { v := new(%s); return v, json.Unmarshal(raw, v) },\n", name, goName(name))
	}
	fmt.Fprintf(&b, "}\n\n// Methods lists the TDLib functions this build calls.\nvar Methods = []string{\n")
	for _, name := range funcs {
		fmt.Fprintf(&b, "\t%q,\n", name)
	}
	fmt.Fprintf(&b, "}\n")
	out, err := format.Source(b.Bytes())
	if err != nil {
		os.WriteFile("tdapi_gen.broken.go", b.Bytes(), 0o644)
		fail("format: %v", err)
	}
	return out
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "tdgen: "+format+"\n", args...)
	os.Exit(1)
}

func main() {
	schemaPath := flag.String("schema", "backend/infrastructure/tdlib/tdapi/td_api.tl", "td_api.tl")
	listPath := flag.String("list", "backend/infrastructure/tdlib/tdapi/tdapi.list", "allowlist")
	out := flag.String("out", "backend/infrastructure/tdlib/tdapi/tdapi_gen.go", "output")
	commit := flag.String("tdlib", "1.8.67 (d1085f9cebc5a62379991ae1652673954f229c1f)", "TDLib version recorded in the header")
	flag.Parse()
	s, err := parse(*schemaPath)
	if err != nil {
		fail("%v", err)
	}
	g := &generator{s: s, funcs: map[string]bool{}, types: map[string]bool{}, classes: map[string]bool{}, wholeClasses: map[string]bool{}}
	list, err := os.ReadFile(*listPath)
	if err != nil {
		fail("%v", err)
	}
	var roots []string
	for i, line := range strings.Split(string(list), "\n") {
		line, _, _ = strings.Cut(line, "#")
		f := strings.Fields(line)
		if len(f) == 0 {
			continue
		}
		if len(f) != 2 {
			fail("%s:%d: want \"fn|type|class name\"", *listPath, i+1)
		}
		switch f[0] {
		case "fn":
			if _, ok := s.funcs[f[1]]; !ok {
				fail("%s:%d: unknown function %s", *listPath, i+1, f[1])
			}
			g.funcs[f[1]] = true
		case "type":
			roots = append(roots, f[1])
		case "class":
			if !s.isClass(f[1]) {
				fail("%s:%d: %s is not a class", *listPath, i+1, f[1])
			}
			g.wholeClasses[f[1]] = true
		default:
			fail("%s:%d: unknown kind %s", *listPath, i+1, f[0])
		}
	}
	for class := range g.wholeClasses {
		g.classes[class] = true
		for _, c := range s.byType[class] {
			g.needType(c.name)
		}
	}
	for _, r := range roots {
		g.needType(r)
	}
	g.closure()
	if err := os.WriteFile(*out, g.generate(*commit), 0o644); err != nil {
		fail("%v", err)
	}
	fmt.Printf("tdgen: %d functions, %d constructors, %d classes\n", len(g.funcs), len(g.types), len(g.classes))
}
