//go:build !windows

package main

import "fmt"

// DesktopSender روی سیستم‌عامل‌های غیرویندوزی فقط یک جای‌نگهدار است تا کد
// روی لینوکس هم کامپایل و تست شود.
type DesktopSender struct{ cfg Config }

func NewDesktopSender(cfg Config) *DesktopSender { return &DesktopSender{cfg: cfg} }

func (d *DesktopSender) Prepare(price int64) error {
	return fmt.Errorf("حالت دسکتاپ فقط روی ویندوز کار می‌کند")
}

func (d *DesktopSender) KeepAlive() {}

func (d *DesktopSender) Send(attempt int) Result {
	return Result{Accepted: false, Detail: "حالت دسکتاپ فقط روی ویندوز کار می‌کند"}
}

func (d *DesktopSender) Close() {}
