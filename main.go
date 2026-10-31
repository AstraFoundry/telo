// Command telo is the desktop app: a native Telegram client for macOS and
// Windows with an agent beside the conversations.
package main

import (
	"log"
	"os"

	"github.com/AstraFoundry/telo/bootstrap"
)

func main() {
	app, err := bootstrap.New(bootstrap.Options{
		// Isolated profiles for tests and side-by-side development.
		DataDir: os.Getenv("TELO_DATA_DIR"),
		Demo:    os.Getenv("TELO_DEMO") == "1",
		// A developer's own credentials for `make dev`; releases link theirs.
		APIID:   os.Getenv("TELO_TELEGRAM_API_ID"),
		APIHash: os.Getenv("TELO_TELEGRAM_API_HASH"),
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
