package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// پروتکل DevTools کروم: همان کانالی که خود DevTools با آن حرف می‌زند.
//
// با این کانال، برنامه می‌تواند ترافیک تبِ ایزی‌تریدر را ببیند و توکن و
// درخواست‌های واقعی را یاد بگیرد — بدون اینکه لازم باشد کاربر دستی سراغ
// تب Network برود.

// cdpTarget یک تب یا کارگر در مرورگر.
type cdpTarget struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	URL   string `json:"url"`
	Title string `json:"title"`
	WSURL string `json:"webSocketDebuggerUrl"`
}

// cdpMessage پیام خام پروتکل.
type cdpMessage struct {
	ID     int             `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// wantedEvent فقط رویدادهایی که واقعاً استفاده می‌کنیم.
func wantedEvent(method string) bool {
	switch method {
	case "Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFinished":
		return true
	case "Network.webSocketFrameReceived":
		// بعضی کارگزاری‌ها داده را روی وب‌سوکت می‌فرستند، نه درخواست HTTP.
		return true
	}
	return false
}

// cdpConn یک اتصال زنده به یک تب.
type cdpConn struct {
	ws     *websocket.Conn
	nextID int64

	mu      sync.Mutex
	pending map[int]chan cdpMessage
	closed  bool

	events chan cdpMessage
}

// listTargets تب‌های باز مرورگر را از درگاه اشکال‌زدایی می‌خواند.
func listTargets(port int) ([]cdpTarget, error) {
	client := &http.Client{Timeout: 3 * time.Second}
	// درگاه اشکال‌زدایی روی لوکال‌هاست است؛ پراکسی نباید دخالت کند.
	client.Transport = &http.Transport{Proxy: nil}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/json/list", port))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var targets []cdpTarget
	if err := json.NewDecoder(resp.Body).Decode(&targets); err != nil {
		return nil, err
	}
	return targets, nil
}

func dialTarget(target cdpTarget) (*cdpConn, error) {
	if target.WSURL == "" {
		return nil, fmt.Errorf("این تب کانال اشکال‌زدایی ندارد")
	}
	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
		Proxy:            nil,
		ReadBufferSize:   64 * 1024,
		WriteBufferSize:  16 * 1024,
	}
	ws, _, err := dialer.Dial(target.WSURL, nil)
	if err != nil {
		return nil, err
	}
	ws.SetReadLimit(16 << 20) // پاسخ‌های بزرگ را هم بتوانیم بخوانیم

	c := &cdpConn{
		ws:      ws,
		pending: make(map[int]chan cdpMessage),
		events:  make(chan cdpMessage, 2048),
	}
	go c.readLoop()
	return c, nil
}

func (c *cdpConn) readLoop() {
	defer c.Close()
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		var msg cdpMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		// صفحهٔ زندهٔ کارگزاری در ثانیه ده‌ها رویداد می‌فرستد (قیمت لحظه‌ای،
		// دریافت تکه‌تکهٔ داده، وب‌سوکت…). اگر همه را صف کنیم، صف لبریز
		// می‌شود و همان چند رویدادی که لازم داریم می‌افتد.
		if msg.ID == 0 && !wantedEvent(msg.Method) {
			continue
		}
		if msg.ID != 0 {
			c.mu.Lock()
			ch, ok := c.pending[msg.ID]
			delete(c.pending, msg.ID)
			c.mu.Unlock()
			if ok {
				ch <- msg
			}
			continue
		}
		select {
		case c.events <- msg:
		default:
			// حتی با فیلتر بالا هم ممکن است مصرف‌کننده عقب بیفتد؛ افتادن یک
			// رویداد بهتر از قفل شدن کل خواندن است.
		}
	}
}

// Call یک فرمان می‌فرستد و منتظر پاسخش می‌ماند.
func (c *cdpConn) Call(method string, params interface{}) (json.RawMessage, error) {
	id := int(atomic.AddInt64(&c.nextID, 1))
	payload := map[string]interface{}{"id": id, "method": method}
	if params != nil {
		payload["params"] = params
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	reply := make(chan cdpMessage, 1)
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, fmt.Errorf("اتصال بسته شده است")
	}
	c.pending[id] = reply
	err = c.ws.WriteMessage(websocket.TextMessage, data)
	c.mu.Unlock()
	if err != nil {
		return nil, err
	}

	select {
	case msg := <-reply:
		if msg.Error != nil {
			return nil, fmt.Errorf("%s: %s", method, msg.Error.Message)
		}
		return msg.Result, nil
	case <-time.After(10 * time.Second):
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("%s: پاسخی نیامد", method)
	}
}

func (c *cdpConn) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.mu.Unlock()
	c.ws.Close()
}
