package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
)

type simulateRequest struct {
	ClientID string `json:"client_id"`
}

func (s *Server) handleSimulateRequest(w http.ResponseWriter, r *http.Request) {
	var req simulateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
		return
	}
	if strings.TrimSpace(req.ClientID) == "" {
		writeError(w, http.StatusUnprocessableEntity, "client_id cannot be blank.")
		return
	}

	decision, err := s.sim.Evaluate(r.Context(), req.ClientID)
	if err != nil {
		switch {
		case strings.Contains(err.Error(), "no active"):
			writeError(w, http.StatusConflict, "No active policy configured.")
		case strings.Contains(err.Error(), "not implemented"):
			writeError(w, http.StatusNotImplemented, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "Internal server error.")
		}
		return
	}

	if decision.Allowed {
		writeJSON(w, http.StatusOK, decision)
		return
	}
	writeJSON(w, http.StatusTooManyRequests, decision)
}
