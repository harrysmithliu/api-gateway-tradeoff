package httpapi

import (
	"encoding/json"
	"net/http"
)

type errorBody struct {
	Detail string `json:"detail"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, errorBody{Detail: detail})
}
