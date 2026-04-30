package runtime

import (
	"context"
	"fmt"
	"strconv"
	"time"

	redis "github.com/redis/go-redis/v9"
)

type RedisStore struct {
	client *redis.Client
}

var slidingLogScript = redis.NewScript(`
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttl_sec = tonumber(ARGV[5])

local window_start_ms = now_ms - window_ms
redis.call("ZREMRANGEBYSCORE", key, "-inf", window_start_ms - 1)

local count = redis.call("ZCARD", key)
if count < limit then
  redis.call("ZADD", key, now_ms, member)
  count = count + 1
  redis.call("EXPIRE", key, ttl_sec)
  return {1, count, limit - count, 0, window_start_ms, math.floor(window_ms / 1000)}
end

local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local retry_after_ms = 1
if oldest[2] ~= nil then
  local earliest_ms = tonumber(oldest[2])
  retry_after_ms = (earliest_ms + window_ms) - now_ms
  if retry_after_ms < 1 then
    retry_after_ms = 1
  end
end

redis.call("EXPIRE", key, ttl_sec)
return {0, count, 0, retry_after_ms, window_start_ms, math.floor(window_ms / 1000)}
`)

var slidingWindowCounterScript = redis.NewScript(`
local current_key = KEYS[1]
local previous_key = KEYS[2]
local ttl_sec = tonumber(ARGV[1])

local current_count = redis.call("INCR", current_key)
redis.call("EXPIRE", current_key, ttl_sec)

local previous_count = redis.call("GET", previous_key)
if previous_count == false then
  previous_count = 0
else
  previous_count = tonumber(previous_count)
end

return {current_count, previous_count}
`)

var tokenBucketScript = redis.NewScript(`
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_rate_per_sec = tonumber(ARGV[3])
local tokens_per_request = tonumber(ARGV[4])
local ttl_sec = tonumber(ARGV[5])

local fields = redis.call("HMGET", key, "tokens", "last_refill_ms")
local tokens = tonumber(fields[1])
local last_refill_ms = tonumber(fields[2])

if tokens == nil then
  tokens = capacity
end
if last_refill_ms == nil then
  last_refill_ms = now_ms
end

local elapsed_ms = now_ms - last_refill_ms
if elapsed_ms < 0 then
  elapsed_ms = 0
end

tokens = tokens + (elapsed_ms / 1000.0) * refill_rate_per_sec
if tokens > capacity then
  tokens = capacity
end

local allowed = 0
local retry_after_ms = 0

if tokens >= tokens_per_request then
  allowed = 1
  tokens = tokens - tokens_per_request
else
  local need = tokens_per_request - tokens
  retry_after_ms = math.ceil((need / refill_rate_per_sec) * 1000)
  if retry_after_ms < 1 then
    retry_after_ms = 1
  end
end

redis.call("HSET", key, "tokens", tokens, "last_refill_ms", now_ms)
redis.call("EXPIRE", key, ttl_sec)

return {allowed, tokens, now_ms, retry_after_ms}
`)

func NewRedisStore(redisURL string) (*RedisStore, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	return &RedisStore{client: redis.NewClient(opts)}, nil
}

func (s *RedisStore) Incr(ctx context.Context, key string) (int64, error) {
	return s.client.Incr(ctx, key).Result()
}

func (s *RedisStore) Expire(ctx context.Context, key string, ttl time.Duration) error {
	return s.client.Expire(ctx, key, ttl).Err()
}

func (s *RedisStore) EvalSlidingLog(ctx context.Context, key string, nowMS int64, windowSizeSec int, limit int, requestToken string) (SlidingLogEvalResult, error) {
	if windowSizeSec <= 0 || limit <= 0 {
		return SlidingLogEvalResult{}, fmt.Errorf("invalid sliding log args: window_size_sec and limit must be positive")
	}

	windowMS := int64(windowSizeSec * 1000)
	raw, err := slidingLogScript.Run(ctx, s.client, []string{key}, nowMS, windowMS, limit, requestToken, windowSizeSec+1).Result()
	if err != nil {
		return SlidingLogEvalResult{}, err
	}

	values, ok := raw.([]any)
	if !ok || len(values) != 6 {
		return SlidingLogEvalResult{}, fmt.Errorf("unexpected sliding log script response format")
	}

	allowedInt, err := asInt64(values[0])
	if err != nil {
		return SlidingLogEvalResult{}, fmt.Errorf("parse allowed: %w", err)
	}
	count, err := asInt64(values[1])
	if err != nil {
		return SlidingLogEvalResult{}, fmt.Errorf("parse count: %w", err)
	}
	remainingInt, err := asInt64(values[2])
	if err != nil {
		return SlidingLogEvalResult{}, fmt.Errorf("parse remaining: %w", err)
	}
	retryAfterInt, err := asInt64(values[3])
	if err != nil {
		return SlidingLogEvalResult{}, fmt.Errorf("parse retry_after_ms: %w", err)
	}
	windowStartMS, err := asInt64(values[4])
	if err != nil {
		return SlidingLogEvalResult{}, fmt.Errorf("parse window_start_ms: %w", err)
	}
	windowSize, err := asInt64(values[5])
	if err != nil {
		return SlidingLogEvalResult{}, fmt.Errorf("parse window_size_sec: %w", err)
	}

	return SlidingLogEvalResult{
		Allowed:      allowedInt == 1,
		Count:        count,
		Remaining:    int(remainingInt),
		RetryAfterMS: int(retryAfterInt),
		WindowStart:  windowStartMS,
		WindowSize:   int(windowSize),
	}, nil
}

func (s *RedisStore) EvalSlidingWindowCounter(ctx context.Context, currentKey string, previousKey string, ttlSec int) (SlidingWindowCounterEvalResult, error) {
	if ttlSec <= 0 {
		return SlidingWindowCounterEvalResult{}, fmt.Errorf("invalid sliding window counter args: ttlSec must be positive")
	}

	raw, err := slidingWindowCounterScript.Run(ctx, s.client, []string{currentKey, previousKey}, ttlSec).Result()
	if err != nil {
		return SlidingWindowCounterEvalResult{}, err
	}

	values, ok := raw.([]any)
	if !ok || len(values) != 2 {
		return SlidingWindowCounterEvalResult{}, fmt.Errorf("unexpected sliding window counter script response format")
	}

	currentCount, err := asInt64(values[0])
	if err != nil {
		return SlidingWindowCounterEvalResult{}, fmt.Errorf("parse current_count: %w", err)
	}
	previousCount, err := asInt64(values[1])
	if err != nil {
		return SlidingWindowCounterEvalResult{}, fmt.Errorf("parse previous_count: %w", err)
	}

	return SlidingWindowCounterEvalResult{
		CurrentWindowCount:  currentCount,
		PreviousWindowCount: previousCount,
	}, nil
}

func (s *RedisStore) EvalTokenBucket(ctx context.Context, key string, nowMS int64, capacity int, refillRatePerSec float64, tokensPerRequest int, ttlSec int) (TokenBucketEvalResult, error) {
	if capacity <= 0 || refillRatePerSec <= 0 || tokensPerRequest <= 0 || ttlSec <= 0 {
		return TokenBucketEvalResult{}, fmt.Errorf("invalid token bucket args")
	}

	raw, err := tokenBucketScript.Run(ctx, s.client, []string{key}, nowMS, capacity, refillRatePerSec, tokensPerRequest, ttlSec).Result()
	if err != nil {
		return TokenBucketEvalResult{}, err
	}

	values, ok := raw.([]any)
	if !ok || len(values) != 4 {
		return TokenBucketEvalResult{}, fmt.Errorf("unexpected token bucket script response format")
	}

	allowedInt, err := asInt64(values[0])
	if err != nil {
		return TokenBucketEvalResult{}, fmt.Errorf("parse allowed: %w", err)
	}
	tokens, err := asFloat64(values[1])
	if err != nil {
		return TokenBucketEvalResult{}, fmt.Errorf("parse tokens: %w", err)
	}
	lastRefillMS, err := asInt64(values[2])
	if err != nil {
		return TokenBucketEvalResult{}, fmt.Errorf("parse last_refill_ms: %w", err)
	}
	retryAfterMS, err := asInt64(values[3])
	if err != nil {
		return TokenBucketEvalResult{}, fmt.Errorf("parse retry_after_ms: %w", err)
	}

	return TokenBucketEvalResult{
		Allowed:      allowedInt == 1,
		Tokens:       tokens,
		LastRefillMS: lastRefillMS,
		RetryAfterMS: int(retryAfterMS),
	}, nil
}

func (s *RedisStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *RedisStore) ScanDelete(ctx context.Context, pattern string, batch int64) error {
	var cursor uint64
	for {
		keys, nextCursor, err := s.client.Scan(ctx, cursor, pattern, batch).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := s.client.Del(ctx, keys...).Err(); err != nil {
				return err
			}
		}
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	return nil
}

func asInt64(value any) (int64, error) {
	switch v := value.(type) {
	case int64:
		return v, nil
	case int:
		return int64(v), nil
	case float64:
		return int64(v), nil
	case string:
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0, err
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("unexpected type %T", value)
	}
}

func asFloat64(value any) (float64, error) {
	switch v := value.(type) {
	case float64:
		return v, nil
	case int64:
		return float64(v), nil
	case int:
		return float64(v), nil
	case string:
		parsed, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0, err
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("unexpected type %T", value)
	}
}
