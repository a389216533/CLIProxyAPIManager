//go:build !windows

package app

import "fmt"

func openBrowser(string) error {
	return fmt.Errorf("open browser is only supported on Windows")
}
