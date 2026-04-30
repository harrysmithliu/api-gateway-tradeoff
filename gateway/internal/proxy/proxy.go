package proxy

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"gateway/internal/config"
)

type Service struct {
	cfg    config.Config
	client *http.Client
}

func NewService(cfg config.Config) *Service {
	transport := &http.Transport{
		MaxConnsPerHost:       cfg.UpstreamMaxConns,
		MaxIdleConnsPerHost:   cfg.UpstreamMaxKeepalive,
		IdleConnTimeout:       time.Duration(cfg.UpstreamKeepaliveSec) * time.Second,
		ResponseHeaderTimeout: time.Duration(cfg.RequestTimeoutSec) * time.Second,
	}
	return &Service{
		cfg: cfg,
		client: &http.Client{
			Timeout:   time.Duration(cfg.RequestTimeoutSec) * time.Second,
			Transport: transport,
		},
	}
}

func (s *Service) ResolveTarget(path string) (string, error) {
	switch {
	case strings.HasPrefix(path, "/api/auth"):
		return s.cfg.UserServiceURL + strings.TrimPrefix(path, "/api"), nil
	case strings.HasPrefix(path, "/api/users"):
		return s.cfg.UserServiceURL + strings.TrimPrefix(path, "/api"), nil
	case strings.HasPrefix(path, "/api/products"):
		return s.cfg.ProductServiceURL + strings.TrimPrefix(path, "/api"), nil
	case strings.HasPrefix(path, "/api/orders"):
		return s.cfg.OrderServiceURL + strings.TrimPrefix(path, "/api"), nil
	default:
		return "", fmt.Errorf("route not found")
	}
}

func (s *Service) Forward(ctx context.Context, incoming *http.Request) (*http.Response, error) {
	targetURL, err := s.ResolveTarget(incoming.URL.Path)
	if err != nil {
		return nil, err
	}

	bodyBytes, err := io.ReadAll(incoming.Body)
	if err != nil {
		return nil, err
	}
	_ = incoming.Body.Close()

	upstreamReq, err := http.NewRequestWithContext(ctx, incoming.Method, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	upstreamReq.URL.RawQuery = incoming.URL.RawQuery

	for key, values := range incoming.Header {
		if strings.EqualFold(key, "Host") {
			continue
		}
		for _, value := range values {
			upstreamReq.Header.Add(key, value)
		}
	}

	return s.client.Do(upstreamReq)
}

func IsManagementPath(path string) bool {
	return path == "/api/health" ||
		strings.HasPrefix(path, "/api/policies") ||
		path == "/api/simulate/request"
}

func ClientIDFromRequest(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("X-Client-Id")); value != "" {
		return value
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if strings.TrimSpace(r.RemoteAddr) != "" {
		return r.RemoteAddr
	}
	return "unknown"
}
