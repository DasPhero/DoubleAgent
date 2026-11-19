package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"doubleagent/backend/remoteagent"
)

func main() {
	// Never write logs to stdout; stdout is strictly reserved for framed NDJSON-RPC messages.
	log.SetOutput(os.Stderr)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := remoteagent.NewServer(os.Stdin, os.Stdout)
	if err := srv.Serve(ctx); err != nil {
		log.Printf("doubleagent-agent exited with error: %v", err)
		os.Exit(1)
	}
}
