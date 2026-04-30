package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"gateway/internal/config"
	"gateway/internal/db"
	"gateway/internal/httpapi"
	"gateway/internal/runtime"
)

func main() {
	cfg := config.Load()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	pool, err := db.NewPostgresPool(ctx, cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("postgres init failed: %v", err)
	}
	defer pool.Close()

	if err := db.EnsureSchema(ctx, pool); err != nil {
		log.Fatalf("schema ensure failed: %v", err)
	}

	store, err := runtime.NewRedisStore(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis init failed: %v", err)
	}

	server := httpapi.New(cfg, pool, store)
	httpServer := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.GatewayPort),
		Handler:      server.Router(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	log.Printf("gateway listening on %s", httpServer.Addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}
