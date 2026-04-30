package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"

	"gateway/internal/policy"

	"github.com/go-chi/chi/v5"
)

func (s *Server) handleListPolicies(w http.ResponseWriter, r *http.Request) {
	items, err := s.policies.List(r.Context())
	if s.mapPolicyError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreatePolicy(w http.ResponseWriter, r *http.Request) {
	var req policy.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
		return
	}
	if req.Name == "" || req.Algorithm == "" || req.ParamsJSON == nil {
		writeError(w, http.StatusUnprocessableEntity, "name, algorithm and params_json are required.")
		return
	}
	created, err := s.policies.Create(r.Context(), req)
	if s.mapPolicyError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleUpdatePolicy(w http.ResponseWriter, r *http.Request) {
	policyID := chi.URLParam(r, "policyID")
	var req policy.UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON payload.")
		return
	}
	updated, err := s.policies.Update(r.Context(), policyID, req)
	if s.mapPolicyError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleActivatePolicy(w http.ResponseWriter, r *http.Request) {
	policyID := chi.URLParam(r, "policyID")
	resetFlag, _ := strconv.ParseBool(r.URL.Query().Get("reset_runtime_state"))
	item, err := s.policies.Activate(r.Context(), policyID, resetFlag)
	if s.mapPolicyError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleActivePolicy(w http.ResponseWriter, r *http.Request) {
	item, err := s.policies.Active(r.Context())
	if s.mapPolicyError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, item)
}
