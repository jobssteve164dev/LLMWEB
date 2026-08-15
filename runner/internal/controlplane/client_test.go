package controlplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthorizeUpgradeUsesExistingRunnerIdentityAndPairingCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/runners/upgrade-authorization" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer existing-device-token" {
			t.Fatalf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["code"] != "pair_once_123" {
			t.Fatalf("unexpected pairing code: %q", body["code"])
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	if err := New(server.URL, "existing-device-token").AuthorizeUpgrade(context.Background(), "pair_once_123"); err != nil {
		t.Fatal(err)
	}
}
