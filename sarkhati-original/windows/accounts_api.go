package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// درگاه‌های حساب‌های چندگانه.
//
// هر حساب یک پروفایل مرورگر دارد. روند کار: «افزودن حساب» پنجرهٔ تازه‌ای با
// پروفایل خالی باز می‌کند، شما با حساب دوم وارد می‌شوید، و «ذخیرهٔ این حساب»
// نشانی و قالب و توکن همان حساب را برمی‌دارد. دفعهٔ بعد فقط «ورود دوباره»
// لازم است، چون کوکی پروفایل سرِ جایش می‌ماند.

func (s *Server) accountViews() []AccountView {
	s.mu.Lock()
	accounts := append([]Account(nil), s.config.Accounts...)
	s.mu.Unlock()
	views := make([]AccountView, 0, len(accounts))
	for _, account := range accounts {
		views = append(views, account.View())
	}
	return views
}

// withAccount یک حساب را با شناسه پیدا و تغییر می‌دهد.
func (s *Server) withAccount(id string, change func(*Account) error) error {
	s.mu.Lock()
	index := -1
	for i := range s.config.Accounts {
		if s.config.Accounts[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		s.mu.Unlock()
		return fmt.Errorf("حساب پیدا نشد")
	}
	account := s.config.Accounts[index]
	if err := change(&account); err != nil {
		s.mu.Unlock()
		return err
	}
	s.config.Accounts[index] = account
	s.mu.Unlock()
	return s.saveConfig()
}

func (s *Server) handleAccountAdd(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Name string `json:"name"`
		Open bool   `json:"open"`
	}
	json.NewDecoder(r.Body).Decode(&payload)
	name := strings.TrimSpace(payload.Name)

	s.mu.Lock()
	if name == "" {
		name = fmt.Sprintf("حساب %d", len(s.config.Accounts)+2)
	}
	account := Account{
		ID:      newAccountID(s.config.Accounts),
		Name:    name,
		Enabled: true,
	}
	account.Profile = account.ID
	s.config.Accounts = append(s.config.Accounts, account)
	browserPath, portal := s.config.BrowserPath, s.config.PortalURL
	s.mu.Unlock()
	if err := s.saveConfig(); err != nil {
		fail(w, err)
		return
	}

	if payload.Open {
		if portal == "" {
			portal = EasyTraderURL
		}
		if err := s.capturer.Start(browserPath, portal, account.Profile); err != nil {
			writeJSON(w, map[string]interface{}{"ok": true, "account": account.View(),
				"accounts": s.accountViews(), "warning": err.Error()})
			return
		}
		s.engine.logf("پنجرهٔ حساب «%s» باز شد؛ با همان حساب وارد شوید و بعد «ذخیرهٔ این حساب» را بزنید", account.Name)
	}
	writeJSON(w, map[string]interface{}{"ok": true, "account": account.View(), "accounts": s.accountViews()})
}

// handleAccountOpen پنجرهٔ همان حساب را باز می‌کند تا دوباره وارد شوید.
func (s *Server) handleAccountOpen(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		fail(w, err)
		return
	}
	s.mu.Lock()
	var target *Account
	for i := range s.config.Accounts {
		if s.config.Accounts[i].ID == payload.ID {
			target = &s.config.Accounts[i]
			break
		}
	}
	if target == nil {
		s.mu.Unlock()
		fail(w, fmt.Errorf("حساب پیدا نشد"))
		return
	}
	account := *target
	browserPath, portal := s.config.BrowserPath, s.config.PortalURL
	s.mu.Unlock()

	if portal == "" {
		portal = EasyTraderURL
	}
	if err := s.capturer.Start(browserPath, portal, account.Profile); err != nil {
		fail(w, err)
		return
	}
	s.engine.logf("پنجرهٔ حساب «%s» باز شد", account.Name)
	writeJSON(w, map[string]interface{}{"ok": true})
}

// handleAccountCapture آنچه همین حالا در مرورگر یاد گرفته شده را داخل حساب می‌ریزد.
func (s *Server) handleAccountCapture(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		fail(w, err)
		return
	}
	learned := s.current()
	var name string
	err := s.withAccount(payload.ID, func(account *Account) error {
		name = account.Name
		return account.Snapshot(learned)
	})
	if err != nil {
		fail(w, err)
		return
	}
	s.engine.logf("حساب «%s» ذخیره شد و آمادهٔ ارسال هم‌زمان است", name)
	writeJSON(w, map[string]interface{}{"ok": true, "accounts": s.accountViews()})
}

func (s *Server) handleAccountUpdate(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID       string  `json:"id"`
		Name     *string `json:"name"`
		Enabled  *bool   `json:"enabled"`
		Quantity *int64  `json:"quantity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		fail(w, err)
		return
	}
	err := s.withAccount(payload.ID, func(account *Account) error {
		if payload.Name != nil && strings.TrimSpace(*payload.Name) != "" {
			account.Name = strings.TrimSpace(*payload.Name)
		}
		if payload.Enabled != nil {
			account.Enabled = *payload.Enabled
		}
		if payload.Quantity != nil && *payload.Quantity >= 0 {
			account.Quantity = *payload.Quantity
		}
		return nil
	})
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "accounts": s.accountViews()})
}

func (s *Server) handleAccountDelete(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		fail(w, err)
		return
	}
	s.mu.Lock()
	kept := make([]Account, 0, len(s.config.Accounts))
	removed := ""
	for _, account := range s.config.Accounts {
		if account.ID == payload.ID {
			removed = account.Name
			continue
		}
		kept = append(kept, account)
	}
	s.config.Accounts = kept
	s.mu.Unlock()
	if removed == "" {
		fail(w, fmt.Errorf("حساب پیدا نشد"))
		return
	}
	if err := s.saveConfig(); err != nil {
		fail(w, err)
		return
	}
	s.engine.logf("حساب «%s» حذف شد", removed)
	writeJSON(w, map[string]interface{}{"ok": true, "accounts": s.accountViews()})
}
