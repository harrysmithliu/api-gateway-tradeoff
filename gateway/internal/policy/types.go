package policy

import "time"

type Policy struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Algorithm   string         `json:"algorithm"`
	ParamsJSON  map[string]any `json:"params_json"`
	Enabled     bool           `json:"enabled"`
	Version     int            `json:"version"`
	Description *string        `json:"description"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type CreateRequest struct {
	Name        string         `json:"name"`
	Algorithm   string         `json:"algorithm"`
	ParamsJSON  map[string]any `json:"params_json"`
	Enabled     bool           `json:"enabled"`
	Description *string        `json:"description"`
}

type UpdateRequest struct {
	Name        *string         `json:"name"`
	Algorithm   *string         `json:"algorithm"`
	ParamsJSON  *map[string]any `json:"params_json"`
	Enabled     *bool           `json:"enabled"`
	Description *string         `json:"description"`
}
