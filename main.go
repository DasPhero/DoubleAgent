package main

import (
	"embed"
	"log"
	"os"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

// isRemoteDisplayEnvironment detects remote desktop sessions (such as xrdp on Linux)
// or missing/unreadable DRI GPU render nodes where WebKit2GTK hardware compositing
// degrades to slow CPU software OpenGL.
// Set DOUBLEAGENT_RDP_MODE=1 to force-enable or DOUBLEAGENT_RDP_MODE=0 to force-disable.
func isRemoteDisplayEnvironment() bool {
	if v := os.Getenv("DOUBLEAGENT_RDP_MODE"); v != "" {
		return v == "1" || v == "true" || v == "TRUE"
	}
	if goruntime.GOOS != "linux" {
		return false
	}
	if os.Getenv("XRDP_SESSION") != "" || os.Getenv("XRDP_SOCKET_PATH") != "" {
		return true
	}
	f, err := os.OpenFile("/dev/dri/renderD128", os.O_RDWR, 0)
	if err != nil {
		return true
	}
	_ = f.Close()
	return false
}

func setEnvDefault(key, value string) {
	if os.Getenv(key) == "" {
		_ = os.Setenv(key, value)
	}
}

func configureLinuxWebViewPolicy() linux.WebviewGpuPolicy {
	if goruntime.GOOS != "linux" {
		return linux.WebviewGpuPolicyOnDemand
	}
	if isRemoteDisplayEnvironment() {
		setEnvDefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
		setEnvDefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
		setEnvDefault("LIBGL_ALWAYS_SOFTWARE", "1")
		return linux.WebviewGpuPolicyNever
	}
	return linux.WebviewGpuPolicyOnDemand
}

func main() {
	gpuPolicy := configureLinuxWebViewPolicy()
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "DoubleAgent",
		Width:     1280,
		Height:    800,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 17, B: 23, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Linux: &linux.Options{
			Icon:                appIcon,
			WindowIsTranslucent: false,
			WebviewGpuPolicy:    gpuPolicy,
			ProgramName:         "DoubleAgent",
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

