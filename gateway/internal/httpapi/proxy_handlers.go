package httpapi

import (
	"io"
	"net/http"
	"strings"

	"gateway/internal/proxy"
)

func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	if proxy.IsManagementPath(r.URL.Path) {
		writeError(w, http.StatusNotFound, "Route not found")
		return
	}

	clientID := proxy.ClientIDFromRequest(r)
	decision, err := s.sim.Evaluate(r.Context(), clientID)
	if err != nil {
		if strings.Contains(err.Error(), "no active") {
			writeError(w, http.StatusConflict, "No active policy configured.")
			return
		}
		if strings.Contains(err.Error(), "not implemented") {
			writeError(w, http.StatusNotImplemented, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	if !decision.Allowed {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"detail":         "rate_limit_exceeded",
			"retry_after_ms": decision.RetryAfterMS,
			"policy_id":      decision.PolicyID,
			"algorithm":      decision.Algorithm,
		})
		return
	}

	upstreamResp, err := s.proxy.Forward(r.Context(), r)
	if err != nil {
		if strings.Contains(err.Error(), "route not found") {
			writeError(w, http.StatusNotFound, "Route not found")
			return
		}
		writeError(w, http.StatusBadGateway, "Upstream request error.")
		return
	}
	defer upstreamResp.Body.Close()

	for key, values := range upstreamResp.Header {
		if strings.EqualFold(key, "Connection") || strings.EqualFold(key, "Transfer-Encoding") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(upstreamResp.StatusCode)
	_, _ = io.Copy(w, upstreamResp.Body)
}
