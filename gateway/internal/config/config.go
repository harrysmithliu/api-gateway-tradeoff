package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AppName              string
	Environment          string
	GatewayPort          int
	LogLevel             string
	CorsAllowedOrigins   []string
	PostgresDSN          string
	RedisURL             string
	UserServiceURL       string
	ProductServiceURL    string
	OrderServiceURL      string
	RequestTimeoutSec    int
	UpstreamMaxConns     int
	UpstreamMaxKeepalive int
	UpstreamKeepaliveSec int
}

func Load() Config {
	return Config{
		AppName:              getEnv("APP_NAME", "classic-api-gateway"),
		Environment:          getEnv("ENVIRONMENT", "development"),
		GatewayPort:          getEnvInt("GATEWAY_PORT", 8000),
		LogLevel:             getEnv("LOG_LEVEL", "INFO"),
		CorsAllowedOrigins:   parseCSV(getEnv("CORS_ALLOWED_ORIGINS", "*")),
		PostgresDSN:          getEnv("POSTGRES_DSN", "postgresql://postgres:postgres@localhost:5432/rate_limiter"),
		RedisURL:             getEnv("REDIS_URL", "redis://localhost:6379/0"),
		UserServiceURL:       getEnv("GATEWAY_USER_SERVICE_URL", "http://localhost:8001"),
		ProductServiceURL:    getEnv("GATEWAY_PRODUCT_SERVICE_URL", "http://localhost:8002"),
		OrderServiceURL:      getEnv("GATEWAY_ORDER_SERVICE_URL", "http://localhost:8003"),
		RequestTimeoutSec:    getEnvInt("REQUEST_TIMEOUT_SECONDS", 15),
		UpstreamMaxConns:     getEnvInt("UPSTREAM_MAX_CONNECTIONS", 1024),
		UpstreamMaxKeepalive: getEnvInt("UPSTREAM_MAX_KEEPALIVE_CONNECTIONS", 256),
		UpstreamKeepaliveSec: getEnvInt("UPSTREAM_KEEPALIVE_EXPIRY_SECONDS", 30),
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	raw := getEnv(key, "")
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func parseCSV(raw string) []string {
	items := strings.Split(raw, ",")
	out := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		return []string{"*"}
	}
	return out
}
