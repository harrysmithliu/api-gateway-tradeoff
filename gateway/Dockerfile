FROM golang:1.24 AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o /out/gateway ./cmd/gateway

FROM gcr.io/distroless/static-debian12
WORKDIR /
COPY --from=builder /out/gateway /gateway
EXPOSE 8000
ENTRYPOINT ["/gateway"]
