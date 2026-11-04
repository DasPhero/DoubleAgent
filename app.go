package main

import (
	"context"

	"doubleagent/backend/core"
)

// App struct represents the minimal Go surface bound to the frontend WebView.
// Only methods on App that are exported are callable by the frontend.
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
}

// startup is called when the Wails application starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// HealthCheck returns the current walking-skeleton status of DoubleAgent.
func (a *App) HealthCheck() core.AppStatus {
	return core.AppStatus{
		Name:      "DoubleAgent",
		Version:   "0.1.0",
		Milestone: "M0-0",
		VaultLock: true,
	}
}

