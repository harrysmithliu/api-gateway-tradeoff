package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"gateway/internal/config"
	"gateway/internal/policy"
	"gateway/internal/proxy"
	"gateway/internal/runtime"
	"gateway/internal/simulate"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	cfg      config.Config
	pool     *pgxpool.Pool
	store    runtime.Store
	policies PolicyManager
	sim      Simulator
	proxy    *proxy.Service
}

type PolicyManager interface {
	List(ctx context.Context) ([]policy.Policy, error)
	Create(ctx context.Context, req policy.CreateRequest) (policy.Policy, error)
	Update(ctx context.Context, id string, req policy.UpdateRequest) (policy.Policy, error)
	Activate(ctx context.Context, id string, resetRuntime bool) (policy.Policy, error)
	Active(ctx context.Context) (policy.Policy, error)
}

type Simulator interface {
	Evaluate(ctx context.Context, clientID string) (simulate.Response, error)
}

func New(cfg config.Config, pool *pgxpool.Pool, store runtime.Store) *Server {
	policies := policy.NewService(pool, store)
	return &Server{
		cfg:      cfg,
		pool:     pool,
		store:    store,
		policies: policies,
		sim:      simulate.NewService(policies, store),
		proxy:    proxy.NewService(cfg),
	}
}

func NewWithDeps(
	cfg config.Config,
	pool *pgxpool.Pool,
	store runtime.Store,
	policies PolicyManager,
	sim Simulator,
	proxySvc *proxy.Service,
) *Server {
	return &Server{
		cfg:      cfg,
		pool:     pool,
		store:    store,
		policies: policies,
		sim:      sim,
		proxy:    proxySvc,
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CorsAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/", s.handleRoot)
	r.Get("/api/health", s.handleHealth)

	r.Route("/api/policies", func(r chi.Router) {
		r.Get("/", s.handleListPolicies)
		r.Post("/", s.handleCreatePolicy)
		r.Get("/active", s.handleActivePolicy)
		r.Put("/{policyID}", s.handleUpdatePolicy)
		r.Post("/{policyID}/activate", s.handleActivatePolicy)
	})

	r.Post("/api/simulate/request", s.handleSimulateRequest)

	r.Mount("/api", s.proxyMux())
	return r
}

func (s *Server) proxyMux() http.Handler {
	r := chi.NewRouter()
	r.HandleFunc("/*", s.handleProxy)
	return r
}

func (s *Server) handleRoot(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"service":     s.cfg.AppName,
		"environment": s.cfg.Environment,
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	dbOK := s.pool.Ping(ctx) == nil
	redisOK := s.store.Ping(ctx) == nil
	status := "degraded"
	if dbOK && redisOK {
		status = "ok"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": status,
		"dependencies": map[string]string{
			"postgres": map[bool]string{true: "ok", false: "unreachable"}[dbOK],
			"redis":    map[bool]string{true: "ok", false: "unreachable"}[redisOK],
		},
	})
}

func (s *Server) mapPolicyError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case err == policy.ErrNotFound:
		writeError(w, http.StatusNotFound, "Policy not found.")
	case err == policy.ErrConflict:
		writeError(w, http.StatusConflict, "Policy name already exists.")
	case err == policy.ErrUnsupportedInCurrentPhase || err == policy.ErrUnsupportedInM1:
		writeError(w, http.StatusUnprocessableEntity, "Algorithm is not available in current milestone.")
	case err == policy.ErrInvalidInput:
		writeError(w, http.StatusUnprocessableEntity, "Invalid request payload.")
	case err == policy.ErrDisabledPolicy:
		writeError(w, http.StatusConflict, "Disabled policy cannot be activated.")
	case err == policy.ErrNoActivePolicy:
		writeError(w, http.StatusNotFound, "No active policy configured.")
	case err == policy.ErrActivePolicyMissing:
		writeError(w, http.StatusNotFound, "Active policy target does not exist.")
	default:
		if strings.Contains(err.Error(), "invalid input") || strings.Contains(err.Error(), "must be") {
			writeError(w, http.StatusUnprocessableEntity, err.Error())
		} else {
			writeError(w, http.StatusInternalServerError, "Internal server error.")
		}
	}
	return true
}
